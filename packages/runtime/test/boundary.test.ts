import assert from 'node:assert/strict'
import test from 'node:test'
import { flush } from 'solid-js'
import {
  clearBoundaryContent,
  clearError,
  createBoundaryState,
  errorArrayOf,
  errorValueOf,
  erroredOf,
  hasPending,
  loadingOf,
  markError,
  markPending,
  markSettled,
  resetBoundary,
} from '../src/boundary.ts'

const failure = (message: string, source?: string) => {
  const error = new Error(message)
  if (source !== undefined) (error as Error & { source?: string }).source = source
  return error
}

test('pending count follows binding indexes and clears at zero', () => {
  const state = createBoundaryState()

  assert.equal(markPending(state, 0, 1), true)
  assert.equal(markPending(state, 0, 1), false, 'a duplicate pending index is ignored')
  assert.equal(markPending(state, 0, 2), true)
  assert.equal(state.pending.get(0)?.size, 2)
  assert.equal(hasPending(state, 0), true)
  flush()
  assert.equal(loadingOf(state, 0), true)

  assert.equal(markSettled(state, 0, 1), true)
  assert.equal(hasPending(state, 0), true)
  flush()
  assert.equal(loadingOf(state, 0), true)

  assert.equal(markSettled(state, 0, 2), true)
  assert.equal(hasPending(state, 0), false)
  assert.equal(state.pending.has(0), false)
  flush()
  assert.equal(loadingOf(state, 0), false)

  assert.equal(markSettled(state, 0, 2), false, 'settling an absent index is a no-op')
})

test('a shared source stays errored until every consumer recovers', () => {
  const state = createBoundaryState()
  const shared = failure('feed down', 'feed')

  markError(state, 0, 'feed', 0, shared)
  markError(state, 0, 'feed', 1, shared)
  flush()
  assert.equal(erroredOf(state, 0), true)
  assert.equal(state.consumers.get(0)?.get('feed')?.size, 2)
  assert.deepEqual(errorArrayOf(state, 0), [{ name: 'Error', message: 'feed down' }])

  clearError(state, 0, 'feed', 0)
  flush()
  assert.equal(erroredOf(state, 0), true, 'the second consumer still owns the source')
  assert.deepEqual(errorValueOf(state, 0), { name: 'Error', message: 'feed down' })

  clearError(state, 0, 'feed', 1)
  flush()
  assert.equal(erroredOf(state, 0), false)
  assert.equal(errorValueOf(state, 0), null)
  assert.deepEqual(errorArrayOf(state, 0), [])
  assert.equal(state.consumers.has(0), false)
  assert.equal(state.errors.has(0), false)
})

test('errorArray stays single-valued across several sources', () => {
  const state = createBoundaryState()
  markError(state, 0, 'a', 0, failure('a'))
  markError(state, 0, 'b', 1, failure('b'))

  flush()
  assert.equal(erroredOf(state, 0), true)
  assert.equal(errorArrayOf(state, 0).length, 1)
  assert.deepEqual(errorArrayOf(state, 0), [{ name: 'Error', message: 'b' }])

  clearError(state, 0, 'b', 1)
  flush()
  assert.equal(erroredOf(state, 0), true)
  assert.deepEqual(errorArrayOf(state, 0), [{ name: 'Error', message: 'a' }])

  clearError(state, 0, 'a', 0)
  flush()
  assert.deepEqual(errorArrayOf(state, 0), [])
})

test('re-reporting one consumer updates the value without adding a consumer', () => {
  const state = createBoundaryState()

  const first = markError(state, 0, 'feed', 0, failure('first'))
  assert.deepEqual(first, { valueChanged: true, added: true })

  const duplicate = markError(state, 0, 'feed', 0, failure('first'))
  assert.deepEqual(duplicate, { valueChanged: false, added: false })

  const retried = markError(state, 0, 'feed', 0, failure('second'))
  assert.deepEqual(retried, { valueChanged: true, added: false })
  assert.equal(state.consumers.get(0)?.get('feed')?.size, 1)
  flush()
  assert.deepEqual(errorValueOf(state, 0), { name: 'Error', message: 'second' })
})

