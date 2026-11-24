import assert from 'node:assert/strict'
import test from 'node:test'
import { parse } from '@babel/parser'
import * as t from '@babel/types'
import {
  isReferenceIdentifier,
  memberChainOf,
  unwrapTs,
  visitChildren,
} from '../src/ast.ts'

const expressionOf = (code: string): any =>
  (parse(code, { plugins: ['typescript'] }).program.body[0] as any).expression

test('visitChildren visits direct children in visitor-key order', () => {
  const node = expressionOf('a + b')
  const seen: string[] = []
  visitChildren(node, (child, parent) => {
    assert.equal(parent, node)
    seen.push(child.type)
  })
  assert.deepEqual(seen, ['Identifier', 'Identifier'])
})

test('visitChildren writes replacements back in place', () => {
  const node = expressionOf('foo(a, b)')
  visitChildren(node, (child) => {
    if (t.isIdentifier(child, { name: 'a' })) return t.identifier('x')
    return undefined
  })
  assert.equal((node.arguments[0] as any).name, 'x')
  assert.equal((node.arguments[1] as any).name, 'b')
})

test('visitChildren leaves children untouched when the visitor returns undefined', () => {
  const node = expressionOf('a + b')
  const before = node.left
  visitChildren(node, () => undefined)
  assert.equal(node.left, before)
})

test('unwrapTs strips every TypeScript wrapper without touching parentheses', () => {
  assert.equal(unwrapTs(expressionOf('value as string') as any).name, 'value')
  assert.equal(unwrapTs(expressionOf('value satisfies string') as any).name, 'value')
  assert.equal(unwrapTs(expressionOf('value!') as any).name, 'value')
  assert.equal(
    unwrapTs(expressionOf('(value as string)!') as any).name,
    'value',
  )
  const parenthesized = unwrapTs(
    (
      parse('(value)', {
        plugins: ['typescript'],
        createParenthesizedExpressions: true,
      }).program.body[0] as any
    ).expression,
  )
  assert.equal(parenthesized.type, 'ParenthesizedExpression')
  assert.equal(unwrapTs(expressionOf('value') as any).name, 'value')
})

test('isReferenceIdentifier separates value reads from static keys', () => {
  const member = expressionOf('obj.prop') as any
  assert.equal(isReferenceIdentifier(member.object, member), true)
  assert.equal(isReferenceIdentifier(member.property, member), false)

  const property = expressionOf('({ key: value })') as any
  const entry = property.properties[0]
  assert.equal(isReferenceIdentifier(entry.key, entry), false)
  assert.equal(isReferenceIdentifier(entry.value, entry), true)

  const standalone = t.identifier('value')
  assert.equal(isReferenceIdentifier(standalone, null), true)
})

test('memberChainOf flattens static access only', () => {
  const chain = memberChainOf(expressionOf('a.b.c') as any)
  assert.equal(chain?.root.name, 'a')
  assert.deepEqual(chain?.segments, ['b', 'c'])

  const computed = memberChainOf(expressionOf('a[b]') as any)
  assert.equal(computed?.root.type, 'MemberExpression')
  assert.deepEqual(computed?.segments, [])

  const mixed = memberChainOf(expressionOf('a[b].c') as any)
  assert.equal(mixed?.root.type, 'MemberExpression')
  assert.deepEqual(mixed?.segments, ['c'])
})
