import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { createMemo, createSignal, createStore, NotReadyError } from 'solid-js'
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

test('applies object-valued scalar bindings by replacement', async () => {
  let setProfile
  const def = defineGlazeComponent({
    data: { b0: null },
    setup(ctx) {
      const [profile, set] = createSignal({ name: 'A', nested: { age: 1 } })
      setProfile = set
      ctx.bind(0, () => profile())
    },
  })

  const instance = createInstance(def, {}, { paths: true })
  def.lifetimes.attached.call(instance)

  setProfile({ name: 'A', nested: { age: 2 } })
  await tick()

  assert.deepEqual(instance.pathCalls, [[['b0'], { name: 'A', nested: { age: 2 } }]])
})

test('patches a replaced list item object as one field change', async () => {
  const second = { id: 2, title: 'two', meta: { tag: 'b' } }
  let setItems
  const def = defineGlazeComponent({
    data: { b0: null },
    listBindings: { 0: 'id' },
    setup(ctx) {
      const [items, set] = createSignal([
        { id: 1, title: 'one', meta: { tag: 'a' } },
        second,
      ])
      setItems = set
      ctx.bind(0, () => items())
    },
  })

  const instance = createInstance(def, {}, { paths: true })
  def.lifetimes.attached.call(instance)

  setItems([{ id: 1, title: 'one', meta: { tag: 'changed' } }, second])
  await tick()

  assert.deepEqual(instance.pathCalls, [
    [['b0', 0, 'meta'], { tag: 'changed' }],
  ])
})

test('store nested fields and store arrays share one runtime flush', async () => {
  let setStore
  const def = defineGlazeComponent({
    data: { b0: null, b1: null },
    listBindings: { 1: 'id' },
    setup(ctx) {
      const [state, set] = createStore({
        user: { name: 'Ada' },
        rows: [{ id: 1, title: 'one' }],
      })
      setStore = set
      ctx.bind(0, () => state.user.name)
      ctx.bind(1, () => state.rows)
    },
  })

  const instance = createInstance(def, {}, { paths: true })
  def.lifetimes.attached.call(instance)

  setStore((prev) => ({
    ...prev,
    user: { ...prev.user, name: 'Grace' },
    rows: [...prev.rows, { id: 2, title: 'two' }],
  }))
  await tick()

  assert.deepEqual(instance.pathCalls, [[['b0'], 'Grace']])
  assert.deepEqual(instance.ops, [
    { path: ['b1'], index: 1, del: 0, inserts: [{ id: 2, title: 'two' }] },
  ])
})

test('tracks async pending and errored bindings for Loading and Errored', async () => {
  const def = defineGlazeComponent({
    errorBoundary: true,
    asyncStatus: [
      { index: 1, kind: 'loading', boundary: 0 },
      { index: 3, kind: 'error', boundary: 0 },
    ],
    data: { b0: null, b1: null, b2: null, b3: null, b4: null },
    setup(ctx) {
      ctx.bind(0, () => {
        throw new NotReadyError()
      }, 0)
      ctx.bind(1, () => ctx.loading(0))
      ctx.bind(2, () => {
        throw new Error('boom')
      }, 0)
      ctx.bind(3, () => ctx.errored(0))
      ctx.bind(4, () => (ctx.error(0) as Error)?.message)
    },
  })
  const instance = createInstance(def)
  def.lifetimes.attached.call(instance)
  await tick()
  assert.equal(instance.calls.at(-1).b1, true)
  assert.equal(instance.calls.at(-1).b3, true)
  assert.equal(instance.calls.at(-1).b4, 'boom')
  assert.equal(instance.calls[0].b0, undefined)
  assert.equal(instance.calls[0].b2, undefined)
})

test('tracks nested async boundaries separately', async () => {
  const def = defineGlazeComponent({
    errorBoundary: true,
    asyncStatus: [
      { index: 1, kind: 'loading', boundary: 0 },
      { index: 3, kind: 'loading', boundary: 1 },
    ],
    data: { b0: null, b1: null, b2: null, b3: null, b4: null },
    setup(ctx) {
      ctx.bind(0, () => {
        throw new NotReadyError()
      }, 0)
      ctx.bind(1, () => ctx.loading(0))
      ctx.bind(2, () => {
        throw new NotReadyError()
      }, 1)
      ctx.bind(3, () => ctx.loading(1))
    },
  })
  const instance = createInstance(def)
  def.lifetimes.attached.call(instance)
  await tick()
  assert.equal(instance.calls.at(-1).b1, true)
  assert.equal(instance.calls.at(-1).b3, true)
})