test('markError normalizes non-Error failures like the runtime', () => {
  const state = createBoundaryState()
  markError(state, 0, 'plain', 0, 'offline')
  flush()
  assert.deepEqual(errorValueOf(state, 0), { name: 'Error', message: 'offline' })

  const named = markError(state, 0, 'named', 1, { name: 'NetworkError', message: 'down' })
  assert.equal(named.valueChanged, true)
  flush()
  assert.deepEqual(errorValueOf(state, 0), { name: 'NetworkError', message: 'down' })
})

test('reset clears pending and error values but keeps signal identity', () => {
  const state = createBoundaryState()
  resetBoundary(state, 0)

  const loading = state.loadingSignals.get(0)
  const errored = state.erroredSignals.get(0)
  const errorValue = state.errorValueSignals.get(0)
  const reset = state.resetSignals.get(0)
  flush()
  assert.equal(reset?.[0](), 1)

  markPending(state, 0, 1)
  markError(state, 0, 'feed', 1, failure('boom'))
  assert.equal(hasPending(state, 0), true)
  flush()
  assert.equal(erroredOf(state, 0), true)

  resetBoundary(state, 0)
  flush()

  assert.equal(hasPending(state, 0), false)
  assert.equal(erroredOf(state, 0), false)
  assert.equal(errorValueOf(state, 0), null)
  assert.equal(state.pending.has(0), false)
  assert.equal(state.consumers.has(0), false)
  assert.equal(state.errors.has(0), false)

  assert.equal(state.loadingSignals.get(0), loading)
  assert.equal(state.erroredSignals.get(0), errored)
  assert.equal(state.errorValueSignals.get(0), errorValue)
  assert.equal(state.resetSignals.get(0), reset)
  assert.equal(reset?.[0](), 2, 'the reset counter keeps increasing')
})

test('does not allocate signals for boundaries that were not touched', () => {
  const state = createBoundaryState()

  assert.equal(markSettled(state, 0, 1), false)
  clearError(state, 0, 'feed', 1)
  assert.equal(hasPending(state, 0), false)
  assert.equal(state.loadingSignals.size, 0)
  assert.equal(state.erroredSignals.size, 0)
  assert.equal(state.errorValueSignals.size, 0)
  assert.equal(state.resetSignals.size, 0)

  markPending(state, 2, 3)
  assert.deepEqual([...state.loadingSignals.keys()], [2])
  assert.equal(state.erroredSignals.size, 0)
  assert.equal(state.errorValueSignals.size, 0)
  assert.equal(state.resetSignals.size, 0)
})

test('remount clears content and preserves every signal and reset counter', () => {
  const state = createBoundaryState()
  resetBoundary(state, 0)
  flush()
  resetBoundary(state, 1)
  flush()

  const loading0 = state.loadingSignals.get(0)
  const errored0 = state.erroredSignals.get(0)
  const errorValue0 = state.errorValueSignals.get(0)
  const reset0 = state.resetSignals.get(0)
  const loading1 = state.loadingSignals.get(1)
  const reset1 = state.resetSignals.get(1)

  markPending(state, 0, 1)
  markError(state, 0, 'feed', 1, failure('boom'))
  state.loadingOn.set(0, () => 1)

  clearBoundaryContent(state)
  flush()

  assert.equal(hasPending(state, 0), false)
  assert.equal(state.pending.size, 0)
  assert.equal(state.consumers.size, 0)
  assert.equal(state.errors.size, 0)
  assert.equal(state.loadingOn.size, 0)
  assert.equal(loadingOf(state, 0), false)
  assert.equal(erroredOf(state, 0), false)
  assert.equal(errorValueOf(state, 0), null)

  assert.equal(state.loadingSignals.get(0), loading0)
  assert.equal(state.erroredSignals.get(0), errored0)
  assert.equal(state.errorValueSignals.get(0), errorValue0)
  assert.equal(state.resetSignals.get(0), reset0)
  assert.equal(state.loadingSignals.get(1), loading1)
  assert.equal(state.resetSignals.get(1), reset1)
  assert.equal(reset0?.[0](), 1, 'reset counters survive a remount')
  assert.equal(reset1?.[0](), 1)
})
