import * as t from '@babel/types'
import type { AnyNode } from './types.ts'

const isUseContext = (node: AnyNode): node is AnyNode =>
  t.isCallExpression(node) && t.isIdentifier(node.callee, { name: 'useContext' })

const unwrapExpression = (node: AnyNode): AnyNode => {
  let current = node
  while (
    (t.isTSAsExpression(current) ||
      t.isTSSatisfiesExpression(current) ||
      t.isTSNonNullExpression(current) ||
      t.isTypeCastExpression(current)) &&
    current.expression
  ) {
    current = current.expression
  }
  return current
}

const callContext = (argument: AnyNode): AnyNode =>
  t.callExpression(
    t.memberExpression(t.identifier('ctx'), t.identifier('context')),
    [argument],
  )

const callReader = (argument: AnyNode): AnyNode =>
  t.callExpression(callContext(argument), [])

const callLocalReader = (name: string): AnyNode =>
  t.callExpression(t.identifier(name), [])

const staticKey = (node: AnyNode, parent: AnyNode | null, key: string | null) => {
  if (!parent) return false
  if (
    (t.isObjectProperty(parent) || t.isObjectMethod(parent) || t.isClassMethod(parent)) &&
    key === 'key' &&
    !parent.computed
  ) {
    return true
  }
  if (
    (t.isMemberExpression(parent) || t.isOptionalMemberExpression(parent)) &&
    key === 'property' &&
    !parent.computed
  ) {
    return true
  }
  return false
}

/**
 * Compile `useContext` into a context reader.
 *
 * Solid contexts can hold any value. Glaze's generated code needs an accessor
 * for all of them: an object value must be read through the current provider,
 * and a primitive value needs the same because a Proxy cannot preserve its
 * identity. The generated local is the reader, so every reference is rewritten
 * to `reader()`.
 */
export function rewriteContextAccess(...roots: AnyNode[]): void {
  const locals = new Set<string>()
  const handled = new WeakSet<object>()

  const collectDeclarations = (node: AnyNode): void => {
    if (!node || typeof node !== 'object') return
    if (t.isVariableDeclarator(node) && node.init) {
      const init = unwrapExpression(node.init)
      if (isUseContext(init)) {
        const argument = init.arguments[0]
        if (argument) {
          handled.add(init)
          if (t.isIdentifier(node.id)) {
            locals.add(node.id.name)
            node.init = callContext(argument)
          } else {
            // Destructuring has no stable local to rewrite; keep the value
            // semantics of a one-time destructure.
            node.init = callReader(argument)
          }
        }
      }
    }
    for (const childKey of t.VISITOR_KEYS[node.type] ?? []) {
      if (childKey === 'typeAnnotation' || childKey === 'typeParameters') continue
      const child = node[childKey]
      if (Array.isArray(child)) child.forEach(collectDeclarations)
      else if (child && typeof child === 'object') collectDeclarations(child)
    }
  }
  roots.forEach(collectDeclarations)

  const visitCalls = (node: AnyNode): AnyNode => {
    if (!node || typeof node !== 'object') return node
    if (isUseContext(node)) {
      if (handled.has(node)) return node
      const argument = node.arguments[0]
      if (argument) return callReader(argument)
    }
    for (const childKey of t.VISITOR_KEYS[node.type] ?? []) {
      if (childKey === 'typeAnnotation' || childKey === 'typeParameters') continue
      const child = node[childKey]
      if (Array.isArray(child)) {
        node[childKey] = child.map(visitCalls)
      } else if (child && typeof child === 'object') {
        node[childKey] = visitCalls(child)
      }
    }
    return node
  }
  roots.forEach(visitCalls)

  if (locals.size === 0) return
  const readers = new Set(locals)

  const visitRefs = (
    node: AnyNode,
    parent: AnyNode | null,
    key: string | null,
    shadowed: Set<string>,
  ): AnyNode => {
    if (!node || typeof node !== 'object') return node

    if (t.isIdentifier(node) && readers.has(node.name) && !shadowed.has(node.name)) {
      if (t.isVariableDeclarator(parent) && key === 'id') return node
      if (staticKey(node, parent, key)) return node
      if (t.isImportSpecifier(parent) || t.isImportDefaultSpecifier(parent)) return node
      if (t.isExportSpecifier(parent)) return node
      return callLocalReader(node.name)
    }

    if (t.isObjectProperty(node) && node.shorthand && t.isIdentifier(node.value)) {
      const name = node.value.name
      if (readers.has(name) && !shadowed.has(name)) {
        return t.objectProperty(
          node.key,
          callLocalReader(name),
          false,
          false,
        )
      }
    }

    const nextShadowed = new Set(shadowed)
    if (
      t.isFunction(node) ||
      t.isArrowFunctionExpression(node) ||
      t.isObjectMethod(node) ||
      t.isClassMethod(node)
    ) {
      for (const parameter of node.params) {
        if (t.isIdentifier(parameter)) nextShadowed.add(parameter.name)
        else if (t.isAssignmentPattern(parameter) && t.isIdentifier(parameter.left)) {
          nextShadowed.add(parameter.left.name)
        }
      }
    }
    if (t.isVariableDeclarator(node) && t.isIdentifier(node.id)) nextShadowed.add(node.id.name)

    for (const childKey of t.VISITOR_KEYS[node.type] ?? []) {
      if (childKey === 'typeAnnotation' || childKey === 'typeParameters') continue
      if (childKey === 'id' && t.isVariableDeclarator(node)) continue
      const child = node[childKey]
      if (Array.isArray(child)) {
        node[childKey] = child.map((item) => visitRefs(item, node, childKey, nextShadowed))
      } else if (child && typeof child === 'object') {
        node[childKey] = visitRefs(child, node, childKey, nextShadowed)
      }
    }
    return node
  }

  roots.forEach((root) => visitRefs(root, null, null, new Set()))
}