test('derives Loading from Solid pending state across commit and refetch', async () => {
  let resolveFirst
  let resolveSecond
  const first = new Promise((resolve) => (resolveFirst = resolve))
  const second = new Promise((resolve) => (resolveSecond = resolve))
  let setPhase
  const def = defineGlazeComponent({
    asyncStatus: [{ index: 1, kind: 'loading', boundary: 0 }],
    data: { b0: null, b1: null },
    setup(ctx) {
      const [phase, set] = createSignal(0)
      setPhase = set
      const later = createMemo(async () => {
        await (phase() === 0 ? first : second)
        return `value-${phase()}`
      })
      ctx.bind(0, () => later(), 0)
      ctx.bind(1, () => ctx.loading(0))
    },
  })

  const instance = createInstance(def)
  def.lifetimes.attached.call(instance)
  await tick()
  assert.equal(instance.calls.at(-1).b1, true)

  resolveFirst()
  await tick()
  await tick()
  assert.equal(instance.calls.at(-1).b0, 'value-0')
  assert.equal(instance.calls.at(-1).b1, false)

  setPhase(1)
  await tick()
  await tick()
  assert.equal(instance.calls.at(-1).b1, true)

  resolveSecond()
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(instance.calls.at(-1).b0, 'value-1')
  assert.equal(instance.calls.at(-1).b1, false)
})

test('clears pending when a boundary binding fails instead of resolving', async () => {
  let setPhase
  const def = defineGlazeComponent({
    errorBoundary: true,
    asyncStatus: [
      { index: 1, kind: 'loading', boundary: 0 },
      { index: 2, kind: 'error', boundary: 0 },
    ],
    data: { b0: null, b1: null, b2: null },
    setup(ctx) {
      const [phase, set] = createSignal(0)
      setPhase = set
      ctx.bind(0, () => {
        if (phase() === 0) throw new NotReadyError()
        throw new Error('network down')
      }, 0)
      ctx.bind(1, () => ctx.loading(0))
      ctx.bind(2, () => ctx.errored(0))
    },
  })
  const instance = createInstance(def)
  def.lifetimes.attached.call(instance)
  await tick()
  const merged = () => Object.assign({}, ...instance.calls)
  assert.equal(merged().b1, true)

  setPhase(1)
  await tick()
  await tick()
  assert.equal(merged().b2, true)
  assert.equal(merged().b1, false)
})

test('a context-consuming component rebuilds its root when re-attached', async () => {
  let setups = 0
  let handled = 0
  let setCount
  const def = defineGlazeComponent({
    properties: ['glazecontext'],
    propMap: { glazecontext: 'glazecontext' },
    boundaryContexts: [{ name: 'Ctx', key: 'ctx' }],
    handlerCount: 1,
    data: { b0: null, b1: null },
    setup(ctx) {
      setups += 1
      const [count, set] = createSignal(0)
      setCount = set
      const doubled = createMemo(() => count() * 2)
      ctx.bind(0, () => count())
      ctx.bind(1, () => doubled())
      ctx.event(0, () => {
        handled += 1
      })
    },
  })
  const instance = createInstance(def, { glazecontext: {} })
  def.lifetimes.attached.call(instance)
  def.lifetimes.ready.call(instance)
  await tick()

  def.lifetimes.detached.call(instance)
  def.lifetimes.attached.call(instance)
  await tick()

  assert.equal(setups, 2)
  def.methods.e0.call(instance, {})
  assert.equal(handled, 1)
  setCount(2)
  await tick()
  const merged = () => Object.assign({}, ...instance.calls)
  assert.equal(merged().b0, 2)
  assert.equal(merged().b1, 4)
})

test('logs a failing binding that has no async boundary even with errorBoundary', () => {
  const log = captureConsoleError()
  try {
    const def = defineGlazeComponent({
      errorBoundary: true,
      data: { b0: null, b1: null },
      setup(ctx) {
        ctx.bind(0, () => {
          throw new Error('boundary failure')
        }, 0)
        ctx.bind(1, () => {
          throw new Error('plain failure')
        })
      },
    })

    createInstance(def)

    assert.equal(log.errors.length, 1)
    assert.match(String(log.errors[0][0]), /binding b1 failed/)
  } finally {
    log.restore()
  }
})

