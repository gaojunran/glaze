import * as t from '@babel/types'
import { LIST_KEY_WHOLE, bindingKey } from '@glaze/shared'
import {
  codeOf,
  containsJsx,
  getAttribute,
  getExpression,
  isWhitespaceText,
  renameIdentifiers,
} from './ast.ts'
import { conditionExpression } from './attributes.ts'
import { projectExpression } from './projection.ts'
import { compileChildren, compileNode } from './elements.ts'
import {
  callbackBody,
  inferKeyedField,
  inlineExpression,
  makeCallbackScope,
  makeLoopScope,
  mergeAliases,
  patternAliases,
  rewriteAccessorCalls,
} from './scope.ts'
import { PAGE_PROP, STRUCTURED_PROPS } from './constants.ts'

const assertScopeName = (name: string, label: string) => {
  if (name === STRUCTURED_PROPS) {
    throw new Error(`${label} parameter may not use "${STRUCTURED_PROPS}"`)
  }
  if (name === PAGE_PROP) {
    throw new Error(`${label} parameter may not use "${PAGE_PROP}"`)
  }
}
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
  assertScopeName(param, label)
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
  const condition = scope ? whenCode : bindingKey(ctx.addBinding(when))
  const indexName = scope ? `__glazeIndex${scope.level + 1}` : '__glazeIndex'

  if (!keyed) {
    const itemScope = makeCallbackScope({
      item: param,
      itemAst: scope ? rewriteAccessorCalls(when, scope) : t.identifier(condition),
      eventItem: `__glazeValue${scope ? scope.level + 1 : ''}`,
      index: indexName,
      source: `[(${whenCode})]`,
      jsSource: `[(${jsWhenCode})]`,
      direct: jsWhenCode,
      directKey: scope ? undefined : condition,
      parent: scope,
      itemAccessor: true,
      indexAccessor: false,
      aliases,
      listBinding: scope?.listBinding ?? null,
    })
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
  const itemScope = makeCallbackScope({
    item: itemName,
    index: indexName,
    source: `[(${whenCode})]`,
    jsSource: `[(${jsWhenCode})]`,
    parent: scope,
    itemAccessor: false,
    indexAccessor: false,
    aliases,
    listBinding: scope?.listBinding ?? null,
  })
  const content = compileNode(body, ctx, itemScope)
  let valuesExpr
  if (scope) {
    ctx.addWxs()
    valuesExpr = `glazeRange.single(${whenCode})`
  } else {
    const values = ctx.addBindingCode(`[(${whenCode})]`, null, when)
    valuesExpr = bindingKey(values)
  }
  const loop = `<block wx:for="{{${valuesExpr}}}" wx:for-item="${itemName}" wx:for-index="${indexName}" wx:key="*this">${content}</block>`
  return `<block ${directive}="{{${condition}}}">${loop}</block>`
}

