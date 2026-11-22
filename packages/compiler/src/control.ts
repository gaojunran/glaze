import * as t from '@babel/types'
import { codeOf, getAttribute, getExpression, isWhitespaceText } from './ast.ts'
import { conditionExpression } from './attributes.ts'
import { compileChildren, compileNode } from './elements.ts'
import {
  callbackBody,
  inferKeyedField,
  inlineExpression,
  mergeAliases,
  patternAliases,
  rewriteAccessorCalls,
} from './scope.ts'
import type { AnyNode, CompilerContext, Scope } from './types.ts'

export function compileConditional(test, consequent, alternate, ctx, scope) {
  const condition = conditionExpression(test, ctx, scope)
  const guard = scope ? null : codeOf(test)
  const thenNode = ctx.withGuard(guard, () =>
    compileNode(consequent, ctx, scope, [`wx:if="{{${condition}}}"`]),
  )
  if (!alternate) return thenNode
  const elseNode = ctx.withGuard(guard ? `!(${guard})` : null, () =>
    compileNode(alternate, ctx, scope, ['wx:else']),
  )
  return `${thenNode}${elseNode}`
}

export function compileCallbackBranch(fn, label, when, keyed, ctx, scope, directive) {
  const firstParam = fn.params[0]
  const destructured = t.isObjectPattern(firstParam) || t.isArrayPattern(firstParam)
  if (destructured && !keyed) {
    throw new Error(`Destructuring a ${label} value requires keyed`)
  }
  const param = destructured
    ? '__glazeValue'
    : t.isIdentifier(firstParam)
      ? firstParam.name
      : 'value'
  const callback = callbackBody(fn, label, [param])
  const aliases = mergeAliases(
    destructured ? patternAliases(firstParam, [param]) : null,
    callback.aliases,
  )
  const body = callback.jsx
  if (!t.isJSXElement(body) && !t.isJSXFragment(body)) {
    throw new Error(`${label} callback must return JSX`)
  }

  const whenCode = scope ? inlineExpression(when, scope, ctx) : codeOf(when)
  const jsWhenCode = scope ? codeOf(rewriteAccessorCalls(when, scope, true)) : codeOf(when)
  const condition = scope ? whenCode : `b${ctx.addBinding(when)}`
  const indexName = scope ? `__glazeIndex${scope.level + 1}` : '__glazeIndex'

  if (!keyed) {
    const itemScope = {
      item: param,
      itemAst: scope
        ? rewriteAccessorCalls(when, scope)
        : t.identifier(condition),
      eventItem: `__glazeValue${scope ? scope.level + 1 : ''}`,
      index: indexName,
      source: `[(${whenCode})]`,
      jsSource: `[(${jsWhenCode})]`,
      direct: jsWhenCode,
      directKey: scope ? null : condition,
      parent: scope,
      level: scope ? scope.level + 1 : 0,
      itemAccessor: true,
      indexAccessor: false,
      aliases,
    }
    const content = ctx.withGuard(scope ? null : codeOf(when), () =>
      compileNode(body, ctx, itemScope),
    )
    return `<block ${directive}="{{${condition}}}">${content}</block>`
  }

  const itemName = destructured
    ? scope
      ? `__glazeValue${scope.level + 1}`
      : '__glazeValue'
    : param
  const itemScope = {
    item: itemName,
    index: indexName,
    source: `[(${whenCode})]`,
    jsSource: `[(${jsWhenCode})]`,
    parent: scope,
    level: scope ? scope.level + 1 : 0,
    itemAccessor: false,
    indexAccessor: false,
    aliases,
  }
  const content = compileNode(body, ctx, itemScope)
  let valuesExpr
  if (scope) {
    ctx.addWxs()
    valuesExpr = `glazeRange.single(${whenCode})`
  } else {
    const values = ctx.addBindingCode(`[(${whenCode})]`)
    valuesExpr = `b${values}`
  }
  const loop = `<block wx:for="{{${valuesExpr}}}" wx:for-item="${itemName}" wx:for-index="${indexName}" wx:key="*this">${content}</block>`
  return `<block ${directive}="{{${condition}}}">${loop}</block>`
}

export function compileShowCallback(node, ctx, scope, when, keyed, fn, fallback) {
  const thenNode = compileCallbackBranch(fn, '<Show>', when, keyed, ctx, scope, 'wx:if')
  if (!fallback) return thenNode
  const guard = scope ? null : `!(${codeOf(when)})`
  const elseNode = ctx.withGuard(guard, () =>
    compileNode(fallback, ctx, scope, ['wx:else']),
  )
  return `${thenNode}${elseNode}`
}

