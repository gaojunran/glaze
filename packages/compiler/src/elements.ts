import * as t from '@babel/types'
import { kebabCase } from '@glaze/shared'
import {
  codeOf,
  containsJsx,
  escapeAttr,
  escapeText,
  expandAttributes,
  getAttribute,
  getExpression,
  isWhitespaceText,
  normalizeText,
  skipChildKey,
  tagName,
} from './ast.ts'
import { classAttr, styleAttr } from './attributes.ts'
import {
  compileAsyncBoundary,
  compileConditional,
  compileFor,
  compileRepeat,
  compileShow,
  compileSwitch,
} from './control.ts'
import { EVENT_MAP, eventAttrFor, eventNameFor, splitEventBinding } from './events.ts'
import { inlineComponent } from './inline.ts'
import { inlineExpression } from './scope.ts'
import type { AnyNode, CompilerContext, Scope } from './types.ts'

export function pushScopeIndexAttrs(attrs, scope) {
  for (let cursor = scope; cursor; cursor = cursor.parent) {
    if (cursor.direct) continue
    const attr = cursor.level === 0 ? 'data-glaze-index' : `data-glaze-index${cursor.level}`
    if (!attrs.some((item) => item.startsWith(`${attr}=`))) {
      attrs.push(`${attr}="{{${cursor.index}}}"`)
    }
  }
}

export const directiveText = (extraAttrs) =>
  extraAttrs.length > 0 ? ` ${extraAttrs.join(' ')}` : ''

export const wrapDirectives = (wxml, extraAttrs) =>
  extraAttrs.length > 0 ? `<block${directiveText(extraAttrs)}>${wxml}</block>` : wxml

export function compileNode(node, ctx, scope, extraAttrs = []) {
  if (t.isJSXElement(node)) return compileElement(node, ctx, scope, extraAttrs)
  if (t.isJSXFragment(node)) {
    const children = compileChildren(node.children, ctx, scope)
    return wrapDirectives(`<block>${children}</block>`, extraAttrs)
  }
  if (t.isJSXText(node)) {
    return wrapDirectives(escapeText(normalizeText(node.value)), extraAttrs)
  }
  if (t.isJSXExpressionContainer(node)) {
    return wrapDirectives(
      compileExpressionChild(node.expression, ctx, scope),
      extraAttrs,
    )
  }
  throw new Error('Unsupported JSX child')
}

const RESOURCE_ATTRIBUTES = new Set(['src', 'poster'])

/**
 * A relative literal in a resource attribute is resolved against the source
 * TSX file and rewritten by the builder once the output directory is known.
 * Remote, data and package-absolute paths stay untouched.
 */
function staticAssetAttr(name, value, ctx) {
  if (!RESOURCE_ATTRIBUTES.has(name)) return null
  if (!value.startsWith('./') && !value.startsWith('../')) return null
  const token = `__GLAZE_ASSET_${ctx.assets.length}__`
  ctx.assets.push({ token, specifier: value, fromFile: ctx.currentFile })
  return token
}

