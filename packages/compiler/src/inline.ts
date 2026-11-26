import * as t from '@babel/types'
import path from 'node:path'
import {
  codeOf,
  containsJsx,
  getExpression,
  importedName,
  isWhitespaceText,
  skipChildKey,
  walkAst,
} from './ast.ts'
import { eventNameFor, splitEventBinding } from './events.ts'
import { compileChildren, compileNode } from './elements.ts'
import { parseComponent } from './parse.ts'
import { rewriteContextAccess } from './context.ts'
import type { AnyNode, CompilerContext, Scope } from './types.ts'

function usesAsyncBoundary(child) {
  const solidAsync = new Set<string>()
  for (const node of child.ast.program.body) {
    if (!t.isImportDeclaration(node) || !node.source.value.startsWith('solid-js')) continue
    for (const specifier of node.specifiers) {
      if (!t.isImportSpecifier(specifier)) continue
      const imported = importedName(specifier.imported)
      if (imported === 'Loading' || imported === 'Errored') {
        solidAsync.add(specifier.local.name)
      }
    }
  }
  if (solidAsync.size === 0) return false
  let found = false
  walkAst(child.jsx, (node) => {
    if (
      t.isJSXElement(node) &&
      t.isJSXIdentifier(node.openingElement.name) &&
      solidAsync.has(node.openingElement.name.name)
    ) {
      found = true
    }
  })
  return found
}

export function usesSlotElement(node) {
  let found = false
  walkAst(node, (item) => {
    if (
      t.isJSXElement(item) &&
      t.isJSXIdentifier(item.openingElement.name, { name: 'slot' })
    ) {
      found = true
    }
  })
  return found
}

const LOOP_IMPURE_SOLID = new Set([
  'createSignal',
  'createMemo',
  'createEffect',
  'createRenderEffect',
  'createComputed',
  'createDeferred',
  'createReaction',
  'createSelector',
  'createResource',
  'createStore',
  'createMutable',
  'modifyMutable',
  'createRoot',
  'runWithOwner',
  'getOwner',
  'useContext',
  'onMount',
  'onCleanup',
  'onSettled',
  'createContext',
  'batch',
  'flush',
])

/**
 * A component may be inlined inside a loop only when it is a pure projection
 * of its props: no setup statements, no state/lifecycle/context calls. Keeping
 * this check before any import mutation makes the fallback boundary side-effect
 * free.
 */
export function isLoopInlineEligible(child) {
  if (child.returnIndex !== 0) return false
  const impureNames = new Set(LOOP_IMPURE_SOLID)
  for (const node of child.ast.program.body) {
    if (!t.isImportDeclaration(node)) continue
    if (!node.source.value.startsWith('solid-js')) continue
    for (const specifier of node.specifiers) {
      if (!t.isImportSpecifier(specifier)) continue
      const imported = importedName(specifier.imported)
      if (impureNames.has(imported)) return false
    }
  }
  let impure = false
  walkAst(child.fn, (node) => {
    if (
      t.isCallExpression(node) &&
      t.isIdentifier(node.callee) &&
      impureNames.has(node.callee.name)
    ) {
      impure = true
    }
    if (t.isJSXAttribute(node) && t.isJSXIdentifier(node.name, { name: 'ref' })) {
      impure = true
    }
  })
  return !impure
}

/**
 * Replace `props.name` in an inlined child with the parent expression supplied
 * by the JSX attribute. `props.children` is left in place so the existing
 * inline-children path can substitute the compiled parent WXML.
 */