export function compileAsyncBoundary(node, ctx, scope, kind) {
  if (scope) throw new Error(`<${kind}> inside a loop is not supported yet`)
  if (getAttribute(node, 'on')) throw new Error(`<${kind}> does not support the "on" prop yet`)
  const fallbackAttr = getAttribute(node, 'fallback')
  const fallback = getExpression(fallbackAttr)
  if (kind === 'Errored' && !fallback) throw new Error('<Errored> requires a fallback')
  if (kind === 'Errored') ctx.usesErrorBoundary = true

  const outerBoundary = ctx.currentAsyncBoundary
  const boundary = ctx.nextAsyncBoundary
  ctx.nextAsyncBoundary += 1

  const isFunctionFallback =
    fallback && (t.isArrowFunctionExpression(fallback) || t.isFunctionExpression(fallback))
  if (
    fallback &&
    !isFunctionFallback &&
    !t.isJSXElement(fallback) &&
    !t.isJSXFragment(fallback)
  ) {
    throw new Error(`<${kind}> fallback must be JSX or a function returning JSX`)
  }
  if (isFunctionFallback && kind !== 'Errored') {
    throw new Error('<Loading> fallback must be JSX')
  }
  if (isFunctionFallback && fallback.params.length > 1) {
    throw new Error('<Errored> fallback reset is not supported yet')
  }

  let fallbackContent = ''
  if (fallback && isFunctionFallback) {
    const param = fallback.params[0]
    if (!param || !t.isIdentifier(param)) {
      throw new Error('<Errored> fallback must take an error accessor')
    }
    const callback = callbackBody(fallback, '<Errored>', [param.name])
    if (!t.isJSXElement(callback.jsx) && !t.isJSXFragment(callback.jsx)) {
      throw new Error('<Errored> fallback function must return JSX')
    }
    const values = ctx.addBindingCode(`ctx.errorArray(${boundary})`)
    const errorScope = {
      item: param.name,
      index: '__glazeErrorIndex',
      source: `b${values}`,
      jsSource: `b${values}`,
      parent: null,
      level: 0,
      itemAccessor: true,
      indexAccessor: false,
      aliases: callback.aliases,
    }
    fallbackContent = `<block wx:for="{{b${values}}}" wx:for-item="${param.name}" wx:for-index="__glazeErrorIndex" wx:key="*this">${compileNode(callback.jsx, ctx, errorScope)}</block>`
  } else if (fallback) {
    // The fallback and the boundary's own condition belong to the enclosing
    // boundary; only the children are governed by this one. That lets nested
    // Loading boundaries show their own fallback without outer pending state
    // hiding the inner one.
    fallbackContent = compileNode(fallback, ctx, scope)
  }
  const index = ctx.addBindingCode(
    kind === 'Loading' ? `ctx.loading(${boundary})` : `ctx.errored(${boundary})`,
  )
  ctx.currentAsyncBoundary = boundary
  const children = compileChildren(node.children, ctx, scope)
  ctx.currentAsyncBoundary = outerBoundary

  const condition = kind === 'Loading' && !fallback ? `!b${index}` : `b${index}`
  if (!fallback) return `<block wx:if="{{${condition}}}">${children}</block>`
  return `<block wx:if="{{${condition}}}">${fallbackContent}</block><block wx:else>${children}</block>`
}

export function compileShow(node, ctx, scope) {
  const when = getExpression(getAttribute(node, 'when'))
  if (!when) throw new Error('<Show> requires a when expression')
  const keyedAttr = getAttribute(node, 'keyed')
  let keyed = false
  if (keyedAttr) {
    const keyedExpression = getExpression(keyedAttr)
    if (!t.isBooleanLiteral(keyedExpression)) {
      throw new Error('<Show> keyed must be a boolean')
    }
    keyed = keyedExpression.value
  }
  const fallback = getExpression(getAttribute(node, 'fallback'))
  const children = node.children.filter((child) => !isWhitespaceText(child))
  if (children.length === 0) throw new Error('<Show> requires a child')

  if (
    children.length === 1 &&
    t.isJSXExpressionContainer(children[0]) &&
    (t.isArrowFunctionExpression(children[0].expression) ||
      t.isFunctionExpression(children[0].expression))
  ) {
    return compileShowCallback(node, ctx, scope, when, keyed, children[0].expression, fallback)
  }

  const condition = conditionExpression(when, ctx, scope)
  const guard = scope ? null : codeOf(when)
  const thenNode = ctx.withGuard(guard, () =>
    children.length === 1
      ? compileNode(children[0], ctx, scope, [`wx:if="{{${condition}}}"`])
      : `<block wx:if="{{${condition}}}">${compileChildren(children, ctx, scope)}</block>`,
  )

  if (!fallback) return thenNode
  const elseNode = ctx.withGuard(guard ? `!(${guard})` : null, () =>
    compileNode(fallback, ctx, scope, ['wx:else']),
  )
  return `${thenNode}${elseNode}`
}

