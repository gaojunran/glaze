import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createBindingState,
  createBindingStates,
  resetBindingStates,
  type BindingList,
} from '../src/state.ts'

const visibleSlots = (states: BindingList) => {
  const slots: number[] = []
  for (let index = 0; index < states.length; index += 1) {
    if (Object.hasOwn(states, index)) slots.push(index)
  }
  return slots
}

test('keeps sparse binding slots and never compacts them', () => {
  const raw: (() => unknown)[] = []
  raw[5] = () => 'five'
  const states = createBindingStates({ raw })

  assert.equal(states.length, 6)
  assert.deepEqual(visibleSlots(states), [5])
  assert.equal(states[5]?.raw, raw[5])
  assert.equal(states[0], undefined)

  // Reading a hole does not create it.
  void states[2]
  assert.equal(Object.hasOwn(states, 2), false)
})

test('registers boundaries per slot and follows ctx.bind defaults', () => {
  const states = createBindingStates({
    raw: [() => 'a', () => 'b', () => 'c'],
    loadingBoundaries: [3, null],
    errorBoundaries: [7, undefined],
  })

  assert.equal(states[0]?.loadingBoundary, 3)
  assert.equal(states[0]?.errorBoundary, 7)
  assert.equal(states[1]?.loadingBoundary, null)
  assert.equal(states[1]?.errorBoundary, null)
  assert.equal(states[2]?.loadingBoundary, null)
  assert.equal(states[2]?.errorBoundary, null)
})

test('an explicit null error boundary does not inherit the loading boundary', () => {
  const states = createBindingStates({
    raw: [() => 'a'],
    loadingBoundaries: [4],
    errorBoundaries: [null],
  })
  assert.equal(states[0]?.loadingBoundary, 4)
  assert.equal(states[0]?.errorBoundary, null)
})

test('starts read as raw and memo as null', () => {
  const raw = () => 'value'
  const state = createBindingState({ raw })
  assert.equal(state.read, raw)
  assert.equal(state.memo, null)
})

test('reset clears per-binding values in place and leaves unrelated state alone', () => {
  const states = createBindingStates({ raw: [() => 1, () => 2] })
  const state = states[0]!
  const memo = () => 2
  state.read = () => 3
  state.memo = memo
  state.initial = 'mount-value'
  state.previous = 'baseline'
  state.settled = true
  state.loadingBoundary = 0
  state.errorBoundary = 1
  state.source = 'feed'
  state.fallbackSource = { binding: 0 }

  const unrelated = { initial: 'keep', previous: 'keep', settled: true }

  resetBindingStates(states)

  assert.equal(states[0], state, 'reset mutates entries instead of replacing them')
  assert.equal(state.raw, null)
  assert.equal(state.read, null)
  assert.equal(state.memo, null)
  assert.equal(state.initial, undefined)
  assert.equal(state.previous, undefined)
  assert.equal(state.settled, false)
  assert.equal(state.loadingBoundary, null)
  assert.equal(state.errorBoundary, null)
  assert.equal(state.source, undefined)
  assert.equal(state.fallbackSource, undefined)
  assert.deepEqual(unrelated, { initial: 'keep', previous: 'keep', settled: true })
})

test('reset preserves sparse layout and entry identity', () => {
  const raw: (() => unknown)[] = []
  raw[2] = () => 'two'
  const states = createBindingStates({ raw })
  const entry = states[2]!
  entry.settled = true

  resetBindingStates(states)

  assert.equal(states.length, 3)
  assert.deepEqual(visibleSlots(states), [2])
  assert.equal(states[2], entry)
  assert.equal(states[2]?.settled, false)
})

test('initial, previous and settled stay independent and are not inferred from undefined', () => {
  const state = createBindingState({ raw: () => undefined })

  assert.ok(Object.hasOwn(state, 'initial'))
  assert.ok(Object.hasOwn(state, 'previous'))
  assert.ok(Object.hasOwn(state, 'settled'))
  assert.equal(state.initial, undefined)
  assert.equal(state.previous, undefined)
  assert.equal(state.settled, false)

  // A committed binding may legitimately produce `undefined`; settlement is a
  // separate boolean, never `initial !== undefined`.
  state.initial = undefined
  state.settled = true
  state.previous = 'baseline'
  assert.equal(state.initial, undefined)
  assert.equal(state.previous, 'baseline')
  assert.equal(state.settled, true)

  // Clearing one field must not move the others.
  state.previous = undefined
  state.initial = 'other'
  assert.equal(state.settled, true)
  assert.equal(state.initial, 'other')
  assert.equal(state.previous, undefined)
})