export function compileElement(node, ctx, scope, extraAttrs = []) {
  const tag = node.openingElement.name
  if (
    t.isJSXMemberExpression(tag) &&
    t.isJSXIdentifier(tag.property, { name: 'Provider' })
  ) {
    return wrapDirectives(compileProvider(node, ctx, scope), extraAttrs)
  }
  const name = tagName(tag)
  if (
    t.isJSXIdentifier(tag) &&
    (ctx.contextNames.has(name) ||
      (ctx.contextKeys.get(name)?.imported === true && getAttribute(node, 'value')))
  ) {
    return wrapDirectives(compileProvider(node, ctx, scope), extraAttrs)
  }
  if ((name === 'Loading' || name === 'Errored') && ctx.imports.get(name) === 'solid-js') {
    return wrapDirectives(compileAsyncBoundary(node, ctx, scope, name), extraAttrs)
  }
  if (name === 'Show') return wrapDirectives(compileShow(node, ctx, scope), extraAttrs)
  if (name === 'For') return wrapDirectives(compileFor(node, ctx, scope), extraAttrs)
  if (name === 'Switch') return wrapDirectives(compileSwitch(node, ctx, scope), extraAttrs)
  if (name === 'Repeat') return wrapDirectives(compileRepeat(node, ctx, scope), extraAttrs)
  if (name === 'Match') {
    throw new Error('<Match> must be a direct child of <Switch>')
  }
  if (name === 'slot') {
    const slotName = getAttribute(node, 'name')
    const value = slotName && slotName.value && t.isStringLiteral(slotName.value)
      ? slotName.value.value
      : null
    if (value) ctx.namedSlots.add(value)
    else ctx.usesSlot = true
  }
  if (/^[A-Z]/.test(name)) {
    return compileComponentElement(node, ctx, scope, extraAttrs)
  }

  const attrs = []
  for (const attr of expandAttributes(node.openingElement.attributes)) {
    if (!t.isJSXAttribute(attr)) {
      throw new Error('JSX spread attributes are not supported')
    }
    const attrName = t.isJSXIdentifier(attr.name) ? attr.name.name : null
    if (!attrName) throw new Error('Unsupported JSX attribute name')
    if (attrName === 'key') continue
    if (attrName === 'ref') {
      if (scope) {
        throw new Error('ref inside <For>, <Show> or <Match> is not supported yet')
      }
      if (
        node.openingElement.attributes.some(
          (item) => t.isJSXAttribute(item) && t.isJSXIdentifier(item.name, { name: 'id' }),
        )
      ) {
        throw new Error('An element with ref cannot also set id')
      }
      const expression = getExpression(attr)
      if (!expression) throw new Error('ref requires a callback')
      if (containsJsx(expression)) throw new Error('ref cannot be JSX')
      const index = ctx.addRef(expression)
      attrs.push(`id="glaze-r${index}"`)
      continue
    }

    const expression = getExpression(attr)
    if (expression == null) continue

    if (/^on[A-Z]/.test(attrName)) {
      const binding = splitEventBinding(attrName)
      if (!binding || !EVENT_MAP[binding.base]) {
        throw new Error(`Unsupported event "${attrName}" on a native element`)
      }
      if (containsJsx(expression)) {
        throw new Error(`Event handler "${attrName}" cannot be JSX`)
      }
      const index = ctx.addEvent(expression, scope)
      attrs.push(`${eventAttrFor(binding.kind, EVENT_MAP[binding.base], false)}="e${index}"`)
      pushScopeIndexAttrs(attrs, scope)
      continue
    }

    if (attrName === 'innerHTML' || attrName === 'textContent') {
      throw new Error(`"${attrName}" is not supported; render child nodes instead`)
    }
    const propName = attrName === 'className' ? 'class' : attrName
    if (t.isStringLiteral(expression) || t.isNumericLiteral(expression)) {
      const value = String(expression.value)
      const asset = t.isStringLiteral(expression) ? staticAssetAttr(propName, value, ctx) : null
      attrs.push(`${propName}="${escapeAttr(asset ?? value)}"`)
      continue
    }
    if (propName === 'class' && (t.isObjectExpression(expression) || t.isArrayExpression(expression))) {
      attrs.push(classAttr(expression, ctx, scope))
      continue
    }
    if (propName === 'style' && t.isObjectExpression(expression)) {
      attrs.push(styleAttr(expression, ctx, scope))
      continue
    }

    if (scope) {
      attrs.push(`${propName}="{{${inlineExpression(expression, scope, ctx)}}}"`)
    } else {
      const index = ctx.addBinding(expression)
      attrs.push(`${propName}="{{b${index}}}"`)
    }
  }

  const allAttrs = [...attrs, ...extraAttrs]
  const attrText = allAttrs.length > 0 ? ` ${allAttrs.join(' ')}` : ''
  const children = compileChildren(node.children, ctx, scope)
  if (children === '') return `<${name}${attrText} />`
  return `<${name}${attrText}>${children}</${name}>`
}