test('a manual NotReadyError after a commit toggles Loading', async () => {
  let setPhase
  const def = defineGlazeComponent({
    errorBoundary: true,
    asyncStatus: [{ index: 1, kind: 'loading', boundary: 0 }],
    data: { b0: null, b1: null },
    setup(ctx) {
      const [phase, set] = createSignal(0)
      setPhase = set
      ctx.bind(0, () => {
        const value = phase()
        if (value === 1) throw new NotReadyError()
        return `v${value}`
      }, 0)
      ctx.bind(1, () => ctx.loading(0))
    },
  })

  const instance = createInstance(def)
  def.lifetimes.attached.call(instance)
  await tick()
  assert.equal(instance.calls.at(-1).b0, 'v0')
  assert.equal(instance.calls.at(-1).b1, false)

  setPhase(1)
  await tick()
  assert.equal(instance.calls.at(-1).b1, true)

  setPhase(2)
  await tick()
  assert.equal(instance.calls.at(-1).b0, 'v2')
  assert.equal(instance.calls.at(-1).b1, false)
})

test('bindings sharing an error source update one Errored entry', async () => {
  let setMessage
  const def = defineGlazeComponent({
    errorBoundary: true,
    asyncStatus: [{ index: 3, kind: 'error', boundary: 0 }],
    data: { b0: null, b1: null, b2: null, b3: null, b4: null },
    setup(ctx) {
      const [message, set] = createSignal('first')
      setMessage = set
      const fail = () => {
        const error = new Error(message())
        ;(error as { source?: string }).source = 'shared'
        throw error
      }
      ctx.bind(0, fail, 0)
      ctx.bind(1, fail, 0)
      ctx.bind(2, () => ctx.errorArray(0).length)
      ctx.bind(3, () => ctx.errored(0))
      ctx.bind(4, () => (ctx.error(0) as Error | null)?.message)
    },
  })

  const instance = createInstance(def)
  def.lifetimes.attached.call(instance)
  await tick()
  const merged = () => Object.assign({}, ...instance.calls)
  assert.equal(merged().b2, 1)
  assert.equal(merged().b3, true)
  assert.equal(merged().b4, 'first')

  setMessage('second')
  await tick()
  assert.equal(merged().b2, 1)
  assert.equal(merged().b4, 'second')
})

test('primitive list items replace the whole array', async () => {
  assert.equal(listOps([1, 2], [1, 3], 'x'), null)
  assert.equal(listOps([1, 2], [2, 1], 'x'), null)
  assert.equal(listPatch([1, 2], [1, 3], 'x', 'b0'), null)
  assert.equal(listPatch([1, 2], [2, 1], 'x', 'b0'), null)
  assert.equal(listOps([{ id: 1 }], [{ id: 1, tag: 2 }], '*this'), null)
  assert.equal(listPatch([{ id: 1 }], [{ id: 1, tag: 2 }], '*this', 'b0'), null)

  let setNums
  const def = defineGlazeComponent({
    data: { b0: null },
    listBindings: { 0: 'x' },
    setup(ctx) {
      const [nums, set] = createSignal([1, 2])
      setNums = set
      ctx.bind(0, () => nums())
    },
  })
  const instance = createInstance(def)
  def.lifetimes.attached.call(instance)

  setNums([2, 1])
  await tick()
  assert.deepEqual(instance.calls.at(-1), { b0: [2, 1] })
})

test('keyed lists of primitive items still reach the data layer', async () => {
  let setNums
  const def = defineGlazeComponent({
    data: { b0: null },
    listBindings: { 0: 'x' },
    setup(ctx) {
      const [nums, set] = createSignal([1, 2])
      setNums = set
      ctx.bind(0, () => nums())
    },
  })
  const instance = createInstance(def)
  def.lifetimes.attached.call(instance)
  setNums([1, 3])
  await tick()
  assert.deepEqual(instance.calls.at(-1), { b0: [1, 3] })
})