export function compileSwitch(node, ctx, scope) {
  const children = node.children.filter((child) => !isWhitespaceText(child))
  const matches = children.filter(
    (child) => t.isJSXElement(child) && t.isJSXIdentifier(child.openingElement.name, { name: 'Match' }),
  )
  if (matches.length !== children.length) {
    throw new Error('<Switch> accepts only <Match> children and a fallback prop')
  }
  if (matches.length === 0) {
    const emptyFallback = getAttribute(node, 'fallback')
    if (!emptyFallback) throw new Error('<Switch> requires a <Match> or fallback')
    const expression = getExpression(emptyFallback)
    if (!expression || (!t.isJSXElement(expression) && !t.isJSXFragment(expression))) {
      throw new Error('<Switch> fallback must be JSX')
    }
    return compileNode(expression, ctx, scope)
  }

  const whenCodes = matches.map((match) => {
    const when = getExpression(getAttribute(match, 'when'))
    if (!when) throw new Error('<Match> requires a when expression')
    return codeOf(when)
  })
  let output = ''
  matches.forEach((match, index) => {
    const when = getExpression(getAttribute(match, 'when'))
    if (!when) throw new Error('<Match> requires a when expression')
    const keyedAttr = getAttribute(match, 'keyed')
    let keyed = false
    if (keyedAttr) {
      const keyedExpression = getExpression(keyedAttr)
      if (!t.isBooleanLiteral(keyedExpression)) {
        throw new Error('<Match> keyed must be a boolean')
      }
      keyed = keyedExpression.value
    }
    const body = match.children.filter((child) => !isWhitespaceText(child))
    if (body.length === 0) throw new Error('<Match> requires a child')

    const callback =
      body.length === 1 &&
      t.isJSXExpressionContainer(body[0]) &&
      (t.isArrowFunctionExpression(body[0].expression) ||
        t.isFunctionExpression(body[0].expression))
        ? body[0].expression
        : null
    if (callback) {
      const directive = index === 0 ? 'wx:if' : 'wx:elif'
      output += compileCallbackBranch(callback, '<Match>', when, keyed, ctx, scope, directive)
      return
    }

    const condition = conditionExpression(when, ctx, scope)
    const directive = index === 0 ? `wx:if="{{${condition}}}"` : `wx:elif="{{${condition}}}"`
    const guard = scope
      ? null
      : [whenCodes[index], ...whenCodes.slice(0, index).map((item) => `!(${item})`)]
          .map((item) => `(${item})`)
          .join(' && ')
    output += ctx.withGuard(guard, () =>
      body.length === 1
        ? compileNode(body[0], ctx, scope, [directive])
        : `<block ${directive}>${compileChildren(body, ctx, scope)}</block>`,
    )
  })

  const fallback = getAttribute(node, 'fallback')
  if (fallback) {
    const expression = getExpression(fallback)
    if (!expression || (!t.isJSXElement(expression) && !t.isJSXFragment(expression))) {
      throw new Error('<Switch> fallback must be JSX')
    }
    const guard = scope
      ? null
      : whenCodes.map((item) => `!(${item})`).join(' && ')
    output += ctx.withGuard(guard, () =>
      compileNode(expression, ctx, scope, ['wx:else']),
    )
  }

  return output
}

