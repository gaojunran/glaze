import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { createSignal } from 'solid-js'
import { defineGlazeComponent, listOps, listPatch } from '../src/mini.ts'

const originalComponent = globalThis.Component
globalThis.Component = (config) => config
after(() => {
  if (originalComponent === undefined) delete globalThis.Component
  else globalThis.Component = originalComponent
})

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

function createInstance(def, properties = {}, { paths = false } = {}) {
  const calls = []
  const ops = []
  const events = []
  const pathCalls = []
  const instance = {
    properties,
    __glaze: null,
    calls,
    ops,
    events,
    pathCalls,
    setData(data) {
      calls.push(data)
    },
    triggerEvent(name, detail, options) {
      events.push({ name, detail, options })
    },
    groupUpdates(run) {
      run()
    },
    spliceArrayDataOnPath(path, index, del, inserts) {
      ops.push({ path, index, del, inserts })
    },
  }
  if (paths) {
    instance.replaceDataOnPath = (path, value) => pathCalls.push([path, value])
  }
  def.lifetimes.created.call(instance)
  return instance
}

function captureConsoleError() {
  const errors = []
  const original = console.error
  console.error = (...args) => errors.push(args)
  return {
    errors,
    restore() {
      console.error = original
    },
  }
}

test('initializes properties before created so first paint has prop values', () => {
  const def = defineGlazeComponent({
    properties: ['title'],
    data: { b0: null },
    setup(ctx, props) {
      ctx.bind(0, () => props.title)
    },
  })

  assert.deepEqual(def.options, { propertyEarlyInit: true })

  const instance = createInstance(def, { title: 'Hello' })
  assert.deepEqual(instance.calls, [{ b0: 'Hello' }])

  const missing = defineGlazeComponent({
    properties: ['title'],
    data: { b0: null },
    setup(ctx, props) {
      ctx.bind(0, () => props.title)
    },
  })
  const missingInstance = createInstance(missing, {})
  assert.equal(Object.hasOwn(missingInstance.calls[0], 'b0'), true)
  assert.equal(missingInstance.calls[0].b0, null)
})

test('props proxy does not leak Object.prototype members', () => {
  let observed
  const def = defineGlazeComponent({
    properties: ['title'],
    propMap: { title: 'title' },
    eventProps: { onClick: 'tap' },
    data: { b0: null },
    setup(ctx, props) {
      observed = props
      ctx.bind(0, () => props.title)
    },
  })
  const instance = createInstance(def, { title: 'Hello' })

  assert.equal(observed.title, 'Hello')
  assert.equal(typeof observed.onClick, 'function')
  assert.equal(observed.toString, undefined)
  assert.equal(observed.hasOwnProperty, undefined)
  assert.equal(observed.constructor, undefined)
  assert.equal('toString' in observed, false)
  assert.equal('hasOwnProperty' in observed, false)
  assert.deepEqual(Object.keys(observed).sort(), ['onClick', 'title'])

  observed.onClick({ detail: 1 })
  assert.deepEqual(instance.events, [
    {
      name: 'tap',
      detail: { detail: 1 },
      options: { bubbles: true, capturePhase: true },
    },
  ])
  observed.onClick(1, 2)
  assert.deepEqual(instance.events.at(-1), {
    name: 'tap',
    detail: [1, 2],
    options: { bubbles: true, capturePhase: true },
  })
})

test('one failing initial binding does not stop the other bindings', () => {
  const log = captureConsoleError()
  try {
    const def = defineGlazeComponent({
      data: { b0: null, b1: null },
      setup(ctx) {
        ctx.bind(0, () => {
          throw new Error('boom')
        })
        ctx.bind(1, () => 42)
      },
    })

    const instance = createInstance(def)
    assert.deepEqual(instance.calls, [{ b1: 42 }])
    assert.equal(log.errors.length, 1)
  } finally {
    log.restore()
  }
})

test('a binding that throws only on its first evaluation recovers in the effect', async () => {
  const log = captureConsoleError()
  try {
    let attempts = 0
    const def = defineGlazeComponent({
      data: { b0: null },
      setup(ctx) {
        ctx.bind(0, () => {
          attempts += 1
          if (attempts === 1) throw new Error('initial only')
          return 'ready'
        })
      },
    })

    const instance = createInstance(def)
    assert.deepEqual(instance.calls, [{}])

    def.lifetimes.attached.call(instance)
    await tick()
    assert.deepEqual(instance.calls.at(-1), { b0: 'ready' })
  } finally {
    log.restore()
  }
})

