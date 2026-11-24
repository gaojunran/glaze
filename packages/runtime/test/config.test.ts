import assert from 'node:assert/strict'
import test from 'node:test'
import { defineGlazeComponent } from '../src/mini.ts'

const setup = () => {}

test('rejects a prop signal that is not a declared property', () => {
  assert.throws(
    () =>
      defineGlazeComponent({
        properties: ['title'],
        propSignals: ['missing'],
        setup,
      }),
    /propSignals entry "missing" is not a declared property/,
  )
})

test('rejects properties that collide after lowercasing', () => {
  assert.throws(
    () =>
      defineGlazeComponent({
        properties: ['Title', 'title'],
        setup,
      }),
    /property names collide after lowercasing/,
  )
})

test('rejects a non-positive binding group size', () => {
  assert.throws(
    () =>
      defineGlazeComponent({
        bindingGroupSize: 0,
        setup,
      }),
    /bindingGroupSize must be a positive integer/,
  )
})

test('rejects a negative handler count', () => {
  assert.throws(
    () =>
      defineGlazeComponent({
        handlerCount: -1,
        setup,
      }),
    /handlerCount must be a non-negative integer/,
  )
})

test('rejects list fields without a matching list binding', () => {
  assert.throws(
    () =>
      defineGlazeComponent({
        listFields: { 0: ['id'] },
        setup,
      }),
    /listFields\[0\] has no matching listBindings entry/,
  )
})

test('rejects an invalid list binding key', () => {
  assert.throws(
    () =>
      defineGlazeComponent({
        listBindings: { row: 'id' } as never,
        setup,
      }),
    /listBindings\[row\] must map a numeric binding to a non-empty key/,
  )
})

test('rejects an invalid async status entry', () => {
  assert.throws(
    () =>
      defineGlazeComponent({
        asyncStatus: [{ index: -1, kind: 'loading', boundary: 0 }],
        setup,
      }),
    /asyncStatus\.index must be a non-negative integer/,
  )
  assert.throws(
    () =>
      defineGlazeComponent({
        asyncStatus: [{ index: 1, kind: 'other', boundary: 0 }] as never,
        setup,
      }),
    /asyncStatus\.kind must be "loading", "error" or "settled"/,
  )
})
