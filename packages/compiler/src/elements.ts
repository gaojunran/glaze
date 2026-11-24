import * as t from '@babel/types'
import {
  CONTEXT_PROP,
  PAGE_PROP,
  bindingKey,
  dataIndexAttr,
  eventHandlerName,
  kebabCase,
  refId,
} from '@glaze/shared'
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
  tagName,
  unwrapTs,
  wxmlCodeOf,
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
import { BUILTIN_TAGS, STRUCTURED_PROPS } from './constants.ts'
import {
  EVENT_MAP,
  NATIVE_EVENT_PROPS,
  eventAttrFor,
  eventNameFor,
  splitEventBinding,
} from './events.ts'
import { inlineComponent } from './inline.ts'
import { projectExpression } from './projection.ts'
import { isGroupableProp } from './props.ts'
import { inlineExpression } from './scope.ts'
import type { AnyNode, CompilerContext, Scope } from './types.ts'

export function pushScopeIndexAttrs(attrs, scope) {
  for (let cursor = scope; cursor; cursor = cursor.parent) {
    if (cursor.direct) continue
    const attr = dataIndexAttr(cursor.level)
    const generated = `${attr}="{{${cursor.index}}}"`
    const existing = attrs.find((item) => item.startsWith(`${attr}=`))
    if (!existing) attrs.push(generated)
    else if (existing !== generated) {
      throw new Error(`"${attr}" is reserved by Glaze for loop index restoration`)
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

/**
 * Compile the tail every dynamic attribute shares: a projected prop
 * expression, a loop inline expression, or a binding. `expr` is the same WXML
 * expression for contexts (structured props) that need it separately.
 */
function emitAttrValue(expression, ctx, scope): { value: string; expr: string } {
  const projected = projectExpression(expression, ctx, scope)
  if (projected != null) return { value: projected, expr: projected }
  if (scope) {
    const inline = inlineExpression(expression, scope, ctx)
    return { value: inline, expr: inline }
  }
  const index = ctx.addBinding(expression)
  return { value: bindingKey(index), expr: bindingKey(index) }
}

/** Register a handler and write its event attribute and loop index attrs. */
function emitEventAttr(attrs, scope, ctx, binding, eventName: string, expression, custom: boolean) {
  const index = ctx.addEvent(expression, scope, custom)
  attrs.push(`${eventAttrFor(binding.kind, eventName, custom)}="${eventHandlerName(index)}"`)
  pushScopeIndexAttrs(attrs, scope)
}

function emitTag(tag: string, attrs: string[], children: string) {
  const attrText = attrs.length > 0 ? ` ${attrs.join(' ')}` : ''
  if (children === '') return `<${tag}${attrText} />`
  return `<${tag}${attrText}>${children}</${tag}>`
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
      (ctx.importedContexts.has(name) && getAttribute(node, 'value')))
  ) {
    return wrapDirectives(compileProvider(node, ctx, scope), extraAttrs)
  }
  if ((name === 'Loading' || name === 'Errored') && ctx.imports.get(name) === 'solid-js') {
    return wrapDirectives(compileAsyncBoundary(node, ctx, scope, name), extraAttrs)
  }
  const controlSource = ctx.imports.get(name)
  const isControl =
    controlSource === 'solid-js' ||
    (controlSource === undefined &&
      !ctx.knownImports.has(name) &&
      !ctx.localNames.has(name))
  if (isControl) {
    if (name === 'Show') return wrapDirectives(compileShow(node, ctx, scope), extraAttrs)
    if (name === 'For') return wrapDirectives(compileFor(node, ctx, scope), extraAttrs)
    if (name === 'Switch') return wrapDirectives(compileSwitch(node, ctx, scope), extraAttrs)
    if (name === 'Repeat') return wrapDirectives(compileRepeat(node, ctx, scope), extraAttrs)
    if (name === 'Match') {
      throw new Error('<Match> must be a direct child of <Switch>')
    }
  }
  if (name === 'slot') {
    const slotName = getAttribute(node, 'name')
    const value = slotName && slotName.value && t.isStringLiteral(slotName.value)
      ? slotName.value.value
      : null
    if (slotName && !value) {
      throw new Error('Named slot requires a string literal name')
    }
    if (value) ctx.namedSlots.add(value)
    else ctx.usesSlot = true
  }
  if (/^[A-Z]/.test(name)) {
    return compileComponentElement(node, ctx, scope, extraAttrs)
  }

  const attributes = expandAttributes(node.openingElement.attributes)
  const attrs = []
  for (const attr of attributes) {
    if (!t.isJSXAttribute(attr)) {
      throw new Error('JSX spread attributes are not supported')
    }
    const attrName = t.isJSXIdentifier(attr.name)
      ? attr.name.name
      : t.isJSXNamespacedName(attr.name)
        ? `${attr.name.namespace.name}:${attr.name.name.name}`
        : null
    if (!attrName) throw new Error('Unsupported JSX attribute name')
    if (attrName === 'key') continue
    if (attrName === 'ref') {
      if (scope || ctx.refForbidden > 0) {
        throw new Error('ref inside <For>, <Show> or <Match> is not supported yet')
      }
      if (
        attributes.some(
          (item) => t.isJSXAttribute(item) && t.isJSXIdentifier(item.name, { name: 'id' }),
        )
      ) {
        throw new Error('An element with ref cannot also set id')
      }
      const expression = getExpression(attr)
      if (!expression) throw new Error('ref requires a callback')
      if (containsJsx(expression)) throw new Error('ref cannot be JSX')
      const index = ctx.addRef(expression)
      attrs.push(`id="${refId(index)}"`)
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
      emitEventAttr(attrs, scope, ctx, binding, EVENT_MAP[binding.base], expression, false)
      continue
    }

    if (attrName === 'innerHTML' || attrName === 'textContent') {
      throw new Error(`"${attrName}" is not supported; render child nodes instead`)
    }
    // Native WXML attributes are kebab-case. Event names were handled above;
    // component props keep their own lowercasing rule below.
    const propName = attrName === 'className' ? 'class' : kebabCase(attrName)
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

    const value = emitAttrValue(expression, ctx, scope).value
    attrs.push(`${propName}="{{${value}}}"`)
  }

  return emitTag(name, [...attrs, ...extraAttrs], compileChildren(node.children, ctx, scope))
}

export function compileComponentElement(node, ctx, scope, extraAttrs = []) {
  const name = tagName(node.openingElement.name)
  if (BUILTIN_TAGS.has(kebabCase(name))) {
    throw new Error(
      `Component <${name}> conflicts with the built-in WXML <${kebabCase(name)}> tag; rename the component`,
    )
  }
  const source = ctx.imports.get(name)
  if (!source) {
    throw new Error(`Component <${name}> must be imported from a relative file`)
  }
  if (!source.startsWith('.')) {
    throw new Error(`Component <${name}> must come from a relative file, got "${source}"`)
  }
  const inlined = inlineComponent(node, ctx, scope, name, source)
  if (inlined != null) return wrapDirectives(inlined, extraAttrs)

  const child = resolveComponentInfo(name, source, ctx)
  ctx.addComponent(name, source, ctx.currentFile)

  const attrs = []
  const scalarProps: Array<{ name: string; attr: string; expr: string; group: boolean }> = []
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
    attrs.push(`${CONTEXT_PROP}="{{${bindingKey(index)}}}"`)
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
    if (attrName === 'children') {
      throw new Error(`Pass children to <${name}> as JSX children, not as a "children" prop`)
    }
    if (/^on[A-Z]/.test(attrName)) {
      const binding = splitEventBinding(attrName) ?? { base: attrName, kind: 'bind' }
      if (NATIVE_EVENT_PROPS.has(binding.base)) {
        throw new Error(
          `Component event "${attrName}" collides with the native "${EVENT_MAP[binding.base]}" event; rename the custom event, e.g. "onPick${binding.base.slice(2)}"`,
        )
      }
      const expression = getExpression(attr)
      if (expression == null) continue
      if (containsJsx(expression)) {
        throw new Error(`Event handler "${attrName}" cannot be JSX`)
      }
      emitEventAttr(attrs, scope, ctx, binding, eventNameFor(binding.base), expression, true)
      continue
    }
    // data-* and aria-* pass through to the component host element. They are
    // not props or events, so the child never declares or observes them.
    if (/^(data|aria)-[A-Za-z0-9_-]+$/.test(attrName)) {
      const expression = getExpression(attr)
      if (expression == null) continue
      if (containsJsx(expression)) {
        throw new Error(`Attribute "${attrName}" cannot be JSX`)
      }
      if (t.isStringLiteral(expression) || t.isNumericLiteral(expression)) {
        attrs.push(`${attrName}="${escapeAttr(String(expression.value))}"`)
      } else {
        attrs.push(`${attrName}="{{${emitAttrValue(expression, ctx, scope).value}}}"`)
      }
      continue
    }
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(attrName)) {
      throw new Error(`Component prop "${attrName}" must be a valid identifier`)
    }
    if (attrName.toLowerCase() === STRUCTURED_PROPS) {
      throw new Error(`"${STRUCTURED_PROPS}" is reserved for compiled component props`)
    }
    if (attrName.toLowerCase() === CONTEXT_PROP) {
      throw new Error(`"${CONTEXT_PROP}" is reserved for compiled context props`)
    }
    if (attrName.toLowerCase() === PAGE_PROP) {
      throw new Error(`"${PAGE_PROP}" is reserved for compiled page context`)
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
    // One predicate decides what the compact object carries; see ./props.ts.
    const group = isGroupableProp(propName)
    if (t.isStringLiteral(expression)) {
      const value = staticAssetAttr(propName, expression.value, ctx) ?? expression.value
      scalarProps.push({
        name: propName,
        attr: `${propName}="${escapeAttr(value)}"`,
        expr: wxmlCodeOf(t.stringLiteral(value)),
        group,
      })
      continue
    }
    if (t.isNumericLiteral(expression)) {
      scalarProps.push({
        name: propName,
        attr: `${propName}="{{${expression.value}}}"`,
        expr: wxmlCodeOf(expression),
        group,
      })
      continue
    }
    const { value, expr } = emitAttrValue(expression, ctx, scope)
    scalarProps.push({
      name: propName,
      attr: `${propName}="{{${value}}}"`,
      expr,
      group,
    })
  }

  if (ctx.pageContext && child?.pageContext === true) {
    attrs.push(`${PAGE_PROP}="{{${PAGE_PROP}}}"`)
  }

  const grouped = scalarProps.filter((prop) => prop.group)
  if (grouped.length >= 2 && child?.structuredProps === true) {
    attrs.push(
      `${STRUCTURED_PROPS}="{{ {${grouped.map((prop) => `${prop.name}: ${prop.expr}`).join(', ')}} }}"`,
    )
    for (const prop of scalarProps) if (!prop.group) attrs.push(prop.attr)
  } else {
    for (const prop of scalarProps) attrs.push(prop.attr)
  }

  return emitTag(
    kebabCase(name),
    [...attrs, ...extraAttrs],
    compileChildren(node.children, ctx, scope),
  )
}

