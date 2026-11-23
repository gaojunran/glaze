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
import type { AnyNode, CompilerContext, Scope } from './types.ts'

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
) {
  const propMap = new Map(propGetters.map((getter) => [getter.name, getter.expression]))
  const jsx = substituteInlineProps(
    t.cloneNode(child.jsx, true),
    child.propsParam?.name ?? null,
    propMap,
    name,
  )

  const previousChildren = ctx.inlineChildren
  const previousPropsParam = ctx.inlinePropsParam
  const previousUsed = ctx.inlineChildrenUsed
  const previousCount = ctx.inlineChildrenCount
  const previousFile = ctx.currentFile
  ctx.inlineChildren = childrenWxml
  ctx.inlinePropsParam = child.propsParam?.name ?? null
  ctx.inlineChildrenUsed = false
  ctx.inlineChildrenCount = 0
  ctx.currentFile = childFile

  let wxml
  let childrenUsed = false
  let childrenCount = 0
  try {
    wxml = compileNode(jsx, ctx, scope)
    childrenUsed = ctx.inlineChildrenUsed
    childrenCount = ctx.inlineChildrenCount
  } finally {
    ctx.currentFile = previousFile
    ctx.inlineChildren = previousChildren
    ctx.inlinePropsParam = previousPropsParam
    ctx.inlineChildrenUsed = previousUsed
    ctx.inlineChildrenCount = previousCount
  }

  if (hasChildren && !childrenUsed) {
    throw new Error(`<${name}> does not render props.children`)
  }
  if (childrenCount > 1) {
    throw new Error(`<${name}> renders props.children more than once`)
  }

  ctx.inlineComponents.push({ name, source, ...(childFile ? { file: childFile } : {}) })
  return wxml
}

export function inlineComponent(node, ctx, scope, name, source) {
  if (!ctx.inline || !ctx.resolveComponent) return null

  const resolved = ctx.resolveComponent(name, source, ctx.currentFile)
  const childSource = typeof resolved === 'string' ? resolved : resolved?.source
  if (!childSource) return null
  const childFile = typeof resolved === 'object' ? resolved.file ?? ctx.currentFile : ctx.currentFile
  const identity = childFile ?? `${ctx.currentFile ?? ''}:${source}`
  if (ctx.inlineStack.includes(identity)) return null
  // An inline attempt mutates module-level compiler state before it can fail
  // (or decide to fall back to a component boundary). Keep a snapshot so a
  // failed attempt never leaks imports or WXS usage into the parent.
  const previousImports = new Map(ctx.imports)
  const previousKnownImports = new Set(ctx.knownImports)
  const previousExtraImports = ctx.extraImports.length
  const previousWxs = ctx.usesWxs
  const previousWxsValue = ctx.usesWxsValue
  let committed = false
  ctx.inlineStack.push(identity)
  try {
  let child
  try {
    child = parseComponent(childSource)
  } catch {
    return null
  }
  if (usesSlotElement(child.jsx)) return null
  const inLoop = Boolean(scope)
  if (inLoop && !isLoopInlineEligible(child)) return null
  const usedAsComponent = new Set<string>()
  walkAst(child.jsx, (item) => {
    if (t.isJSXElement(item) && t.isJSXIdentifier(item.openingElement.name)) {
      usedAsComponent.add(item.openingElement.name.name)
    }
  })
  const body = child.ast.program.body
  for (const node of body) {
    if (!t.isImportDeclaration(node)) continue
    if (node.source.value === 'solid-js') {
      for (const specifier of node.specifiers) {
        const local = specifier.local.name
        const existing = ctx.imports.get(local)
        if (existing !== undefined) {
          if (existing !== 'solid-js') return null
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
      continue
    }
    if (!node.source.value.startsWith('.')) return null
    const locals = node.specifiers.map((specifier) => specifier.local.name)
    if (locals.some((local) => !/^[A-Z]/.test(local))) return null
    for (const local of locals) {
      const existing = ctx.imports.get(local)
      if (existing !== undefined && existing !== node.source.value) return null
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
  }
  if (
    body.some(
      (item) =>
        t.isVariableDeclaration(item) ||
        t.isFunctionDeclaration(item) ||
        t.isExpressionStatement(item) ||
        t.isExportNamedDeclaration(item) ||
        t.isExportAllDeclaration(item),
    )
  ) {
    return null
  }

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
    propsParam: child.propsParam?.name ?? null,
    propGetters,
    provider: ctx.currentProvider,
  })

  const previousBlock = ctx.currentBlock
  const previousChildren = ctx.inlineChildren
  const previousPropsParam = ctx.inlinePropsParam
  const previousUsed = ctx.inlineChildrenUsed
  const previousCount = ctx.inlineChildrenCount
  ctx.currentBlock = blockId
  ctx.inlineChildren = childrenWxml
  ctx.inlinePropsParam = child.propsParam?.name ?? null
  ctx.inlineChildrenUsed = false
  ctx.inlineChildrenCount = 0

  const previousFile = ctx.currentFile
  ctx.currentFile = childFile
  let wxml
  let childrenUsed = false
  let childrenCount = 0
  try {
    wxml = compileNode(child.jsx, ctx, null)
    childrenUsed = ctx.inlineChildrenUsed
    childrenCount = ctx.inlineChildrenCount
  } finally {
    ctx.currentBlock = previousBlock
    ctx.currentFile = previousFile
    ctx.inlineChildren = previousChildren
    ctx.inlinePropsParam = previousPropsParam
    ctx.inlineChildrenUsed = previousUsed
    ctx.inlineChildrenCount = previousCount
  }

  if (hasChildren && !childrenUsed) {
    throw new Error(`<${name}> does not render props.children`)
  }
  if (childrenCount > 1) {
    throw new Error(`<${name}> renders props.children more than once`)
  }

  ctx.inlineComponents.push({ name, source, ...(childFile ? { file: childFile } : {}) })
  committed = true
  return wxml
  } finally {
    ctx.inlineStack.pop()
    if (!committed) {
      ctx.imports = previousImports
      ctx.knownImports = previousKnownImports
      ctx.extraImports.length = previousExtraImports
      ctx.usesWxs = previousWxs
      ctx.usesWxsValue = previousWxsValue
    }
  }
}
