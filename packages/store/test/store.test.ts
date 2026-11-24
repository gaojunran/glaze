import assert from 'node:assert/strict'
import test from 'node:test'
import { createMemo, createStore, flush } from 'solid-js'
import { defineStore } from '../src/index.ts'

let sequence = 0
const nextId = (name: string) => `${name}-${++sequence}`

test('creates one lazy store instance per id', () => {
  const id = nextId('lazy')
  let calls = 0
  const useStore = defineStore(id, () => {
    calls += 1
    const [state, setState] = createStore({ count: 0 })
    return {
      state,
      increment: () => setState((draft) => { draft.count += 1 }),
    }
  })

  assert.equal(calls, 0)
  const first = useStore()
  const second = useStore()
  assert.equal(first, second)
  assert.equal(calls, 1)
  assert.equal(first.$id, id)
})

test('runs a setup store reactively through actions and memos', () => {
  const useStore = defineStore(nextId('counter'), () => {
    const [state, setState] = createStore({ count: 0 })
    const double = createMemo(() => state.count * 2)
    return {
      state,
      double,
      increment: () => setState((draft) => { draft.count += 1 }),
    }
  })
  const store = useStore()

  assert.equal(store.state.count, 0)
  assert.equal(store.double(), 0)
  store.increment()
  flush()
  assert.equal(store.state.count, 1)
  assert.equal(store.double(), 2)
})

test('a duplicate definition from another bundle reuses the live instance', () => {
  const id = nextId('duplicate')
  let firstCalls = 0
  let secondCalls = 0
  const useFirst = defineStore(id, () => {
    firstCalls += 1
    return { value: 'first' }
  })
  const first = useFirst()

  const useSecond = defineStore(id, () => {
    secondCalls += 1
    return { value: 'second' }
  })
  const second = useSecond()

  assert.equal(second, first)
  assert.equal(firstCalls, 1)
  assert.equal(secondCalls, 0)
})

test('duplicate definitions before creation use the last setup', () => {
  const id = nextId('pending')
  let firstCalls = 0
  let secondCalls = 0
  defineStore(id, () => {
    firstCalls += 1
    return { value: 'first' }
  })
  const useSecond = defineStore(id, () => {
    secondCalls += 1
    return { value: 'second' }
  })

  assert.equal(useSecond().value, 'second')
  assert.equal(firstCalls, 0)
  assert.equal(secondCalls, 1)
})

test('separate ids create separate stores', () => {
  const first = defineStore(nextId('separate'), () => ({ value: 1 }))()
  const second = defineStore(nextId('separate'), () => ({ value: 2 }))()
  assert.notEqual(first, second)
  assert.equal(first.value, 1)
  assert.equal(second.value, 2)
})

test('$dispose clears the instance so the next use rebuilds it', () => {
  let calls = 0
  const useStore = defineStore(nextId('dispose'), () => {
    calls += 1
    return { value: calls }
  })
  const first = useStore()
  assert.equal(first.value, 1)
  first.$dispose()
  const second = useStore()
  assert.notEqual(second, first)
  assert.equal(second.value, 2)
})

test('reports a circular store dependency', () => {
  const id = nextId('circular')
  let useSelf!: () => object
  useSelf = defineStore(id, () => {
    useSelf()
    return {}
  })
  assert.throws(() => useSelf(), /circular store dependency/)
})

test('rejects invalid definitions', () => {
  assert.throws(() => defineStore('', () => ({})), /non-empty string id/)
  assert.throws(
    () => defineStore(nextId('invalid-return'), () => null as unknown as object)(),
    /setup must return an object/,
  )
  assert.throws(
    () => defineStore(nextId('reserved'), () => ({ $id: 'x' }))(),
    /cannot return \$id or \$dispose/,
  )
})