export function compileComponentElement(node, ctx, scope, extraAttrs = []) {
  const name = tagName(node.openingElement.name)
  const source = ctx.imports.get(name)
  if (!source) {
    throw new Error(`Component <${name}> must be imported from a relative file`)
  }
  if (!source.startsWith('.')) {
    throw new Error(`Component <${name}> must come from a relative file, got "${source}"`)
  }
  const inlined = inlineComponent(node, ctx, scope, name, source)
  if (inlined != null) return wrapDirectives(inlined, extraAttrs)

  ctx.addComponent(name, source, ctx.currentFile)

  const attrs = []
  if (ctx.activeProviders.length > 0) {
    const local = ctx.activeProviders.filter((provider) => !provider.imported)
    if (local.length > 0) {
      throw new Error(
        `Context ${local[0].name} is local and cannot cross a component boundary; import it from a module`,
      )
    }
    const value = `({ ${ctx.activeProviders
      .map((provider) => `${JSON.stringify(provider.key)}: (${provider.code})`)
      .join(', ')} })`
    const index = ctx.addBindingCode(value)
    attrs.push(`glazecontext="{{b${index}}}"`)
  }
  for (const attr of expandAttributes(node.openingElement.attributes)) {
    if (!t.isJSXAttribute(attr)) {
      throw new Error('JSX spread attributes are not supported')
    }
    const attrName = t.isJSXIdentifier(attr.name) ? attr.name.name : null
    if (!attrName) throw new Error('Unsupported JSX attribute name')
    if (attrName === 'key') continue
    if (attrName === 'ref') {
      throw new Error('ref on a component is not supported yet')
    }
    if (/^on[A-Z]/.test(attrName)) {
      const expression = getExpression(attr)
      if (expression == null) continue
      if (containsJsx(expression)) {
        throw new Error(`Event handler "${attrName}" cannot be JSX`)
      }
      const binding = splitEventBinding(attrName) ?? { base: attrName, kind: 'bind' }
      const index = ctx.addEvent(expression, scope, true)
      attrs.push(
        `${eventAttrFor(binding.kind, eventNameFor(binding.base), true)}="e${index}"`,
      )
      pushScopeIndexAttrs(attrs, scope)
      continue
    }
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(attrName)) {
      throw new Error(`Component prop "${attrName}" must be a valid identifier`)
    }

    const propName = attrName.toLowerCase()
    const expression = getExpression(attr)
    if (expression == null) continue
    if (propName === 'class' && (t.isObjectExpression(expression) || t.isArrayExpression(expression))) {
      attrs.push(classAttr(expression, ctx, scope))
      continue
    }
    if (propName === 'style' && t.isObjectExpression(expression)) {
      attrs.push(styleAttr(expression, ctx, scope))
      continue
    }
    if (t.isStringLiteral(expression)) {
      const asset = staticAssetAttr(propName, expression.value, ctx)
      attrs.push(`${propName}="${escapeAttr(asset ?? expression.value)}"`)
      continue
    }
    if (t.isNumericLiteral(expression)) {
      attrs.push(`${propName}="{{${expression.value}}}"`)
      continue
    }
    if (scope) {
      attrs.push(`${propName}="{{${inlineExpression(expression, scope, ctx)}}}"`)
    } else {
      const index = ctx.addBinding(expression)
      attrs.push(`${propName}="{{b${index}}}"`)
    }
  }

  const allAttrs = [...attrs, ...extraAttrs]
  const attrText = allAttrs.length > 0 ? ` ${allAttrs.join(' ')}` : ''
  const children = compileChildren(node.children, ctx, scope)
  if (children === '') return `<${kebabCase(name)}${attrText} />`
  return `<${kebabCase(name)}${attrText}>${children}</${kebabCase(name)}>`
}

export function compileChildren(children, ctx, scope) {
  return children
    .map((child) => {
      if (isWhitespaceText(child)) return ''
      return compileNode(child, ctx, scope)
    })
    .join('')
}

function isPropsMember(expression, propName, member) {
  return (
    t.isMemberExpression(expression) &&
    t.isIdentifier(expression.object, { name: propName }) &&
    t.isIdentifier(expression.property, { name: member })
  )
}