export function substituteInlineProps(node, propsParam, propMap, name) {
  if (!propsParam) return node
  const visit = (value) => {
    if (!value || typeof value !== 'object') return value
    if (t.isMemberExpression(value) || t.isOptionalMemberExpression(value)) {
      if (t.isIdentifier(value.object, { name: propsParam })) {
        if (value.computed || !t.isIdentifier(value.property)) {
          throw new Error(
            `<${name}> uses a computed props access; use props.name instead`,
          )
        }
        const propName = value.property.name
        if (propName === 'children') return value
        const expression = propMap.get(propName)
        return expression ? t.cloneNode(expression, true) : t.identifier('undefined')
      }
    }
    if (t.isIdentifier(value, { name: propsParam })) {
      throw new Error(
        `<${name}> uses the props object as a whole; pass individual props instead`,
      )
    }
    for (const key of t.VISITOR_KEYS[value.type] ?? []) {
      if (skipChildKey(value, key)) continue
      const child = value[key]
      if (Array.isArray(child)) {
        value[key] = child.map((item) => visit(item))
      } else if (child && typeof child === 'object') {
        value[key] = visit(child)
      }
    }
    return value
  }
  return visit(node)
}

function resolveInlineTarget(ctx, name, source): InlineTarget | null {
  const resolved = ctx.resolveComponent(name, source, ctx.currentFile)
  const childSource = typeof resolved === 'string' ? resolved : resolved?.source
  if (!childSource) return null
  const childFile = typeof resolved === 'object' ? resolved.file ?? ctx.currentFile : ctx.currentFile
  const identity = childFile ?? `${ctx.currentFile ?? ''}:${source}`
  if (ctx.inlineStack.includes(identity)) return null
  return { childSource, childFile, identity }
}

/**
 * Snapshot the compiler state an inline attempt mutates before it can fail or
 * fall back to a component boundary, so the parent never inherits the child's
 * imports or WXS usage.
 */
function captureInlineImports(ctx) {
  return {
    imports: new Map(ctx.imports),
    knownImports: new Set(ctx.knownImports),
    extraImports: ctx.extraImports.length,
    usesWxs: ctx.usesWxs,
    usesWxsValue: ctx.usesWxsValue,
  }
}

function restoreInlineImports(ctx, snapshot) {
  ctx.imports = snapshot.imports
  ctx.knownImports = snapshot.knownImports
  ctx.extraImports.length = snapshot.extraImports
  ctx.usesWxs = snapshot.usesWxs
  ctx.usesWxsValue = snapshot.usesWxsValue
}

function parseInlineChild(childSource) {
  try {
    return parseComponent(childSource)
  } catch {
    return null
  }
}

/**
 * A local component has no module of its own. Rebuild the smallest module
 * that can be parsed and inlined: the imports it actually references, plus
 * the declaration itself as the default export. Module-level constants and
 * other local components are intentionally not copied; those cases keep the
 * explicit "move it to its own module" error instead of guessing.
 */
export type InlineTarget = {
  childSource: string
  childFile: string | null
  identity: string
  register?: boolean
}