export function compileFor(node, ctx, scope) {
  const each = getExpression(getAttribute(node, 'each'))
  if (!each) throw new Error('<For> requires an each expression')

  const keyAttr = getAttribute(node, 'key')
  const keyedAttr = getAttribute(node, 'keyed')
  let keyed: boolean | 'fn' = true
  let keyedField: string | null = null
  if (keyedAttr) {
    const keyedExpression = getExpression(keyedAttr)
    if (t.isBooleanLiteral(keyedExpression)) {
      keyed = keyedExpression.value
    } else if (
      t.isArrowFunctionExpression(keyedExpression) ||
      t.isFunctionExpression(keyedExpression)
    ) {
      keyed = 'fn'
      keyedField = inferKeyedField(keyedExpression)
      if (!keyedField) {
        throw new Error('<For> keyed function must return a single field, e.g. (item) => item.id')
      }
    } else {
      throw new Error('<For> keyed must be a boolean or a function')
    }
  }

  let key = null
  if (keyAttr) {
    if (keyAttr.value && t.isStringLiteral(keyAttr.value)) key = keyAttr.value.value
    else throw new Error('<For> key must be a string literal in the first compiler wave')
  } else if (keyed === false) {
    key = null
  } else if (keyedField) {
    key = keyedField
  }

  const eachCode = scope ? inlineExpression(each, scope, ctx) : codeOf(each)
  const eachExpr = scope ? eachCode : `b${ctx.addBinding(each, key)}`
  const jsEachCode = scope ? codeOf(rewriteAccessorCalls(each, scope, true)) : codeOf(each)

  const childNodes = node.children.filter((item) => !isWhitespaceText(item))
  if (childNodes.length !== 1 || !t.isJSXExpressionContainer(childNodes[0])) {
    throw new Error('<For> requires exactly one arrow-function child')
  }
  const child = childNodes[0]
  const fn = child.expression
  if (!t.isArrowFunctionExpression(fn) && !t.isFunctionExpression(fn)) {
    throw new Error('<For> child must be an arrow function')
  }
  const itemAccessor = keyed === false || keyed === 'fn'
  const firstParam = fn.params[0]
  const destructured = t.isObjectPattern(firstParam) || t.isArrayPattern(firstParam)
  if (destructured && itemAccessor) {
    throw new Error('Destructuring a <For> item requires keyed=true')
  }
  const itemName = destructured
    ? scope
      ? `__glazeItem${scope.level + 1}`
      : '__glazeItem'
    : t.isIdentifier(firstParam)
      ? firstParam.name
      : 'item'
  const indexName = t.isIdentifier(fn.params[1])
    ? fn.params[1].name
    : scope
      ? `__glazeIndex${scope.level + 1}`
      : '__glazeIndex'
  const callback = callbackBody(fn, '<For>', [itemName, indexName])
  const aliases = mergeAliases(
    destructured ? patternAliases(firstParam, [itemName]) : null,
    callback.aliases,
  )
  const body = callback.jsx

  if (!t.isJSXElement(body) && !t.isJSXFragment(body)) {
    throw new Error('<For> callback must return JSX')
  }

  for (let cursor = scope; cursor; cursor = cursor.parent) {
    if (cursor.item === itemName || cursor.index === indexName) {
      throw new Error(
        `Nested <For> must use distinct item and index names (${itemName}, ${indexName})`,
      )
    }
  }

  const itemScope = {
    item: itemName,
    index: indexName,
    source: eachCode,
    jsSource: jsEachCode,
    parent: scope,
    level: scope ? scope.level + 1 : 0,
    itemAccessor,
    indexAccessor: keyed !== false,
    aliases,
  }
  const children = compileNode(body, ctx, itemScope)
  const keyAttrCode = key ? ` wx:key="${key}"` : ''
  const loop = `<block wx:for="{{${eachExpr}}}" wx:for-item="${itemName}" wx:for-index="${indexName}"${keyAttrCode}>${children}</block>`

  const fallback = getAttribute(node, 'fallback')
  if (!fallback) return loop
  const fallbackExpression = getExpression(fallback)
  if (
    !fallbackExpression ||
    (!t.isJSXElement(fallbackExpression) && !t.isJSXFragment(fallbackExpression))
  ) {
    throw new Error('<For> fallback must be JSX')
  }
  const condition = scope
    ? `(${eachCode} || []).length > 0`
    : `b${ctx.addBindingCode(`(${eachCode} || []).length > 0`)}`
  const fallbackGuard = scope ? null : `(${codeOf(each)} || []).length === 0`
  return `<block wx:if="{{${condition}}}">${loop}</block>${ctx.withGuard(
    fallbackGuard,
    () => compileNode(fallbackExpression, ctx, scope, ['wx:else']),
  )}`
}

