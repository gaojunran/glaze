import generatorModule from '@babel/generator'
import * as t from '@babel/types'
import { kebabCase } from '@glaze/shared'
import type { AnyNode } from './types.ts'

const generate = (generatorModule as any).default ?? generatorModule

export const escapeText = (value) =>
  value.replace(/[&<>{}]/g, (char) => {
    if (char === '&') return '&amp;'
    if (char === '<') return '&lt;'
    if (char === '>') return '&gt;'
    if (char === '{') return '&#123;'
    return '&#125;'
  })

export const escapeAttr = (value) => escapeText(value).replace(/"/g, '&quot;')

export const normalizeText = (value) => {
  const lines = value.replace(/\r\n?/g, '\n').split('\n')
  let first = -1
  let last = -1
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].replace(/[ \t\r\n]+/g, '') !== '') {
      if (first === -1) first = i
      last = i
    }
  }
  if (first === -1) return ''
  const parts = []
  for (let i = first; i <= last; i += 1) {
    let line = lines[i]
    if (i !== first || first > 0) line = line.replace(/^[ \t]+/, '')
    if (i !== last || last < lines.length - 1) line = line.replace(/[ \t]+$/, '')
    if (line !== '') parts.push(line)
  }
  return parts.join(' ')
}

export const isWhitespaceText = (node) =>
  t.isJSXText(node) && normalizeText(node.value) === ''

export const tagName = (name) => {
  if (t.isJSXIdentifier(name)) return name.name
  throw new Error('Unsupported JSX member tag')
}

export const getAttribute = (node, name) =>
  node.openingElement.attributes.find(
    (attr) => t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name, { name }),
  )

export function expandAttributes(attributes) {
  const expanded = []
  for (const attr of attributes) {
    if (t.isJSXAttribute(attr)) {
      expanded.push(attr)
      continue
    }
    if (!t.isJSXSpreadAttribute(attr) || !t.isObjectExpression(attr.argument)) {
      throw new Error('Only object literals can be spread into JSX attributes')
    }
    for (const property of attr.argument.properties) {
      if (!t.isObjectProperty(property) || property.computed) {
        throw new Error('JSX spread object must use static keys')
      }
      const key = t.isIdentifier(property.key)
        ? property.key.name
        : t.isStringLiteral(property.key)
          ? property.key.value
          : null
      if (!key) throw new Error('JSX spread object must use static keys')
      expanded.push(
        t.jsxAttribute(
          t.jsxIdentifier(key),
          t.isStringLiteral(property.value)
            ? property.value
            : t.jsxExpressionContainer(property.value as any),
        ),
      )
    }
  }
  return expanded
}

export const getExpression = (attr: any): any => {
  if (!attr) return null
  if (attr.value == null) return t.booleanLiteral(true)
  if (t.isStringLiteral(attr.value)) return t.stringLiteral(attr.value.value)
  if (t.isJSXExpressionContainer(attr.value)) {
    if (t.isJSXEmptyExpression(attr.value.expression)) return null
    return attr.value.expression
  }
  throw new Error('Unsupported attribute value')
}

export const codeOf = (node) => generate(node).code

// WXML attribute values are double-quoted. Keep generated expressions free of
// raw double quotes: single-quoted string literals are preferred, and any quote
// that survives (string content, regex, template text) is emitted as `\u0022`.
export const wxmlCodeOf = (node) => {
  const copy = t.cloneNode(node, true)
  walkAst(copy, (item) => {
    if (t.isStringLiteral(item)) delete item.extra
  })
  return generate(copy, { jsescOption: { quotes: 'single' } })
    .code.replace(/"/g, '\\u0022')
}

export const containsJsx = (node) => {
  let found = false
  walkAst(node, (item) => {
    if (t.isJSXElement(item) || t.isJSXFragment(item)) found = true
  })
  return found
}

export const walkAst = (node, visit) => {
  if (!node || typeof node.type !== 'string') return
  visit(node)
  for (const key of t.VISITOR_KEYS[node.type] ?? []) {
    const child = node[key]
    if (Array.isArray(child)) child.forEach((item) => walkAst(item, visit))
    else walkAst(child, visit)
  }
}

/**
 * Visit the direct children of `node` in `t.VISITOR_KEYS` order. A visitor may
 * return a replacement node, which is written back in place; returning
 * undefined leaves the child untouched. Callers that only read can ignore the
 * return value.
 */
export const visitChildren = (node, visit) => {
  for (const key of t.VISITOR_KEYS[node.type] ?? []) {
    const child = node[key]
    if (Array.isArray(child)) {
      for (let index = 0; index < child.length; index += 1) {
        const next = visit(child[index], node)
        if (next !== undefined) child[index] = next
      }
    } else if (child && typeof child === 'object') {
      const next = visit(child, node)
      if (next !== undefined) node[key] = next
    }
  }
}

/** Strip the TypeScript wrappers that carry no runtime value. */
export function unwrapTs(node) {
  let current = node
  while (
    current &&
    (t.isTSAsExpression(current) ||
      t.isTSSatisfiesExpression(current) ||
      t.isTSNonNullExpression(current))
  ) {
    current = current.expression
  }
  return current
}

/** True when `node` is an identifier used as a value, not a static key. */
export function isReferenceIdentifier(node, parent) {
  if (!t.isIdentifier(node)) return false
  if (!parent) return true
  if (isStaticPropertyKey(node, parent)) return false
  return t.isReferenced(node, parent)
}

/**
 * Flatten `a.b.c` into its root and static field names. Computed access is not
 * a static chain, so it returns null.
 */
export function memberChainOf(node) {
  const segments: string[] = []
  let cursor = node
  while (t.isMemberExpression(cursor) && !cursor.computed) {
    if (!t.isIdentifier(cursor.property)) return null
    segments.unshift(cursor.property.name)
    cursor = cursor.object
  }
  return { root: cursor, segments }
}

/** Rename free identifier references in a cloned AST (used for generated callback helpers). */
export function renameIdentifiers(node, from, to) {
  const cloned = t.cloneNode(node, true)
  const visit = (current, parent) => {
    if (!current || typeof current.type !== 'string') return
    if (t.isIdentifier(current, { name: from }) && !isStaticPropertyKey(current, parent)) {
      current.name = to
      return
    }
    for (const key of t.VISITOR_KEYS[current.type] ?? []) {
      const value = current[key]
      if (Array.isArray(value)) value.forEach((child) => visit(child, current))
      else visit(value, current)
    }
  }
  visit(cloned, null)
  return cloned
}

export function skipChildKey(node, key) {
  if (t.isMemberExpression(node) && key === 'property' && !node.computed) return true
  if (t.isObjectProperty(node) && key === 'key' && !node.computed) return true
  return false
}

export function isStaticPropertyKey(node, parent) {
  if (!parent) return false
  if (t.isMemberExpression(parent) && parent.property === node && !parent.computed) return true
  if (t.isObjectProperty(parent) && parent.key === node && !parent.computed) return true
  return false
}

export const importedName = (imported: any): string =>
  t.isIdentifier(imported) ? imported.name : imported.value