export function localInlineTarget(ctx, name: string): InlineTarget | null {
  let target = null
  const visitDeclaration = (node) => {
    if (t.isFunctionDeclaration(node) && node.id?.name === name) target = node
    if (!t.isVariableDeclaration(node)) return
    for (const item of node.declarations) {
      if (
        t.isIdentifier(item.id, { name }) &&
        item.init &&
        (t.isArrowFunctionExpression(item.init) || t.isFunctionExpression(item.init))
      ) {
        target = item.init
      }
    }
  }
  for (const node of ctx.program.body) {
    visitDeclaration(node)
    if (t.isExportNamedDeclaration(node) && node.declaration) {
      visitDeclaration(node.declaration)
    }
  }
  if (!target) return null

  const moduleNames = new Set<string>()
  const noteDeclaration = (node) => {
    if ((t.isFunctionDeclaration(node) || t.isClassDeclaration(node) || t.isTSEnumDeclaration(node)) && node.id) {
      moduleNames.add(node.id.name)
    }
    if (!t.isVariableDeclaration(node)) return
    for (const item of node.declarations) {
      if (t.isIdentifier(item.id)) moduleNames.add(item.id.name)
    }
  }
  for (const node of ctx.program.body) {
    noteDeclaration(node)
    if (t.isExportNamedDeclaration(node) && node.declaration) noteDeclaration(node.declaration)
  }
  const componentName = name
  let closesOverModuleScope = false
  walkAst(target, (node) => {
    if (!t.isIdentifier(node)) return
    if (node.name === componentName) return
    if (moduleNames.has(node.name) && !ctx.imports.has(node.name)) {
      closesOverModuleScope = true
    }
  })
  if (closesOverModuleScope) return null

  const used = new Set()
  walkAst(target, (node) => {
    if (t.isIdentifier(node)) used.add(node.name)
  })
  const imports = []
  for (const node of ctx.program.body) {
    if (!t.isImportDeclaration(node) || node.importKind === 'type') continue
    const kept = node.specifiers.filter(
      (specifier) =>
        !(t.isImportSpecifier(specifier) && specifier.importKind === 'type') &&
        used.has(specifier.local.name),
    )
    if (kept.length === 0) continue
    const namespace = kept.find((specifier) => t.isImportNamespaceSpecifier(specifier))
    const defaultSpecifier = kept.find((specifier) => t.isImportDefaultSpecifier(specifier))
    const named = kept.filter((specifier) => t.isImportSpecifier(specifier))
    let clause
    if (namespace) {
      clause = `* as ${namespace.local.name}`
    } else {
      const parts = []
      if (defaultSpecifier) parts.push(defaultSpecifier.local.name)
      if (named.length > 0) {
        parts.push(
          `{ ${named.map((specifier) => ctx.sourceText.slice(specifier.start, specifier.end)).join(', ')} }`,
        )
      }
      clause = parts.join(', ')
    }
    if (!clause) continue
    imports.push(`import ${clause} from ${JSON.stringify(node.source.value)}`)
  }

  const exported = ctx.sourceText.slice(target.start, target.end)
  return {
    childSource: `${imports.join('\n')}\nexport default ${exported}\n`,
    childFile: ctx.currentFile,
    identity: `${ctx.currentFile ?? ''}#local:${name}`,
    register: false,
  }
}

function collectJsxComponents(jsx) {
  const used = new Set()
  walkAst(jsx, (item) => {
    if (t.isJSXElement(item) && t.isJSXIdentifier(item.openingElement.name)) {
      used.add(item.openingElement.name.name)
    }
  })
  return used
}

function adoptSolidImports(ctx, node) {
  for (const specifier of node.specifiers) {
    const local = specifier.local.name
    const existing = ctx.imports.get(local)
    if (existing !== undefined) {
      if (existing !== 'solid-js') return false
      continue
    }
    ctx.imports.set(local, 'solid-js')
    ctx.knownImports.add(local)
    if (t.isImportSpecifier(specifier)) {
      const imported = importedName(specifier.imported)
      const alias = imported === local ? '' : ` as ${local}`
      ctx.extraImports.push(`import { ${imported}${alias} } from "solid-js";`)
    } else if (t.isImportDefaultSpecifier(specifier)) {
      ctx.extraImports.push(`import ${local} from "solid-js";`)
    } else {
      ctx.extraImports.push(`import * as ${local} from "solid-js";`)
    }
  }
  return true
}