export function compileRepeatInScope(node, ctx, scope) {
  const count = getExpression(getAttribute(node, 'count'))
  if (!count) throw new Error('<Repeat> requires a count expression')
  const from = getExpression(getAttribute(node, 'from'))
  const countCode = inlineExpression(count, scope, ctx)
  const fromCode = from ? inlineExpression(from, scope, ctx) : '0'
  const childNodes = node.children.filter((item) => !isWhitespaceText(item))
  if (childNodes.length !== 1 || !t.isJSXExpressionContainer(childNodes[0])) {
    throw new Error('<Repeat> requires exactly one arrow-function child')
  }
  const child = childNodes[0]
  const fn = child.expression
  if (!t.isArrowFunctionExpression(fn) && !t.isFunctionExpression(fn)) {
    throw new Error('<Repeat> child must be an arrow function')
  }
  const param = t.isIdentifier(fn.params[0]) ? fn.params[0].name : 'index'
  const itemName = `__glazeRepeat${scope.level + 1}`
  const indexName = `__glazeIndex${scope.level + 1}`
  const aliases = { [param]: [itemName] }
  const body = t.isBlockStatement(fn.body)
    ? (() => {
        const ret = fn.body.body.find((item) => t.isReturnStatement(item))
        if (!ret) throw new Error('<Repeat> callback must return JSX')
        return ret.argument
      })()
    : fn.body
  if (!t.isJSXElement(body) && !t.isJSXFragment(body)) {
    throw new Error('<Repeat> callback must return JSX')
  }

  ctx.addWxs()
  const itemScope = {
    item: itemName,
    index: indexName,
    source: null,
    jsSource: null,
    offset: fromCode,
    parent: scope,
    level: scope.level + 1,
    itemAccessor: false,
    indexAccessor: false,
    isIndexRepeat: true,
    aliases,
  }
  const children = compileNode(body, ctx, itemScope)
  const loop = `<block wx:for="{{glazeRange.range(${countCode}, ${fromCode})}}" wx:for-item="${itemName}" wx:for-index="${indexName}" wx:key="*this">${children}</block>`
  const fallback = getAttribute(node, 'fallback')
  if (!fallback) return loop
  const fallbackExpression = getExpression(fallback)
  if (
    !fallbackExpression ||
    (!t.isJSXElement(fallbackExpression) && !t.isJSXFragment(fallbackExpression))
  ) {
    throw new Error('<Repeat> fallback must be JSX')
  }
  return `<block wx:if="{{${countCode} > 0}}">${loop}</block>${ctx.withGuard(
    scope ? null : `!(${codeOf(count)} > 0)`,
    () => compileNode(fallbackExpression, ctx, scope, ['wx:else']),
  )}`
}

export function compileRepeat(node, ctx, scope) {
  if (scope) return compileRepeatInScope(node, ctx, scope)
  const count = getExpression(getAttribute(node, 'count'))
  if (!count) throw new Error('<Repeat> requires a count expression')
  const from = getExpression(getAttribute(node, 'from'))
  const fromCode = from ? codeOf(from) : '0'

  const childNodes = node.children.filter((item) => !isWhitespaceText(item))
  if (childNodes.length !== 1 || !t.isJSXExpressionContainer(childNodes[0])) {
    throw new Error('<Repeat> requires exactly one arrow-function child')
  }
  const child = childNodes[0]
  const fn = child.expression
  if (!t.isArrowFunctionExpression(fn) && !t.isFunctionExpression(fn)) {
    throw new Error('<Repeat> child must be an arrow function')
  }
  const itemName = t.isIdentifier(fn.params[0]) ? fn.params[0].name : 'index'
  const body = t.isBlockStatement(fn.body)
    ? (() => {
        const ret = fn.body.body.find((item) => t.isReturnStatement(item))
        if (!ret) throw new Error('<Repeat> callback must return JSX')
        return ret.argument
      })()
    : fn.body
  if (!t.isJSXElement(body) && !t.isJSXFragment(body)) {
    throw new Error('<Repeat> callback must return JSX')
  }

  const binding = ctx.addBindingCode(
    `Array.from({ length: (${codeOf(count)}) }, (_, index) => index + (${fromCode}))`,
  )
  const itemScope = {
    item: itemName,
    index: '__glazeIndex',
    source: `b${binding}`,
    jsSource: `Array.from({ length: (${codeOf(count)}) }, (_, index) => index + (${fromCode}))`,
    parent: null,
    level: 0,
  }
  const children = compileNode(body, ctx, itemScope)
  const loop = `<block wx:for="{{b${binding}}}" wx:for-item="${itemName}" wx:for-index="__glazeIndex" wx:key="*this">${children}</block>`

  const fallback = getAttribute(node, 'fallback')
  if (!fallback) return loop
  const fallbackExpression = getExpression(fallback)
  if (
    !fallbackExpression ||
    (!t.isJSXElement(fallbackExpression) && !t.isJSXFragment(fallbackExpression))
  ) {
    throw new Error('<Repeat> fallback must be JSX')
  }
  return `<block wx:if="{{b${binding}.length > 0}}">${loop}</block>${ctx.withGuard(
    `!(${codeOf(count)} > 0)`,
    () => compileNode(fallbackExpression, ctx, scope, ['wx:else']),
  )}`
}
