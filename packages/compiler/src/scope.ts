import * as t from '@babel/types'
import { codeOf, isStaticPropertyKey, skipChildKey } from './ast.ts'
import type { AnyNode, CompilerContext, Scope } from './types.ts'

export function patternAliases(pattern, base, aliases = {}) {
  if (t.isObjectPattern(pattern)) {
    for (const property of pattern.properties) {
      if (!t.isObjectProperty(property)) {
        throw new Error('Rest elements in destructured For/Show items are not supported')
      }
      const key = t.isIdentifier(property.key)
        ? property.key.name
        : t.isStringLiteral(property.key)
          ? property.key.value
          : null
      if (!key) throw new Error('Destructured item keys must be static')
      const path = [...base, key]
      assignAlias(property.value, path, aliases)
    }
    return aliases
  }
  if (t.isArrayPattern(pattern)) {
    pattern.elements.forEach((element, index) => {
      if (element) assignAlias(element, [...base, index], aliases)
    })
    return aliases
  }
  throw new Error('Unsupported destructuring pattern')
}

export function assignAlias(node, path, aliases) {
  if (t.isIdentifier(node)) {
    aliases[node.name] = path
    return
  }
  if (t.isAssignmentPattern(node)) {
    throw new Error('Destructured defaults are not supported in For/Show callbacks')
  }
  if (t.isObjectPattern(node) || t.isArrayPattern(node)) {
    patternAliases(node, path, aliases)
    return
  }
  throw new Error('Unsupported destructuring pattern')
}

export function aliasValue(name, scope) {
  for (let cursor = scope; cursor; cursor = cursor.parent) {
    if (cursor.aliases?.[name] !== undefined) return cursor.aliases[name]
  }
  return null
}

export function buildMember(path) {
  return path.slice(1).reduce(
    (node, segment) =>
      t.memberExpression(
        node,
        typeof segment === 'number' ? t.numericLiteral(segment) : t.identifier(segment),
        typeof segment === 'number',
      ),
    t.identifier(path[0]),
  )
}

export function callbackBody(fn, label, reserved = []) {
  const aliases = {}
  if (!t.isBlockStatement(fn.body)) return { jsx: fn.body, aliases }

  let returned = false
  let jsx = null
  for (const statement of fn.body.body) {
    if (t.isVariableDeclaration(statement)) {
      if (statement.kind !== 'const') {
        throw new Error(`${label} callback local variables must use const`)
      }
      if (returned) {
        throw new Error(`${label} callback statements after return are not supported`)
      }
      for (const declarator of statement.declarations) {
        if (!t.isIdentifier(declarator.id) || !declarator.init) {
          throw new Error(`${label} callback local declarations must be simple identifiers with a value`)
        }
        if (reserved.includes(declarator.id.name)) {
          throw new Error(`${label} callback local name "${declarator.id.name}" conflicts with the loop variable`)
        }
        aliases[declarator.id.name] = declarator.init
      }
      continue
    }
    if (t.isReturnStatement(statement)) {
      if (returned) throw new Error(`${label} callback must return exactly one JSX value`)
      returned = true
      jsx = statement.argument
      continue
    }
    throw new Error(`${label} callback statements are not supported yet`)
  }

  if (!jsx) throw new Error(`${label} callback must return JSX`)
  return { jsx, aliases }
}

export function mergeAliases(patternAliasesValue, locals) {
  const aliases = { ...(patternAliasesValue ?? {}), ...(locals ?? {}) }
  return Object.keys(aliases).length > 0 ? aliases : null
}

export function inferKeyedField(fn) {
  const param = t.isIdentifier(fn.params[0]) ? fn.params[0].name : null
  if (!param) return null
  const body = t.isBlockStatement(fn.body)
    ? (() => {
        const ret = fn.body.body.find((item) => t.isReturnStatement(item))
        return ret?.argument ?? null
      })()
    : fn.body
  if (!body || !t.isMemberExpression(body)) return null
  if (!t.isIdentifier(body.object, { name: param })) return null
  if (body.computed) {
    return t.isStringLiteral(body.property) ? body.property.value : null
  }
  return t.isIdentifier(body.property) ? body.property.name : null
}

export function inlineExpression(expression, scope, ctx) {
  if (
    t.isStringLiteral(expression) ||
    t.isNumericLiteral(expression) ||
    t.isBooleanLiteral(expression) ||
    t.isNullLiteral(expression)
  ) {
    return codeOf(expression)
  }
  const rewritten = rewriteAccessorCalls(expression, scope)
  if (!dependsOnLoop(rewritten, scope)) {
    return `b${ctx.addBinding(rewritten)}`
  }
  const hoisted = hoistLoopExpression(rewritten, scope, ctx)
  validateInline(hoisted, scope)
  return codeOf(hoisted)
}

export function isLoopName(name, scope) {
  for (let cursor = scope; cursor; cursor = cursor.parent) {
    if (cursor.item === name || cursor.index === name || cursor.directKey === name) return true
    if (cursor.aliases && Object.prototype.hasOwnProperty.call(cursor.aliases, name)) return true
  }
  return false
}

