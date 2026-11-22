import * as t from '@babel/types'
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
    propGetters.push({ name: attrName, code: codeOf(expression), expression })
  }

  if (propGetters.length > 0 && !child.propsParam) return null

  const hasChildren = node.children.some((child) => !isWhitespaceText(child))
  if (hasChildren && !child.propsParam) return null
  const childrenWxml = hasChildren ? compileChildren(node.children, ctx, scope) : ''

  if (inLoop) {
    return inlineComponentInLoop(
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
  }

  const blockId = ctx.blocks.length
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
  const wxml = compileNode(child.jsx, ctx, null)
  const childrenUsed = ctx.inlineChildrenUsed
  const childrenCount = ctx.inlineChildrenCount

  ctx.currentBlock = previousBlock
  ctx.currentFile = previousFile
  ctx.inlineChildren = previousChildren
  ctx.inlinePropsParam = previousPropsParam
  ctx.inlineChildrenUsed = previousUsed
  ctx.inlineChildrenCount = previousCount

  if (hasChildren && !childrenUsed) {
    throw new Error(`<${name}> does not render props.children`)
  }
  if (childrenCount > 1) {
    throw new Error(`<${name}> renders props.children more than once`)
  }

  ctx.inlineComponents.push({ name, source, ...(childFile ? { file: childFile } : {}) })
  return wxml
  } finally {
    ctx.inlineStack.pop()
  }
}