test('effect compute errors stay isolated to their binding', async () => {
  const log = captureConsoleError()
  try {
    let setCount
    const def = defineGlazeComponent({
      data: { b0: null, b1: null },
      setup(ctx) {
        const [count, set] = createSignal(0)
        setCount = set
        ctx.bind(0, () => {
          const value = count()
          if (value > 0) throw new Error('compute failed')
          return value
        })
        ctx.bind(1, () => count() * 2)
      },
    })

    const instance = createInstance(def)
    def.lifetimes.attached.call(instance)

    setCount(1)
    await tick()
    assert.equal(instance.calls.at(-1).b1, 2)

    setCount(2)
    await tick()
    assert.equal(instance.calls.at(-1).b1, 4)
    assert.ok(log.errors.length > 0)
  } finally {
    log.restore()
  }
})

test('batches scalar updates through replaceDataOnPath when available', async () => {
  let setCount
  const def = defineGlazeComponent({
    data: { b0: null, b1: null },
    setup(ctx) {
      const [count, set] = createSignal(0)
      setCount = set
      ctx.bind(0, () => count())
      ctx.bind(1, () => count() * 2)
    },
  })

  const instance = createInstance(def, {}, { paths: true })
  def.lifetimes.attached.call(instance)

  setCount(1)
  await tick()

  assert.equal(instance.calls.length, 1)
  assert.deepEqual(instance.pathCalls, [
    [['b0'], 1],
    [['b1'], 2],
  ])
})

test('uses replaceDataOnPath for list field patches too', async () => {
  let setItems
  const def = defineGlazeComponent({
    data: { b0: null },
    listBindings: { 0: 'id' },
    setup(ctx) {
      const [items, set] = createSignal([{ id: 1, done: false }])
      setItems = set
      ctx.bind(0, () => items())
    },
  })

  const instance = createInstance(def, {}, { paths: true })
  def.lifetimes.attached.call(instance)

  setItems([{ id: 1, done: true }])
  await tick()

  assert.deepEqual(instance.pathCalls, [[['b0', 0, 'done'], true]])
})

test('list bindings remember a shallow snapshot of the previous array', async () => {
  const first = { id: 1, done: false }
  const second = { id: 2, done: false }
  const initial = [first]
  let setItems

  const def = defineGlazeComponent({
    data: { b0: null },
    listBindings: { 0: 'id' },
    setup(ctx) {
      const [items, set] = createSignal(initial)
      setItems = set
      ctx.bind(0, () => items())
    },
  })

  const instance = createInstance(def)
  def.lifetimes.attached.call(instance)

  // Mutate the same array the signal was initialized with; the runtime must
  // still diff against the snapshot taken before the mutation.
  initial.push(second)
  setItems(initial.slice())
  await tick()

  assert.deepEqual(instance.ops, [{ path: ['b0'], index: 1, del: 0, inserts: [second] }])
})

test('groups scalar bindings across more than one batch without losing updates', async () => {
  let setCount
  const def = defineGlazeComponent({
    data: Object.fromEntries(Array.from({ length: 9 }, (_, index) => [`b${index}`, null])),
    setup(ctx) {
      const [count, set] = createSignal(0)
      setCount = set
      for (let index = 0; index < 9; index += 1) {
        ctx.bind(index, () => count() + index)
      }
    },
  })

  const instance = createInstance(def, {}, { paths: true })
  def.lifetimes.attached.call(instance)

  setCount(1)
  await tick()
  assert.equal(instance.calls.length, 1)
  assert.equal(instance.pathCalls.length, 9)
  assert.deepEqual(
    instance.pathCalls.map(([path, value]) => [path[0], value]),
    Array.from({ length: 9 }, (_, index) => [`b${index}`, 1 + index]),
  )
})

test('a flush queued before detach does not call setData', async () => {
  let setCount
  const def = defineGlazeComponent({
    data: { b0: null },
    setup(ctx) {
      const [count, set] = createSignal(0)
      setCount = set
      ctx.bind(0, () => count())
    },
  })

  const instance = createInstance(def)
  def.lifetimes.attached.call(instance)

  setCount(1)
  def.lifetimes.detached.call(instance)
  await tick()

  assert.deepEqual(instance.calls, [{ b0: 0 }])
})