function resolveComponentInfo(name, source, ctx) {
  const resolved = ctx.resolveComponent?.(name, source, ctx.currentFile ?? undefined)
  if (typeof resolved === 'string') return { source: resolved }
  return resolved && typeof resolved === 'object' ? resolved : null
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
  ctx.notePropReads(value)
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
    effects: [],
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

function isDefinitelyNonBoolean(node: AnyNode): boolean {
  let current = unwrapTs(node)
  while (t.isParenthesizedExpression(current)) current = unwrapTs(current.expression)
  if (
    t.isStringLiteral(current) ||
    t.isNumericLiteral(current) ||
    t.isNullLiteral(current)
  ) {
    return true
  }
  return (
    t.isConditionalExpression(current) &&
    isDefinitelyNonBoolean(current.consequent) &&
    isDefinitelyNonBoolean(current.alternate)
  )
}

export function compileExpressionChild(expression, ctx, scope) {
  if (t.isJSXEmptyExpression(expression)) return ''
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
  // Solid renders nothing for boolean children; WXML would render the strings
  // "true"/"false" from a raw binding. Only expressions that can evaluate to a
  // boolean need the wrapper; a plain numeric/string binding keeps its shape.
  const booleanish =
    (t.isLogicalExpression(expression) ||
      t.isConditionalExpression(expression) ||
      (t.isUnaryExpression(expression) && expression.operator === '!') ||
      (t.isBinaryExpression(expression) &&
        ['==', '===', '!=', '!==', '<', '<=', '>', '>='].includes(expression.operator))) &&
    !isDefinitelyNonBoolean(expression)
  const projected = projectExpression(expression, ctx, scope)
  if (projected != null) {
    if (booleanish) {
      ctx.addWxsValue()
      return `{{glazeValue.value(${projected})}}`
    }
    return `{{${projected}}}`
  }
  if (scope) {
    if (booleanish) {
      ctx.addWxsValue()
      return `{{glazeValue.value(${inlineExpression(expression, scope, ctx)})}}`
    }
    return `{{${inlineExpression(expression, scope, ctx)}}}`
  }
  if (booleanish) {
    ctx.addHelper('textValue')
    const index = ctx.addBindingCode(`textValue(${codeOf(expression)})`, null, expression)
    return `{{${bindingKey(index)}}}`
  }
  const index = ctx.addBinding(expression)
  return `{{${bindingKey(index)}}}`
}