function adoptRelativeImports(ctx, node, usedAsComponent, childFile) {
  if (!node.source.value.startsWith('.')) return false
  const locals = node.specifiers.map((specifier) => specifier.local.name)
  if (locals.some((local) => !/^[A-Z]/.test(local))) return false
  for (const local of locals) {
    const existing = ctx.imports.get(local)
    if (existing !== undefined && existing !== node.source.value) return false
    ctx.imports.set(local, node.source.value)
    ctx.knownImports.add(local)
  }
  // A relative import that is only used in JSX is handled by the component
  // resolver. Anything else (a config object, helper, etc.) still needs a
  // real import in the generated parent module, rewritten from the child's
  // directory to the parent's directory.
  if (ctx.currentFile && locals.some((local) => !usedAsComponent.has(local))) {
    const childDir = path.dirname(childFile)
    const parentDir = path.dirname(ctx.currentFile)
    const absolute = path.resolve(childDir, node.source.value)
    let relative = path.relative(parentDir, absolute).split(path.sep).join('/')
    if (!relative.startsWith('.')) relative = `./${relative}`
    const cloned = t.cloneNode(node, true)
    cloned.source = t.stringLiteral(relative)
    ctx.extraImports.push(codeOf(cloned))
  }
  return true
}

/**
 * Adopt the child's import declarations into the parent module. Only solid-js
 * and relative imports are supported; anything else keeps the child at a
 * component boundary.
 */
function adoptInlineImports(ctx, body, usedAsComponent, childFile) {
  for (const node of body) {
    if (!t.isImportDeclaration(node)) continue
    const adopted =
      node.source.value === 'solid-js'
        ? adoptSolidImports(ctx, node)
        : adoptRelativeImports(ctx, node, usedAsComponent, childFile)
    if (!adopted) return false
  }
  return true
}

function declaresInlineBindings(body) {
  return body.some(
    (item) =>
      t.isVariableDeclaration(item) ||
      t.isFunctionDeclaration(item) ||
      t.isExpressionStatement(item) ||
      t.isExportNamedDeclaration(item) ||
      t.isExportAllDeclaration(item),
  )
}

/**
 * Turn the parent JSX attributes into prop getters for the child block. A
 * missing required prop expression (or one the child cannot receive) rejects
 * the inline attempt instead of failing later.
 */
function collectInlineProps(node, ctx) {
  const propGetters = []
  for (const attr of node.openingElement.attributes) {
    if (!t.isJSXAttribute(attr)) return null
    const attrName = t.isJSXIdentifier(attr.name) ? attr.name.name : null
    if (!attrName) return null
    if (attrName === 'key') continue
    if (attrName === 'ref') return null
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(attrName)) return null

    const expression = getExpression(attr)
    if (expression == null) continue
    if (containsJsx(expression)) {
      throw new Error('JSX values are not supported in component props; use children instead')
    }
    ctx.notePropReads(expression)
    propGetters.push({ name: attrName, code: codeOf(expression), expression })
  }
  return propGetters
}

/**
 * Compile the inlined child with its children/props context installed and the
 * parent's context restored even when compilation throws.
 */
function compileInlineBody(ctx, settings, compile) {
  const previous = {
    block: ctx.currentBlock,
    file: ctx.currentFile,
    children: ctx.inlineChildren,
    propsParam: ctx.inlinePropsParam,
    used: ctx.inlineChildrenUsed,
    count: ctx.inlineChildrenCount,
  }
  if (settings.block !== undefined) ctx.currentBlock = settings.block
  ctx.currentFile = settings.file
  ctx.inlineChildren = settings.childrenWxml
  ctx.inlinePropsParam = settings.propsParam
  ctx.inlineChildrenUsed = false
  ctx.inlineChildrenCount = 0
  try {
    const wxml = compile()
    return { wxml, used: ctx.inlineChildrenUsed, count: ctx.inlineChildrenCount }
  } finally {
    ctx.currentBlock = previous.block
    ctx.currentFile = previous.file
    ctx.inlineChildren = previous.children
    ctx.inlinePropsParam = previous.propsParam
    ctx.inlineChildrenUsed = previous.used
    ctx.inlineChildrenCount = previous.count
  }
}

function assertInlineChildren(name, hasChildren, used, count) {
  if (hasChildren && !used) {
    throw new Error(`<${name}> does not render props.children`)
  }
  if (count > 1) {
    throw new Error(`<${name}> renders props.children more than once`)
  }
}