test('stops setData after detach and rebuilds effects on re-attach', async () => {
  let setCount
  let setups = 0
  const def = defineGlazeComponent({
    data: { b0: null },
    setup(ctx) {
      setups += 1
      const [count, set] = createSignal(0)
      setCount = set
      ctx.bind(0, () => count())
    },
  })

  const instance = createInstance(def)
  assert.equal(setups, 1)
  assert.deepEqual(instance.calls, [{ b0: 0 }])

  def.lifetimes.attached.call(instance)
  setCount(1)
  await tick()
  assert.deepEqual(instance.calls.at(-1), { b0: 1 })

  def.lifetimes.detached.call(instance)
  const callCount = instance.calls.length
  setCount(2)
  await tick()
  assert.equal(instance.calls.length, callCount)

  const firstSetCount = setCount
  def.lifetimes.attached.call(instance)
  assert.equal(setups, 2)
  assert.deepEqual(instance.calls.at(-1), { b0: 0 })

  // The old root is gone: its setter must not reach setData any more.
  firstSetCount(2)
  await tick()
  assert.deepEqual(instance.calls.at(-1), { b0: 0 })

  setCount(3)
  await tick()
  assert.deepEqual(instance.calls.at(-1), { b0: 3 })
})

test('rejects a prop that collides with a generated binding data key', () => {
  assert.throws(
    () =>
      defineGlazeComponent({
        properties: ['b0'],
        data: { b0: null },
        setup() {},
      }),
    /collides with generated binding data key "b0"/,
  )
})

test('listOps and listPatch describe structural changes', () => {
  const first = { id: 1, done: false }
  const second = { id: 2, done: false }

  assert.deepEqual(listOps([first], [first, second], 'id'), [
    { index: 1, del: 0, inserts: [second] },
  ])
  assert.equal(listOps([first], [first], 'id'), null)
  assert.deepEqual(listPatch([{ id: 1, done: false }], [{ id: 1, done: true }], 'id', 'b0'), [
    { path: ['b0', 0, 'done'], value: true },
  ])
  assert.equal(
    listPatch([{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 1 }], 'id', 'b0'),
    null,
  )
})

test('flushes structured DataChange tuples through the glass-easel data proxy', async () => {
  let setCount
  const def = defineGlazeComponent({
    data: { b0: null, b1: null },
    setup(ctx) {
      const [count, set] = createSignal(0)
      setCount = set
      ctx.bind(0, () => count())
      ctx.bind(1, () => count() + 1)
    },
  })

  const instance = createInstance(def)
  const queue = []
  let applied = 0
  instance._$dataGroup = {
    getChanges: () => queue,
    setChanges: (changes) => {
      queue.splice(0, queue.length, ...changes)
    },
    applyDataUpdates: () => {
      applied += 1
    },
  }
  def.lifetimes.attached.call(instance)

  setCount(2)
  await tick()

  assert.equal(applied, 1)
  assert.deepEqual(queue, [
    [['b0'], 2, undefined, undefined],
    [['b1'], 3, undefined, undefined],
  ])
})

test('keeps splices in the same data proxy batch', async () => {
  let setItems
  const def = defineGlazeComponent({
    data: { b0: null },
    listBindings: { 0: 'id' },
    setup(ctx) {
      const [items, set] = createSignal([{ id: 1 }, { id: 2 }, { id: 3 }])
      setItems = set
      ctx.bind(0, () => items())
    },
  })

  const instance = createInstance(def)
  const queue = []
  instance._$dataGroup = {
    getChanges: () => queue,
    setChanges: (changes) => {
      queue.splice(0, queue.length, ...changes)
    },
    applyDataUpdates: () => {},
  }
  def.lifetimes.attached.call(instance)

  setItems([{ id: 1 }, { id: 9 }, { id: 3 }])
  await tick()

  assert.deepEqual(queue, [[['b0'], [{ id: 9 }], 1, 1]])
})

test('a grouped scalar effect only schedules the bindings that changed', async () => {
  let setA
  let setB
  const def = defineGlazeComponent({
    data: { b0: null, b1: null },
    setup(ctx) {
      const [a, updateA] = createSignal(0)
      const [b, updateB] = createSignal(0)
      setA = updateA
      setB = updateB
      ctx.bind(0, () => a())
      ctx.bind(1, () => b())
    },
  })

  const instance = createInstance(def, {}, { paths: true })
  def.lifetimes.attached.call(instance)

  setA(1)
  await tick()
  assert.deepEqual(instance.pathCalls, [[['b0'], 1]])

  instance.pathCalls.length = 0
  setB(2)
  await tick()
  assert.deepEqual(instance.pathCalls, [[['b1'], 2]])
})

test('the first effect run does not rewrite values already sent by mount', async () => {
  const def = defineGlazeComponent({
    data: { b0: null, b1: null },
    setup(ctx) {
      const [count] = createSignal(0)
      ctx.bind(0, () => count())
      ctx.bind(1, () => count() + 1)
    },
  })

  const instance = createInstance(def, {}, { paths: true })
  def.lifetimes.attached.call(instance)
  await tick()

  assert.equal(instance.pathCalls.length, 0)
  assert.equal(instance.calls.length, 1)
})