export function compileShowCallback(ctx, scope, when, keyed, fn, fallback) {
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
  const onAttr = getAttribute(node, 'on')
  const on = onAttr ? getExpression(onAttr) : null
  if (on && kind !== 'Loading') throw new Error('<Errored> does not support the "on" prop')
  if (on && (containsJsx(on) || t.isJSXElement(on) || t.isJSXFragment(on))) {
    throw new Error('<Loading> on must be a JS expression')
  }
  const fallbackAttr = getAttribute(node, 'fallback')
  const fallback = getExpression(fallbackAttr)
  if (kind === 'Errored' && !fallback) throw new Error('<Errored> requires a fallback')

  const outerLoading = ctx.currentLoadingBoundary
  const outerError = ctx.currentErrorBoundary
  const boundary = ctx.nextAsyncBoundary
  ctx.nextAsyncBoundary += 1
  if (on) {
    ctx.addEffectCode(`ctx.loadingOn(${boundary}, () => (${codeOf(on)}))`, on)
  }

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
  if (isFunctionFallback && fallback.params.length > 2) {
    throw new Error('<Errored> fallback takes at most an error accessor and a reset function')
  }

  let fallbackContent = ''
  if (fallback && isFunctionFallback) {
    const param = fallback.params[0]
    if (!param || !t.isIdentifier(param)) {
      throw new Error('<Errored> fallback must take an error accessor')
    }
    const resetParam = fallback.params[1]
    if (resetParam && !t.isIdentifier(resetParam)) {
      throw new Error('<Errored> reset parameter must be an identifier')
    }
    const resetName = resetParam && t.isIdentifier(resetParam) ? resetParam.name : null
    const resetAlias = resetName ? `__glazeReset${boundary}` : null
    const renamed =
      resetName && resetAlias
        ? renameIdentifiers(fallback, resetName, resetAlias)
        : fallback
    if (resetAlias) {
      ctx.addSetupStatement(
        t.variableDeclaration('const', [
          t.variableDeclarator(
            t.identifier(resetAlias),
            t.arrowFunctionExpression(
              [],
              t.callExpression(
                t.memberExpression(t.identifier('ctx'), t.identifier('reset')),
                [t.numericLiteral(boundary)],
              ),
            ),
          ),
        ]),
      )
    }
    const callback = callbackBody(renamed, '<Errored>', [
      param.name,
      ...(resetAlias ? [resetAlias] : []),
    ])
    assertScopeName(param.name, '<Errored>')
    if (!t.isJSXElement(callback.jsx) && !t.isJSXFragment(callback.jsx)) {
      throw new Error('<Errored> fallback function must return JSX')
    }
    const values = ctx.addBindingCode(`ctx.errorArray(${boundary})`)
    const errorScope = makeCallbackScope({
      item: param.name,
      index: '__glazeErrorIndex',
      source: bindingKey(values),
      jsSource: `ctx.errorArray(${boundary})`,
      parent: null,
      itemAccessor: true,
      indexAccessor: false,
      aliases: callback.aliases,
      listBinding: null,
    })
    fallbackContent = `<block wx:for="{{${bindingKey(values)}}}" wx:for-item="${param.name}" wx:for-index="__glazeErrorIndex" wx:key="${LIST_KEY_WHOLE}">${compileNode(callback.jsx, ctx, errorScope)}</block>`
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
  ctx.asyncStatus.push({
    index,
    kind: kind === 'Loading' ? 'loading' : 'error',
    boundary,
  })
  // A binding can sit under an inner Loading and an outer Errored, or the
  // reverse. Track the nearest boundary per kind so an outer boundary still
  // receives the state its inner counterpart does not handle.
  if (kind === 'Loading') ctx.currentLoadingBoundary = boundary
  else ctx.currentErrorBoundary = boundary
  const children = compileChildren(node.children, ctx, scope)
  ctx.currentLoadingBoundary = outerLoading
  ctx.currentErrorBoundary = outerError

  const condition = kind === 'Loading' && !fallback ? `!${bindingKey(index)}` : bindingKey(index)
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
    return compileShowCallback(ctx, scope, when, keyed, children[0].expression, fallback)
  }

  const condition = conditionExpression(when, ctx, scope)
  const guard = scope ? null : codeOf(when)
  const thenNode = ctx.withRefForbidden(() =>
    ctx.withGuard(guard, () =>
      children.length === 1
        ? compileNode(children[0], ctx, scope, [`wx:if="{{${condition}}}"`])
        : `<block wx:if="{{${condition}}}">${compileChildren(children, ctx, scope)}</block>`,
    ),
  )

  if (!fallback) return thenNode
  const elseNode = ctx.withRefForbidden(() =>
    ctx.withGuard(guard ? `!(${guard})` : null, () =>
      compileNode(fallback, ctx, scope, ['wx:else']),
    ),
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
    output += ctx.withRefForbidden(() =>
      ctx.withGuard(guard, () =>
        body.length === 1
          ? compileNode(body[0], ctx, scope, [directive])
          : `<block ${directive}>${compileChildren(body, ctx, scope)}</block>`,
      ),
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
    output += ctx.withRefForbidden(() =>
      ctx.withGuard(guard, () =>
        compileNode(expression, ctx, scope, ['wx:else']),
      ),
    )
  }

  return output
}

type TagInfo = {
  name: string
  nameEnd: number
  end: number
  closing: boolean
  selfClosing: boolean
}

function readTag(source: string, start: number): TagInfo | null {
  if (source[start] !== '<') return null
  let cursor = start + 1
  const closing = source[cursor] === '/'
  if (closing) cursor++
  const nameStart = cursor
  while (cursor < source.length && /[A-Za-z0-9_:.-]/.test(source[cursor])) cursor++
  const name = source.slice(nameStart, cursor)
  if (!name) return null
  let quote: string | null = null
  for (let index = cursor; index < source.length; index++) {
    const char = source[index]
    if (quote) {
      if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === '>') {
      const head = source.slice(start, index)
      return {
        name,
        nameEnd: cursor,
        end: index + 1,
        closing,
        selfClosing: !closing && /\/\s*$/.test(head),
      }
    }
  }
  return null
}

function hasSingleRootElement(source: string): boolean {
  const first = readTag(source, 0)
  if (!first || first.closing) return false
  if (first.selfClosing) return source.slice(first.end).trim() === ''
  let depth = 1
  let cursor = first.end
  while (cursor < source.length) {
    const next = source.indexOf('<', cursor)
    if (next < 0) return false
    const tag = readTag(source, next)
    if (!tag) return false
    if (tag.closing) depth--
    else if (!tag.selfClosing) depth++
    cursor = tag.end
    if (depth === 0) return source.slice(cursor).trim() === ''
  }
  return false
}

function addLoopAttributes(children: string, attributes: string): string | null {
  const root = readTag(children, 0)
  if (!root || root.closing || !hasSingleRootElement(children)) return null
  const tag = root.name
  if (tag === 'block' || tag === 'slot' || tag === 'wxs' || tag === 'template') return null

  const openingEnd = root.end - 1
  let existing = children.slice(root.nameEnd, openingEnd).trimEnd()
  if (/\swx:for(?:\s|=)/.test(existing)) return null
  const selfClosing = root.selfClosing
  if (selfClosing) existing = existing.replace(/\/\s*$/, '').trimEnd()
  const rest = existing.length > 0 ? `${existing} ` : ' '
  if (selfClosing) return `<${tag}${rest}${attributes} />`

  const closing = `</${tag}>`
  const after = children.slice(root.end)
  if (!after.endsWith(closing)) return null
  const body = after.slice(0, -closing.length)
  return `<${tag}${rest}${attributes}>${body}</${tag}>`
}

export function compileFor(node, ctx, scope) {
  const each = getExpression(getAttribute(node, 'each'))
  if (!each) throw new Error('<For> requires an each expression')

  const keyAttr = getAttribute(node, 'key')
  const keyedAttr = getAttribute(node, 'keyed')
  if (keyAttr && keyedAttr) {
    throw new Error('<For> cannot use both key and keyed')
  }
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
    if (key !== LIST_KEY_WHOLE && (key.includes('.') || key.includes('[') || key.includes(']'))) {
      throw new Error(
        `"${key}" is not a single field key; use keyed={(item) => item.id} instead`,
      )
    }
  } else if (keyed === false) {
    key = null
  } else if (keyedField) {
    key = keyedField
  }

  const projectedEach = projectExpression(each, ctx, scope)
  const eachCode = projectedEach ?? (scope ? inlineExpression(each, scope, ctx) : codeOf(each))
  let listBinding: number | null = null
  let eachExpr = projectedEach
  if (eachExpr == null) {
    if (scope) {
      eachExpr = eachCode
    } else {
      listBinding = ctx.addBinding(each, key)
      eachExpr = bindingKey(listBinding)
      if (key && key !== LIST_KEY_WHOLE) ctx.bindings[listBinding].listFields = [key]
      else if (key === LIST_KEY_WHOLE) ctx.listProjectionBlocked.add(listBinding)
    }
  }
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
  assertScopeName(itemName, '<For> item')
  assertScopeName(indexName, '<For> index')
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

  const itemScope = makeLoopScope({
    item: itemName,
    index: indexName,
    source: eachCode,
    jsSource: jsEachCode,
    parent: scope,
    itemAccessor,
    indexAccessor: keyed !== false,
    aliases,
    listBinding,
  })
  const children = compileNode(body, ctx, itemScope)
  if (listBinding != null) {
    const entry = ctx.bindings[listBinding]
    if (
      !key ||
      key === LIST_KEY_WHOLE ||
      ctx.listProjectionBlocked.has(listBinding) ||
      !entry.listFields ||
      entry.listFields.length === 0
    ) {
      entry.listFields = null
    }
  }
  const keyAttrCode = key ? ` wx:key="${key}"` : ''
  const loopAttributes = `wx:for="{{${eachExpr}}}" wx:for-item="${itemName}" wx:for-index="${indexName}"${keyAttrCode}`
  const loop =
    addLoopAttributes(children, loopAttributes) ??
    `<block ${loopAttributes}>${children}</block>`

  const fallback = getAttribute(node, 'fallback')
  if (!fallback) return loop
  const fallbackExpression = getExpression(fallback)
  if (
    !fallbackExpression ||
    (!t.isJSXElement(fallbackExpression) && !t.isJSXFragment(fallbackExpression))
  ) {
    throw new Error('<For> fallback must be JSX')
  }
  const condition = scope || projectedEach
    ? `(${eachCode} || []).length > 0`
    : bindingKey(ctx.addBindingCode(`(${eachCode} || []).length > 0`))
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
  const itemScope = makeLoopScope({
    item: itemName,
    index: indexName,
    offset: fromCode,
    parent: scope,
    itemAccessor: false,
    indexAccessor: false,
    isIndexRepeat: true,
    aliases,
    listBinding: null,
  })
  const children = compileNode(body, ctx, itemScope)
  const loopAttributes = `wx:for="{{glazeRange.range(${countCode}, ${fromCode})}}" wx:for-item="${itemName}" wx:for-index="${indexName}" wx:key="${LIST_KEY_WHOLE}"`
  const loop = addLoopAttributes(children, loopAttributes) ?? `<block ${loopAttributes}>${children}</block>`
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
    null,
    from ? [count, from] : count,
  )
  const itemScope = makeLoopScope({
    item: itemName,
    index: '__glazeIndex',
    source: bindingKey(binding),
    jsSource: `Array.from({ length: (${codeOf(count)}) }, (_, index) => index + (${fromCode}))`,
    parent: null,
    listBinding: null,
  })
  const children = compileNode(body, ctx, itemScope)
  const loopAttributes = `wx:for="{{${bindingKey(binding)}}}" wx:for-item="${itemName}" wx:for-index="__glazeIndex" wx:key="${LIST_KEY_WHOLE}"`
  const loop = addLoopAttributes(children, loopAttributes) ?? `<block ${loopAttributes}>${children}</block>`

  const fallback = getAttribute(node, 'fallback')
  if (!fallback) return loop
  const fallbackExpression = getExpression(fallback)
  if (
    !fallbackExpression ||
    (!t.isJSXElement(fallbackExpression) && !t.isJSXFragment(fallbackExpression))
  ) {
    throw new Error('<Repeat> fallback must be JSX')
  }
  return `<block wx:if="{{${bindingKey(binding)}.length > 0}}">${loop}</block>${ctx.withGuard(
    `!(${codeOf(count)} > 0)`,
    () => compileNode(fallbackExpression, ctx, scope, ['wx:else']),
  )}`
}