function registerInlineComponent(ctx, name, source, childFile) {
  ctx.inlineComponents.push({ name, source, ...(childFile ? { file: childFile } : {}) })
}

export function inlineComponentInLoop(
  ctx,
  scope,
  name,
  source,
  child,
  childFile,
  propGetters,
  childrenWxml,
  hasChildren,
  register = true,
) {
  const propMap = new Map(propGetters.map((getter) => [getter.name, getter.expression]))
  const jsx = substituteInlineProps(
    t.cloneNode(child.jsx, true),
    child.propsParam?.name ?? null,
    propMap,
    name,
  )

  const { wxml, used, count } = compileInlineBody(
    ctx,
    {
      file: childFile,
      childrenWxml,
      propsParam: child.propsParam?.name ?? null,
    },
    () => compileNode(jsx, ctx, scope),
  )

  assertInlineChildren(name, hasChildren, used, count)
  if (register) registerInlineComponent(ctx, name, source, childFile)
  return wxml
}

export function inlineComponent(node, ctx, scope, name, source, override: InlineTarget | null = null) {
  if (!ctx.inline || (!ctx.resolveComponent && !override)) return null

  const target = override ?? resolveInlineTarget(ctx, name, source)
  if (!target) return null
  if (ctx.inlineStack.includes(target.identity)) return null
  const { childSource, childFile, identity } = target

  // An inline attempt mutates module-level compiler state before it can fail
  // (or decide to fall back to a component boundary). Keep a snapshot so a
  // failed attempt never leaks imports or WXS usage into the parent.
  const previousImports = captureInlineImports(ctx)
  let committed = false
  ctx.inlineStack.push(identity)
  try {
    const child = parseInlineChild(childSource)
    if (!child) return null
    rewriteContextAccess(...child.statements)
    // A boundary owns async state on the component instance; inlining it would
    // move that state into the parent and collide across loop rows.
    if (usesAsyncBoundary(child)) return null
    if (usesSlotElement(child.jsx)) return null
    const inLoop = Boolean(scope)
    if (inLoop && !isLoopInlineEligible(child)) return null

    const usedAsComponent = collectJsxComponents(child.jsx)
    const body = child.ast.program.body
    if (!adoptInlineImports(ctx, body, usedAsComponent, childFile)) return null
    if (declaresInlineBindings(body)) return null

    const propGetters = collectInlineProps(node, ctx)
    if (!propGetters) return null
    if (propGetters.length > 0 && !child.propsParam) return null

    const hasChildren = node.children.some((child) => !isWhitespaceText(child))
    if (hasChildren && !child.propsParam) return null
    const childrenWxml = hasChildren ? compileChildren(node.children, ctx, scope) : ''

    if (inLoop) {
      const wxml = inlineComponentInLoop(
        ctx,
        scope,
        name,
        source,
        child,
        childFile,
        propGetters,
        childrenWxml,
        hasChildren,
        target.register !== false,
      )
      committed = true
      return wxml
    }

    const blockId = ctx.blocks.length
    for (const statement of child.statements.slice(0, child.returnIndex)) {
      ctx.notePropReads(statement)
    }
    ctx.blocks.push({
      setup: child.statements.slice(0, child.returnIndex),
      effects: [],
      propsParam: child.propsParam?.name ?? null,
      propGetters,
      provider: ctx.currentProvider,
    })

    const { wxml, used, count } = compileInlineBody(
      ctx,
      {
        block: blockId,
        file: childFile,
        childrenWxml,
        propsParam: child.propsParam?.name ?? null,
      },
      () => compileNode(child.jsx, ctx, null),
    )

    assertInlineChildren(name, hasChildren, used, count)
    if (target.register !== false) registerInlineComponent(ctx, name, source, childFile)
    committed = true
    return wxml
  } finally {
    ctx.inlineStack.pop()
    if (!committed) restoreInlineImports(ctx, previousImports)
  }
}