test('props are read-only at runtime', () => {
  let observed
  const def = defineGlazeComponent({
    properties: ['title'],
    data: {},
    setup(ctx, props) {
      observed = props
      ctx.bind(0, () => props.title)
    },
  })
  createInstance(def, { title: 'Hello' })

  assert.equal(observed.title, 'Hello')
  assert.throws(() => {
    observed.title = 'Changed'
  }, /read-only/)
  assert.throws(() => {
    delete observed.title
  }, /read-only/)
  assert.equal(observed.title, 'Hello')
})

test('propSignals selects the actual prop signals', () => {
  let allProps
  const all = defineGlazeComponent({
    properties: ['title', 'other'],
    data: {},
    setup(_ctx, props) {
      allProps = props
    },
  })
  createInstance(all, { title: 'a', other: 'b' })
  assert.equal(allProps.title, 'a')
  assert.equal(allProps.other, 'b')

  let selectedProps
  const selected = defineGlazeComponent({
    properties: ['title', 'other'],
    propSignals: ['title'],
    data: {},
    setup(_ctx, props) {
      selectedProps = props
    },
  })
  createInstance(selected, { title: 'a', other: 'b' })
  assert.equal(selectedProps.title, 'a')
  assert.equal(selectedProps.other, undefined)

  let noProps
  const none = defineGlazeComponent({
    properties: ['title', 'other'],
    propSignals: [],
    data: {},
    setup(_ctx, props) {
      noProps = props
    },
  })
  createInstance(none, { title: 'a', other: 'b' })
  assert.equal(noProps.title, undefined)
  assert.equal(noProps.other, undefined)
})

test('re-arms a Loading boundary when its on dependency changes', async () => {
  let setRoute
  let setPending
  let attempts = 0
  const def = defineGlazeComponent({
    asyncStatus: [{ index: 1, kind: 'loading', boundary: 0 }],
    data: { b0: null, b1: null },
    setup(ctx) {
      const [route, updateRoute] = createSignal(0)
      const [pending, updatePending] = createSignal(false)
      setRoute = updateRoute
      setPending = updatePending
      ctx.loadingOn(0, () => route())
      ctx.bind(
        0,
        () => {
          if (pending()) throw new NotReadyError()
          return `value-${++attempts}`
        },
        0,
      )
      ctx.bind(1, () => ctx.loading(0))
    },
  })
  const instance = createInstance(def)
  def.lifetimes.attached.call(instance)
  const merged = () => Object.assign({}, ...instance.calls)
  await tick()
  assert.equal(merged().b1, false)

  // With nothing pending the trigger does not fabricate a fallback.
  setRoute(1)
  await tick()
  assert.equal(merged().b1, false)

  setPending(true)
  await tick()
  await tick()
  assert.equal(merged().b1, true)

  setPending(false)
  await tick()
  await tick()
  assert.equal(merged().b1, false)
})

test('Errored reset retries a binding that failed on every earlier attempt', async () => {
  let reset
  let calls = 0
  const def = defineGlazeComponent({
    errorBoundary: true,
    asyncStatus: [{ index: 1, kind: 'error', boundary: 0 }],
    data: { b0: null, b1: null, b2: null },
    setup(ctx) {
      reset = () => ctx.reset(0)
      ctx.bind(
        0,
        () => {
          calls += 1
          if (calls <= 2) throw new Error('boom')
          return 'recovered'
        },
        0,
      )
      ctx.bind(1, () => ctx.errored(0))
      ctx.bind(2, () => (ctx.error(0) as Error)?.message)
    },
  })
  const instance = createInstance(def)
  def.lifetimes.attached.call(instance)
  const merged = () => Object.assign({}, ...instance.calls)
  await tick()
  assert.equal(merged().b1, true)
  assert.equal(merged().b2, 'boom')

  reset()
  await tick()
  await tick()
  assert.equal(merged().b0, 'recovered')
  assert.equal(merged().b1, false)
  assert.equal(merged().b2, null)
})

test('detects a field mutated in place on a row object', async () => {
  const row = { id: 1, done: false, title: 'one' }
  const initial = [row]
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
  const instance = createInstance(def, {}, { paths: true })
  def.lifetimes.attached.call(instance)

  row.done = true
  setItems([...initial])
  await tick()
  assert.deepEqual(instance.pathCalls, [[['b0', 0, 'done'], true]])
})