export function compileProvider(node, ctx, scope) {
  if (scope) {
    throw new Error('<Context.Provider> is not supported inside <For>, <Show> or <Match>')
  }
  const tag = node.openingElement.name
  if (t.isJSXMemberExpression(tag) && !t.isJSXIdentifier(tag.object)) {
    throw new Error('Context provider must be a plain identifier object')
  }
  const valueAttr = getAttribute(node, 'value')
  const value = valueAttr ? getExpression(valueAttr) : null
  if (!value) throw new Error('A Context provider requires a value expression')
  if (containsJsx(value)) {
    throw new Error('A Context provider value cannot be JSX')
  }
  const contextName = t.isJSXMemberExpression(tag) && t.isJSXIdentifier(tag.object)
    ? tag.object.name
    : t.isJSXIdentifier(tag)
      ? tag.name
      : null
  if (!contextName) throw new Error('Unsupported context provider form')
  const contextEntry = ctx.contextKeys.get(contextName)
  if (!contextEntry) {
    throw new Error(`Context provider ${contextName} must be a createContext value or an import`)
  }

  const blockId = ctx.blocks.length
  ctx.blocks.push({
    setup: [],
    propsParam: null,
    propGetters: [],
    provider: ctx.currentProvider,
    providerContext: contextName,
    providerValue: codeOf(value),
  })

  const previous = ctx.currentProvider
  const previousBlock = ctx.currentBlock
  const provider = {
    name: contextName,
    key: contextEntry.key,
    imported: contextEntry.imported,
    code: codeOf(value),
  }
  ctx.activeProviders.push(provider)
  ctx.currentProvider = blockId
  ctx.currentBlock = blockId
  const children = compileChildren(node.children, ctx, scope)
  ctx.activeProviders.pop()
  ctx.currentProvider = previous
  ctx.currentBlock = previousBlock
  return children
}

export function compileExpressionChild(expression, ctx, scope) {
  if (
    ctx.inlineChildren != null &&
    ctx.inlinePropsParam &&
    isPropsMember(expression, ctx.inlinePropsParam, 'children')
  ) {
    ctx.inlineChildrenUsed = true
    ctx.inlineChildrenCount += 1
    return ctx.inlineChildren
  }
  if (
    ctx.inlineChildren == null &&
    ctx.rootPropsParam &&
    isPropsMember(expression, ctx.rootPropsParam, 'children')
  ) {
    ctx.usesSlot = true
    return '<slot />'
  }
  if (t.isJSXElement(expression) || t.isJSXFragment(expression)) {
    return compileNode(expression, ctx, scope)
  }
  if (t.isStringLiteral(expression) || t.isNumericLiteral(expression)) {
    return escapeText(String(expression.value))
  }
  if (t.isBooleanLiteral(expression) || t.isNullLiteral(expression)) {
    return ''
  }
  if (t.isLogicalExpression(expression) && expression.operator === '&&') {
    if (t.isJSXElement(expression.right) || t.isJSXFragment(expression.right)) {
      return compileConditional(expression.left, expression.right, null, ctx, scope)
    }
  }
  if (t.isConditionalExpression(expression)) {
    const { consequent, alternate } = expression
    const isJsx = (node) => t.isJSXElement(node) || t.isJSXFragment(node)
    const isEmpty = (node) =>
      node == null ||
      t.isNullLiteral(node) ||
      (t.isBooleanLiteral(node) && node.value === false) ||
      (t.isIdentifier(node, { name: 'undefined' }))
    if (isJsx(consequent) && isJsx(alternate)) {
      return compileConditional(expression.test, consequent, alternate, ctx, scope)
    }
    if (isJsx(consequent) && isEmpty(alternate)) {
      return compileConditional(expression.test, consequent, null, ctx, scope)
    }
    if (isEmpty(consequent) && isJsx(alternate)) {
      return compileConditional(
        t.unaryExpression('!', expression.test, true),
        alternate,
        null,
        ctx,
        scope,
      )
    }
  }
  if (containsJsx(expression)) {
    throw new Error('JSX values are not supported in expressions; use a JSX branch or child')
  }
  if (scope) return `{{${inlineExpression(expression, scope, ctx)}}}`
  const index = ctx.addBinding(expression)
  return `{{b${index}}}`
}
