import * as t from '@babel/types'
import { bindingKey } from '@glaze/shared'
import {
  isReferenceIdentifier,
  isStaticPropertyKey,
  skipChildKey,
  unwrapTs,
  visitChildren,
  wxmlCodeOf,
} from './ast.ts'
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

export function aliasValue(name: string, scope: Scope | null) {
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

type LoopScopeOptions = {
  item: string
  index: string
  parent: Scope | null
  source?: string | null
  jsSource?: string | null
  offset?: string
  itemAccessor?: boolean
  indexAccessor?: boolean
  isIndexRepeat?: boolean
  aliases?: Scope['aliases']
  listBinding?: number | null
}

/** Build a loop scope. Level always follows the parent, as loop callbacks do. */
export function makeLoopScope({
  item,
  index,
  parent,
  source = null,
  jsSource = null,
  offset,
  itemAccessor,
  indexAccessor,
  isIndexRepeat,
  aliases,
  listBinding = null,
}: LoopScopeOptions): Scope {
  return {
    item,
    index,
    source,
    jsSource,
    ...(offset === undefined ? {} : { offset }),
    parent,
    level: parent ? parent.level + 1 : 0,
    ...(itemAccessor === undefined ? {} : { itemAccessor }),
    ...(indexAccessor === undefined ? {} : { indexAccessor }),
    ...(isIndexRepeat === undefined ? {} : { isIndexRepeat }),
    ...(aliases === undefined ? {} : { aliases }),
    listBinding,
  }
}

type CallbackScopeOptions = LoopScopeOptions & {
  itemAst?: AnyNode
  eventItem?: string
  direct?: string
  directKey?: string
}

/** Build a scope for a callback render (Show/Match/Errored fallback). */
export function makeCallbackScope({
  item,
  index,
  parent,
  source = null,
  jsSource = null,
  offset,
  itemAccessor,
  indexAccessor,
  aliases,
  listBinding = null,
  itemAst,
  eventItem,
  direct,
  directKey,
}: CallbackScopeOptions): Scope {
  return {
    item,
    ...(itemAst === undefined ? {} : { itemAst }),
    ...(eventItem === undefined ? {} : { eventItem }),
    index,
    source,
    jsSource,
    ...(offset === undefined ? {} : { offset }),
    ...(direct === undefined ? {} : { direct }),
    ...(directKey === undefined ? {} : { directKey }),
    parent,
    level: parent ? parent.level + 1 : 0,
    ...(itemAccessor === undefined ? {} : { itemAccessor }),
    ...(indexAccessor === undefined ? {} : { indexAccessor }),
    ...(aliases === undefined ? {} : { aliases }),
    listBinding,
  }
}

export function inferKeyedField(fn) {
  const param = t.isIdentifier(fn.params[0]) ? fn.params[0].name : null
  if (!param) return null
  let body = t.isBlockStatement(fn.body)
    ? (() => {
        const ret = fn.body.body.find((item) => t.isReturnStatement(item))
        return ret?.argument ?? null
      })()
    : fn.body
  while (
    t.isTSNonNullExpression(body) ||
    t.isTSAsExpression(body) ||
    t.isTSSatisfiesExpression(body)
  ) {
    body = body.expression
  }
  if (!body || !t.isMemberExpression(body)) return null
  if (!t.isIdentifier(body.object, { name: param })) return null
  if (body.computed) {
    return t.isStringLiteral(body.property) ? body.property.value : null
  }
  return t.isIdentifier(body.property) ? body.property.name : null
}

function itemScope(scope: Scope | null, name: string) {
  for (let cursor = scope; cursor; cursor = cursor.parent) {
    if (cursor.item === name) return cursor
  }
  return null
}

function addListField(ctx, binding, field) {
  const entry = ctx.bindings[binding]
  if (!entry) return
  const fields = entry.listFields ?? []
  if (!fields.includes(field)) fields.push(field)
  entry.listFields = fields
}

/**
 * Record which top-level row fields WXML actually reads. The runtime can then
 * project only those fields into component data instead of sending the whole
 * object (for example a large `extra` payload that the template never uses).
 *
 * Anything the compiler cannot prove is a static field access disables
 * projection for that loop; falling back to the full row is always correct.
 */
export function noteListFields(expression, scope: Scope | null, ctx) {
  if (!scope) return
  const visit = (node, parent) => {
    if (!node || typeof node !== 'object') return

    if (t.isIdentifier(node)) {
      if (isStaticPropertyKey(node, parent)) return
      const owner = itemScope(scope, node.name)
      if (!owner || owner.listBinding == null) return
      const memberObject =
        parent &&
        (t.isMemberExpression(parent) || t.isOptionalMemberExpression(parent)) &&
        parent.object === node
      if (!memberObject) ctx.listProjectionBlocked.add(owner.listBinding)
      return
    }

    if (t.isMemberExpression(node) || t.isOptionalMemberExpression(node)) {
      const object = unwrapTs(node.object)
      if (t.isIdentifier(object)) {
        const owner = itemScope(scope, object.name)
        if (owner && owner.listBinding != null) {
          const binding = owner.listBinding
          if (node.computed) {
            const property = unwrapTs(node.property)
            if (t.isStringLiteral(property)) addListField(ctx, binding, property.value)
            else ctx.listProjectionBlocked.add(binding)
          } else if (t.isIdentifier(node.property)) {
            addListField(ctx, binding, node.property.name)
          } else {
            ctx.listProjectionBlocked.add(binding)
          }
          return
        }
      }
      visit(object, node)
      if (node.computed) visit(node.property, node)
      return
    }

    visitChildren(node, visit)
  }
  for (const item of Array.isArray(expression) ? expression : [expression]) {
    visit(item, null)
  }
}

export function inlineExpression(expression, scope: Scope | null, ctx) {
  if (
    t.isStringLiteral(expression) ||
    t.isNumericLiteral(expression) ||
    t.isBooleanLiteral(expression) ||
    t.isNullLiteral(expression)
  ) {
    return wxmlCodeOf(expression)
  }
  const rewritten = rewriteAccessorCalls(expression, scope)
  noteListFields(rewritten, scope, ctx)
  if (!dependsOnLoop(rewritten, scope)) {
    return bindingKey(ctx.addBinding(rewritten))
  }
  const hoisted = hoistLoopExpression(rewritten, scope, ctx)
  validateInline(hoisted, scope)
  return wxmlCodeOf(hoisted)
}

export function isLoopName(name: string, scope: Scope | null) {
  for (let cursor = scope; cursor; cursor = cursor.parent) {
    if (cursor.item === name || cursor.index === name || cursor.directKey === name) return true
    if (cursor.aliases && Object.prototype.hasOwnProperty.call(cursor.aliases, name)) return true
  }
  return false
}

export function dependsOnLoop(expression, scope: Scope | null) {
  let found = false
  const visit = (node, parent) => {
    if (found || !node || typeof node !== 'object') return
    if (t.isIdentifier(node) && !isStaticPropertyKey(node, parent)) {
      if (isLoopName(node.name, scope)) found = true
      return
    }
    visitChildren(node, visit)
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

export function hoistLoopExpression(expression, scope: Scope | null, ctx) {
  const visit = (node, isRoot) => {
    if (!node || typeof node !== 'object') return node
    if (t.isTemplateLiteral(node) && dependsOnLoop(node, scope)) {
      throw new Error(
        'Template literals inside <For> or <Show> are not supported yet; build the string with + instead',
      )
    }
    if (!isRoot && isHoistable(node) && !dependsOnLoop(node, scope)) {
      return t.identifier(bindingKey(ctx.addBinding(node)))
    }
    if ((t.isCallExpression(node) || t.isOptionalCallExpression(node)) && dependsOnLoop(node, scope)) {
      throw new Error(
        'Function calls inside <For> or <Show> must not depend on loop values; compute the value before the loop or move the call out of the template',
      )
    }
    if (t.isIdentifier(node)) return node
    for (const key of t.VISITOR_KEYS[node.type] ?? []) {
      if (skipChildKey(node, key)) continue
      if (t.isTemplateLiteral(node) && key === 'quasis') continue
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

export function accessorTarget(name: string, scope: Scope | null) {
  for (let cursor = scope; cursor; cursor = cursor.parent) {
    if (cursor.item === name && cursor.itemAccessor) return { kind: 'item', scope: cursor }
    if (cursor.index === name && cursor.indexAccessor) return { kind: 'index', scope: cursor }
  }
  return null
}

export function accessorKind(name: string, scope: Scope | null) {
  return accessorTarget(name, scope)?.kind ?? null
}

export function rewriteAccessorCalls(expression, scope: Scope | null, js = false) {
  if (!scope) return expression
  const cloned = t.cloneNode(expression, true)
  const visit = (node, parent = null) => {
    if (!node || typeof node !== 'object') return node
    if (isReferenceIdentifier(node, parent)) {
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
    visitChildren(node, visit)
    return node
  }
  return visit(cloned)
}

export function validateInline(expression, scope: Scope | null) {
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
