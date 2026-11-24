import assert from 'node:assert/strict'
import test from 'node:test'
import { hasUnregisteredPropRead } from '../src/compile.ts'

test('prop audit accepts registered member reads', () => {
  assert.equal(
    hasUnregisteredPropRead(['props.title', 'props?.done'], 'props', new Set(['title', 'done'])),
    false,
  )
})

test('prop audit rejects unregistered member and whole-object reads', () => {
  assert.equal(hasUnregisteredPropRead(['props.missing'], 'props', new Set(['title'])), true)
  assert.equal(hasUnregisteredPropRead(['props[0]'], 'props', new Set(['title'])), true)
  assert.equal(hasUnregisteredPropRead(['other.title'], 'props', new Set()), false)
})