export function dependsOnLoop(expression, scope) {
  let found = false
  const visit = (node, parent) => {
    if (found || !node || typeof node !== 'object') return
    if (t.isIdentifier(node) && !isStaticPropertyKey(node, parent)) {
      if (isLoopName(node.name, scope)) found = true
      return
    }
    for (const key of t.VISITOR_KEYS[node.type] ?? []) {
      const value = node[key]
      if (Array.isArray(value)) {
        for (const child of value) visit(child, node)
      } else {
        visit(value, node)
      }
      if (found) return
    }
  }
  visit(expression, null)
  return found
}

export function isHoistable(node) {
  if (!node || typeof node !== 'object') return false
  if (t.isStringLiteral(node) || t.isNumericLiteral(node) || t.isBooleanLiteral(node)) return false
  if (t.isNullLiteral(node) || t.isBigIntLiteral(node) || t.isRegExpLiteral(node)) return false
  return !(
    t.isArrowFunctionExpression(node) ||
    t.isFunctionExpression(node) ||
    t.isClassExpression(node) ||
    t.isJSXElement(node) ||
    t.isJSXFragment(node) ||
    t.isThisExpression(node) ||
    t.isSuper(node)
  )
}

export function hoistLoopExpression(expression, scope, ctx) {
  const visit = (node, isRoot) => {
    if (!node || typeof node !== 'object') return node
    if (!isRoot && isHoistable(node) && !dependsOnLoop(node, scope)) {
      return t.identifier(`b${ctx.addBinding(node)}`)
    }
    if ((t.isCallExpression(node) || t.isOptionalCallExpression(node)) && dependsOnLoop(node, scope)) {
      throw new Error(
        'Function calls inside <For> or <Show> must not depend on loop values; compute the value before the loop or move the call out of the template',
      )
    }
    if (t.isIdentifier(node)) return node
    for (const key of t.VISITOR_KEYS[node.type] ?? []) {
      if (skipChildKey(node, key)) continue
      const value = node[key]
      if (Array.isArray(value)) {
        node[key] = value.map((child) => visit(child, false))
      } else if (value && typeof value === 'object') {
        node[key] = visit(value, false)
      }
    }
    return node
  }
  return visit(expression, true)
}

export function accessorTarget(name, scope) {
  for (let cursor = scope; cursor; cursor = cursor.parent) {
    if (cursor.item === name && cursor.itemAccessor) return { kind: 'item', scope: cursor }
    if (cursor.index === name && cursor.indexAccessor) return { kind: 'index', scope: cursor }
  }
  return null
}

export function accessorKind(name, scope) {
  return accessorTarget(name, scope)?.kind ?? null
}

export function rewriteAccessorCalls(expression, scope, js = false) {
  if (!scope) return expression
  const cloned = t.cloneNode(expression, true)
  const visit = (node, parent = null) => {
    if (!node || typeof node !== 'object') return node
    if (
      t.isIdentifier(node) &&
      (parent ? t.isReferenced(node, parent) : true) &&
      !isStaticPropertyKey(node, parent)
    ) {
      const alias = aliasValue(node.name, scope)
      if (Array.isArray(alias)) return buildMember(alias)
      if (alias && t.isExpression(alias)) return visit(t.cloneNode(alias, true), null)
    }
    if (
      t.isCallExpression(node) &&
      t.isIdentifier(node.callee) &&
      accessorKind(node.callee.name, scope)
    ) {
      if (node.arguments.length > 0) {
        throw new Error(`Solid accessor ${node.callee.name}() does not take arguments`)
      }
      const found = accessorTarget(node.callee.name, scope)
      const owner = found?.scope ?? scope
      const target =
        found?.kind === 'index'
          ? owner.index
          : js
            ? (owner.eventItem ?? owner.item)
            : null
      if (target) return t.identifier(target)
      if (owner.itemAst) return t.cloneNode(owner.itemAst, true)
      return t.identifier(node.callee.name)
    }
    for (const key of t.VISITOR_KEYS[node.type] ?? []) {
      const value = node[key]
      if (Array.isArray(value)) node[key] = value.map((child) => visit(child, node))
      else if (value && typeof value === 'object') node[key] = visit(value, node)
    }
    return node
  }
  return visit(cloned)
}

export function validateInline(expression, scope) {
  const allowedIdentifiers = new Set()
  let cursor = scope
  while (cursor) {
    allowedIdentifiers.add(cursor.item)
    allowedIdentifiers.add(cursor.index)
    cursor = cursor.parent
  }

  const visit = (node) => {
    if (node == null) return
    if (t.isIdentifier(node)) {
      if (allowedIdentifiers.has(node.name) || /^b\d+$/.test(node.name)) return
      throw new Error(
        `Cannot use "${node.name}" inside <For>; only item/index fields are supported in the first compiler wave`,
      )
    }
    if (t.isMemberExpression(node)) {
      visit(node.object)
      if (node.computed) visit(node.property)
      return
    }
    if (
      t.isStringLiteral(node) ||
      t.isNumericLiteral(node) ||
      t.isBooleanLiteral(node) ||
      t.isNullLiteral(node)
    ) {
      return
    }
    if (t.isBinaryExpression(node) || t.isLogicalExpression(node)) {
      visit(node.left)
      visit(node.right)
      return
    }
    if (t.isUnaryExpression(node)) {
      visit(node.argument)
      return
    }
    if (t.isConditionalExpression(node)) {
      visit(node.test)
      visit(node.consequent)
      visit(node.alternate)
      return
    }
    throw new Error(
      `Unsupported expression inside <For>: ${node.type}. Move it out of the loop or use a field on the item.`,
    )
  }

  visit(expression)
}
