import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { createSignal, NotReadyError } from 'solid-js'
import { defineGlazeComponent, listOps, listPatch } from '../src/mini.ts'
import { dataKey, normalizeDataValue } from '../src/data.ts'
import { className, styleName, textValue } from '../src/styles.ts'

const originalComponent = globalThis.Component
globalThis.Component = (config) => config
after(() => {
  if (originalComponent === undefined) delete globalThis.Component
  else globalThis.Component = originalComponent
})

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

/**
 * Instance stub matching what the generated glue calls. `paths` adds
 * replaceDataOnPath, `splice` can be disabled to exercise setData fallbacks.
 */
function createInstance(def, properties = {}, options = {}) {
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
    triggerEvent(name, detail, options_) {
      events.push({ name, detail, options: options_ })
    },
  }
  if (options.groupUpdates !== false) {
    instance.groupUpdates = (run) => run()
  }
  if (options.splice !== false) {
    instance.spliceArrayDataOnPath = (path, index, del, inserts) => {
      ops.push({ path, index, del, inserts })
    }
  }
  if (options.paths) {
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

const mergeCalls = (instance) => Object.assign({}, ...instance.calls)

// ---------------------------------------------------------------------------
// Component definition
// ---------------------------------------------------------------------------

test('declares early-init properties and one observer per property', () => {
  const def = defineGlazeComponent({
    properties: ['title', 'glazecontext'],
    data: { b0: null },
    setup() {},
  })

  assert.deepEqual(def.options, { propertyEarlyInit: true })
  assert.deepEqual(def.properties, {
    title: { type: null, value: null },
    glazecontext: { type: Object, value: null },
  })
  assert.deepEqual(Object.keys(def.observers).sort(), ['glazecontext', 'title'])
  assert.deepEqual(def.data, { b0: null })
})

test('maps camelCase prop names through propMap', () => {
  let observed
  const def = defineGlazeComponent({
    properties: ['label-text'],
    propMap: { labelText: 'label-text' },
    data: { b0: null },
    setup(ctx, props) {
      observed = props
      ctx.bind(0, () => props.labelText)
    },
  })

  const instance = createInstance(def, { 'label-text': 'Hi' })
  assert.deepEqual(instance.calls, [{ b0: 'Hi' }])
  assert.equal(observed.labelText, 'Hi')
  assert.equal('labelText' in observed, true)
  assert.deepEqual(Object.keys(observed), ['labelText'])
})

test('exposes missing props as undefined and unknown props as absent', () => {
  let observed
  const def = defineGlazeComponent({
    properties: ['title'],
    data: { b0: null },
    setup(ctx, props) {
      observed = props
      ctx.bind(0, () => props.title)
    },
  })

  const instance = createInstance(def, {})
  assert.deepEqual(instance.calls, [{ b0: null }])
  assert.equal(observed.title, undefined)
  assert.equal(observed.other, undefined)
  assert.equal('title' in observed, true)
  assert.equal('other' in observed, false)
})

test('triggers an event prop with no arguments as undefined detail', () => {
  let observed
  const def = defineGlazeComponent({
    eventProps: { onTap: 'tap' },
    data: { b0: null },
    setup(ctx, props) {
      observed = props
      ctx.bind(0, () => null)
    },
  })
  const instance = createInstance(def)

  observed.onTap()
  assert.deepEqual(instance.events, [
    { name: 'tap', detail: undefined, options: { bubbles: true, capturePhase: true } },
  ])
})

test('guards any prop that collides with a declared binding data key', () => {
  assert.throws(
    () =>
      defineGlazeComponent({
        properties: ['b3'],
        data: { b3: null },
        setup() {},
      }),
    /Property "b3" collides with generated binding data key "b3"/,
  )
})

test('allows a b-prefixed prop when data does not declare that key', () => {
  assert.doesNotThrow(() =>
    defineGlazeComponent({
      properties: ['b0'],
      data: {},
      setup() {},
    }),
  )
  const def = defineGlazeComponent({
    properties: ['b0'],
    data: {},
    setup() {},
  })
  const instance = createInstance(def, { b0: 'prop' })
  assert.deepEqual(instance.calls, [{}])
})

test('defaults component data and properties to empty objects', () => {
  const def = defineGlazeComponent({ setup() {} })
  assert.deepEqual(def.data, {})
  assert.deepEqual(def.properties, {})
  assert.deepEqual(def.observers, {})
})

// ---------------------------------------------------------------------------
// Data path helpers
// ---------------------------------------------------------------------------

test('builds dot and index data paths', () => {
  assert.equal(dataKey(['b0']), 'b0')
  assert.equal(dataKey(['b0', 0, 'done']), 'b0[0].done')
  assert.equal(dataKey(['a', 1, 'b', 2]), 'a[1].b[2]')
  assert.equal(dataKey([]), '')
})

test('normalizes only undefined data values to null', () => {
  assert.equal(normalizeDataValue(undefined), null)
  assert.equal(normalizeDataValue(null), null)
  assert.equal(normalizeDataValue(0), 0)
  assert.equal(normalizeDataValue(false), false)
  assert.equal(normalizeDataValue(''), '')
})

test('falls back to setData when the instance has no path or splice API', async () => {
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

  const instance = createInstance(def, {}, { groupUpdates: false, splice: false })
  def.lifetimes.attached.call(instance)

  setCount(1)
  await tick()
  assert.deepEqual(instance.calls.at(-1), { b0: 1, b1: 2 })
})

test('maps a nested list patch to a flat data key without a path API', async () => {
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

  const instance = createInstance(def, {}, { splice: false })
  def.lifetimes.attached.call(instance)

  setItems([{ id: 1, done: true }])
  await tick()
  assert.deepEqual(instance.calls.at(-1), { 'b0[0].done': true })
})

test('groups scalar changes and setData them when replaceDataOnPath is absent', async () => {
  let setCount
  const def = defineGlazeComponent({
    data: { b0: null },
    setup(ctx) {
      const [count, set] = createSignal(0)
      setCount = set
      ctx.bind(0, () => count())
    },
  })

  const instance = createInstance(def, {})
  def.lifetimes.attached.call(instance)

  setCount(7)
  await tick()
  assert.deepEqual(instance.pathCalls, [])
  assert.deepEqual(instance.calls.at(-1), { b0: 7 })
})

test('setData replaces a list when groupUpdates has no splice API', async () => {
  let setItems
  const def = defineGlazeComponent({
    data: { b0: null },
    listBindings: { 0: 'id' },
    setup(ctx) {
      const [items, set] = createSignal([{ id: 1 }])
      setItems = set
      ctx.bind(0, () => items())
    },
  })

  const instance = createInstance(def, {}, { splice: false })
  def.lifetimes.attached.call(instance)

  setItems([{ id: 2 }])
  await tick()
  assert.deepEqual(instance.ops, [])
  assert.deepEqual(instance.calls.at(-1), { b0: [{ id: 2 }] })
})

test('a binding group size of one keeps every binding in its own effect', async () => {
  let setA
  let setB
  const def = defineGlazeComponent({
    bindingGroupSize: 1,
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

test('a large binding group still skips unchanged bindings', async () => {
  let setA
  const def = defineGlazeComponent({
    bindingGroupSize: 100,
    data: { b0: null, b1: null, b2: null },
    setup(ctx) {
      const [a, updateA] = createSignal(0)
      setA = updateA
      ctx.bind(0, () => a())
      ctx.bind(1, () => 'fixed')
      ctx.bind(2, () => a() * 10)
    },
  })

  const instance = createInstance(def, {}, { paths: true })
  def.lifetimes.attached.call(instance)

  setA(1)
  await tick()
  assert.deepEqual(instance.pathCalls, [
    [['b0'], 1],
    [['b2'], 10],
  ])
})

test('does not rewrite a repeated NaN scalar value', async () => {
  let setCount
  const def = defineGlazeComponent({
    data: { b0: null },
    setup(ctx) {
      const [count, set] = createSignal(0)
      setCount = set
      ctx.bind(0, () => count())
    },
  })

  const instance = createInstance(def, {}, { paths: true })
  def.lifetimes.attached.call(instance)

  setCount(Number.NaN)
  await tick()
  const callsAfterFirst = instance.pathCalls.length
  assert.equal(callsAfterFirst, 1)

  setCount(Number.NaN)
  await tick()
  assert.equal(instance.pathCalls.length, callsAfterFirst)
})

// ---------------------------------------------------------------------------
// Async
// ---------------------------------------------------------------------------

test('a NotReady binding without a boundary retries on attach silently', async () => {
  const log = captureConsoleError()
  try {
    let attempts = 0
    const def = defineGlazeComponent({
      data: { b0: null },
      setup(ctx) {
        ctx.bind(0, () => {
          attempts += 1
          if (attempts === 1) throw new NotReadyError()
          return 'ready'
        })
      },
    })

    const instance = createInstance(def)
    assert.deepEqual(instance.calls, [{}])
    assert.equal(instance.__glaze.error, undefined)

    def.lifetimes.attached.call(instance)
    await tick()
    assert.deepEqual(instance.calls.at(-1), { b0: 'ready' })
    assert.deepEqual(log.errors, [])
  } finally {
    log.restore()
  }
})

test('tracks loading for a manually thrown NotReady until it resolves', async () => {
  let setReady
  const def = defineGlazeComponent({
    asyncStatus: [{ index: 1, kind: 'loading', boundary: 0 }],
    data: { b0: null, b1: null },
    setup(ctx) {
      const [ready, set] = createSignal(false)
      setReady = set
      ctx.bind(
        0,
        () => {
          if (!ready()) throw new NotReadyError()
          return 'done'
        },
        0,
      )
      ctx.bind(1, () => ctx.loading(0))
    },
  })

  const instance = createInstance(def)
  def.lifetimes.attached.call(instance)
  await tick()
  assert.equal(mergeCalls(instance).b1, true)

  setReady(true)
  await settle()
  assert.equal(mergeCalls(instance).b0, 'done')
  assert.equal(mergeCalls(instance).b1, false)
})

test('recovers from an errored binding and clears errored and error', async () => {
  let setPhase
  const def = defineGlazeComponent({
    errorBoundary: true,
    asyncStatus: [{ index: 1, kind: 'error', boundary: 0 }],
    data: { b0: null, b1: null, b2: null },
    setup(ctx) {
      const [phase, set] = createSignal(0)
      setPhase = set
      ctx.bind(
        0,
        () => {
          if (phase() === 0) throw new Error('boom')
          return 'ok'
        },
        0,
      )
      ctx.bind(1, () => ctx.errored(0))
      ctx.bind(2, () => (ctx.error(0) as Error | null)?.message ?? null)
    },
  })

  const instance = createInstance(def)
  def.lifetimes.attached.call(instance)
  await settle()
  assert.equal(mergeCalls(instance).b1, true)
  assert.equal(mergeCalls(instance).b2, 'boom')

  setPhase(1)
  await settle()
  assert.equal(mergeCalls(instance).b0, 'ok')
  assert.equal(mergeCalls(instance).b1, false)
  assert.equal(mergeCalls(instance).b2, null)
})

test('keeps a shared error source errored until every binding recovers', async () => {
  const shared = new Error('feed down')
  shared.source = 'feed'
  let setPhase
  const def = defineGlazeComponent({
    errorBoundary: true,
    asyncStatus: [{ index: 1, kind: 'error', boundary: 0 }],
    data: { b0: null, b1: null, b2: null },
    setup(ctx) {
      const [phase, set] = createSignal(0)
      setPhase = set
      ctx.bind(
        0,
        () => {
          if (phase() < 1) throw shared
          return 'a'
        },
        0,
      )
      ctx.bind(1, () => ctx.errored(0))
      ctx.bind(
        2,
        () => {
          if (phase() < 2) throw shared
          return 'b'
        },
        0,
      )
    },
  })

  const instance = createInstance(def)
  def.lifetimes.attached.call(instance)
  await settle()
  assert.equal(mergeCalls(instance).b1, true)

  setPhase(1)
  await settle()
  assert.equal(mergeCalls(instance).b0, 'a')
  assert.equal(mergeCalls(instance).b1, true)

  setPhase(2)
  await settle()
  assert.equal(mergeCalls(instance).b2, 'b')
  assert.equal(mergeCalls(instance).b1, false)
})

test('keeps loading while another binding in the boundary is pending', async () => {
  let setReadyB
  let setReadyC
  const def = defineGlazeComponent({
    asyncStatus: [{ index: 1, kind: 'loading', boundary: 0 }],
    data: { b0: null, b1: null, b2: null },
    setup(ctx) {
      const [readyB, updateB] = createSignal(false)
      const [readyC, updateC] = createSignal(false)
      setReadyB = updateB
      setReadyC = updateC
      ctx.bind(
        0,
        () => {
          if (!readyB()) throw new NotReadyError()
          return 'b'
        },
        0,
      )
      ctx.bind(1, () => ctx.loading(0))
      ctx.bind(
        2,
        () => {
          if (!readyC()) throw new NotReadyError()
          return 'c'
        },
        0,
      )
    },
  })

  const instance = createInstance(def)
  def.lifetimes.attached.call(instance)
  await settle()
  assert.equal(mergeCalls(instance).b1, true)

  setReadyB(true)
  await settle()
  assert.equal(mergeCalls(instance).b1, true)

  setReadyC(true)
  await settle()
  assert.equal(mergeCalls(instance).b1, false)
  assert.equal(mergeCalls(instance).b0, 'b')
  assert.equal(mergeCalls(instance).b2, 'c')
})

// ---------------------------------------------------------------------------
// List diffing
// ---------------------------------------------------------------------------

test('listOps handles empty arrays and rejects primitive rows', () => {
  const item = { id: 1 }
  assert.equal(listOps([], [], 'id'), null)
  assert.deepEqual(listOps([], [item], 'id'), [{ index: 0, del: 0, inserts: [item] }])
  assert.deepEqual(listOps([item], [], 'id'), [{ index: 0, del: 1, inserts: [] }])
  // Primitive rows have no key to align on, so the whole array is replaced.
  assert.equal(listOps([1, 2], [1, 3], 'x'), null)
  assert.equal(listOps([1], [1, 2], 'x'), null)
})

test('listOps reports a middle replacement', () => {
  const [a, b, c, x] = ['a', 'b', 'c', 'x'].map((id) => ({ id }))
  assert.deepEqual(listOps([a, b, c], [a, x, c], 'id'), [
    { index: 1, del: 1, inserts: [x] },
  ])
})

test('listOps inserts and deletes multiple middle items', () => {
  const items = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id }))
  const [a, b, c, d, e] = items
  const x = { id: 'x' }
  const y = { id: 'y' }

  assert.deepEqual(listOps([a, b, c, d], [a, x, y, d], 'id'), [
    { index: 1, del: 2, inserts: [x, y] },
  ])
  assert.deepEqual(listOps([a, b, c, d, e], [a, e], 'id'), [
    { index: 1, del: 3, inserts: [] },
  ])
})

test('listOps represents a pure reorder as one replacement', () => {
  const a = { id: 'a' }
  const b = { id: 'b' }
  assert.deepEqual(listOps([a, b], [b, a], 'id'), [
    { index: 0, del: 2, inserts: [b, a] },
  ])
})

test('listOps and listPatch reject *this and non-arrays', () => {
  const a = { id: 1 }
  assert.equal(listOps([a], [a], '*this'), null)
  assert.equal(listPatch([a], [a], '*this', 'b0'), null)
  assert.equal(listOps('nope', []), null)
  assert.equal(listPatch(null, [], 'id', 'b0'), null)
})

test('listPatch returns an empty patch for identical item references', () => {
  const first = { id: 1, done: false }
  const second = { id: 2, done: false }
  assert.deepEqual(listPatch([first, second], [first, second], 'id', 'b0'), [])
})

test('listPatch rejects added and removed fields', () => {
  assert.equal(listPatch([{ id: 1 }], [{ id: 1, extra: 2 }], 'id', 'b0'), null)
  assert.equal(listPatch([{ id: 1, extra: 2 }], [{ id: 1 }], 'id', 'b0'), null)
})

test('listPatches array-valued fields as whole replacements', () => {
  assert.deepEqual(
    listPatch(
      [{ id: 1, tags: ['a', 'b'] }],
      [{ id: 1, tags: ['a', 'c'] }],
      'id',
      'b0',
    ),
    [{ path: ['b0', 0, 'tags'], value: ['a', 'c'] }],
  )
})

test('a key change turns a list update into a splice', async () => {
  let setItems
  const def = defineGlazeComponent({
    data: { b0: null },
    listBindings: { 0: 'id' },
    setup(ctx) {
      const [items, set] = createSignal([{ id: 1 }])
      setItems = set
      ctx.bind(0, () => items())
    },
  })

  const instance = createInstance(def)
  def.lifetimes.attached.call(instance)

  setItems([{ id: 2 }])
  await tick()
  assert.deepEqual(instance.ops, [
    { path: ['b0'], index: 0, del: 1, inserts: [{ id: 2 }] },
  ])
})

test('a *this list binding replaces the whole array', async () => {
  let setItems
  const def = defineGlazeComponent({
    data: { b0: null },
    listBindings: { 0: '*this' },
    setup(ctx) {
      const [items, set] = createSignal([1, 2])
      setItems = set
      ctx.bind(0, () => items())
    },
  })

  const instance = createInstance(def)
  def.lifetimes.attached.call(instance)

  setItems([1, 3])
  await tick()
  assert.deepEqual(instance.ops, [])
  assert.deepEqual(instance.calls.at(-1), { b0: [1, 3] })
})

test('a new array with identical items does not reach setData', async () => {
  const first = { id: 1 }
  const second = { id: 2 }
  let setItems
  const def = defineGlazeComponent({
    data: { b0: null },
    listBindings: { 0: 'id' },
    setup(ctx) {
      const [items, set] = createSignal([first, second])
      setItems = set
      ctx.bind(0, () => items())
    },
  })

  const instance = createInstance(def)
  def.lifetimes.attached.call(instance)
  const callCount = instance.calls.length

  setItems([first, second])
  await tick()
  assert.equal(instance.calls.length, callCount)
})

// ---------------------------------------------------------------------------
// Style and text helpers
// ---------------------------------------------------------------------------

test('className flattens strings, arrays and nested arrays', () => {
  assert.equal(className('a'), 'a')
  assert.equal(className(['a', ['b', null, ''], 'c']), 'a b c')
  assert.deepEqual(className([]), '')
})

test('className reads object keys whose value is truthy', () => {
  const dynamic = 'active'
  assert.equal(className({ a: true, b: false, c: 1, [dynamic]: 'yes' }), 'a c active')
  assert.equal(className({ a: 0, b: '' }), '')
})

test('className returns an empty string for primitives', () => {
  assert.equal(className(0), '')
  assert.equal(className(null), '')
  assert.equal(className(undefined), '')
  assert.equal(className(true), '')
})

test('styleName flattens camelCase objects and drops empty values', () => {
  assert.equal(styleName('color:red'), 'color:red')
  assert.equal(
    styleName({ backgroundColor: 'red', fontSize: 12, empty: null, blank: '' }),
    'background-color:red;font-size:12',
  )
  assert.equal(styleName(null), '')
  assert.equal(styleName(42), '')
})

test('textValue drops booleans but keeps other values', () => {
  assert.equal(textValue(true), '')
  assert.equal(textValue(false), '')
  assert.equal(textValue(0), 0)
  assert.equal(textValue('x'), 'x')
  assert.equal(textValue(null), null)
})

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

test('clears event callbacks on detach and rebuilds them on re-attach', () => {
  let handled = 0
  const def = defineGlazeComponent({
    handlerCount: 1,
    data: { b0: null },
    setup(ctx) {
      ctx.bind(0, () => null)
      ctx.event(0, () => {
        handled += 1
      })
    },
  })

  const instance = createInstance(def)
  def.lifetimes.attached.call(instance)
  def.methods.e0.call(instance, {})
  assert.equal(handled, 1)

  def.lifetimes.detached.call(instance)
  assert.equal(instance.__glaze.events.length, 0)
  def.methods.e0.call(instance, {})
  assert.equal(handled, 1)

  def.lifetimes.attached.call(instance)
  assert.equal(instance.__glaze.events.length, 1)
  def.methods.e0.call(instance, {})
  assert.equal(handled, 2)
})

test('retains prop signals across detach and applies changes on re-attach', async () => {
  const def = defineGlazeComponent({
    properties: ['title'],
    data: { b0: null },
    setup(ctx, props) {
      ctx.bind(0, () => props.title)
    },
  })

  const instance = createInstance(def, { title: 'one' })
  assert.deepEqual(instance.calls, [{ b0: 'one' }])

  def.lifetimes.attached.call(instance)
  def.lifetimes.detached.call(instance)
  def.observers.title.call(instance, 'two')
  await settle()
  def.lifetimes.attached.call(instance)

  assert.deepEqual(instance.calls.at(-1), { b0: 'two' })
})

test('disposes the reactive root on detach and reports no owner', () => {
  const def = defineGlazeComponent({
    data: { b0: null },
    setup(ctx) {
      ctx.bind(0, () => 1)
    },
  })

  const instance = createInstance(def)
  def.lifetimes.attached.call(instance)
  assert.equal(typeof instance.__glaze.dispose, 'function')
  assert.notEqual(instance.__glaze.owner, null)

  def.lifetimes.detached.call(instance)
  assert.equal(instance.__glaze.dispose, null)
  assert.equal(instance.__glaze.owner, null)
  assert.equal(instance.__glaze.mounted, false)
  assert.equal(instance.__glaze.active, false)
  assert.deepEqual(instance.__glaze.pending, [])
})

test('tolerates a second detach and still re-attaches', async () => {
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
  def.lifetimes.attached.call(instance)
  def.lifetimes.detached.call(instance)
  assert.doesNotThrow(() => def.lifetimes.detached.call(instance))

  def.lifetimes.attached.call(instance)
  assert.equal(setups, 2)
  setCount(5)
  await tick()
  assert.deepEqual(instance.calls.at(-1), { b0: 5 })
})

test('defers a context component until ready and mounts it once', () => {
  let setups = 0
  const def = defineGlazeComponent({
    properties: ['glazecontext'],
    boundaryContexts: [{ name: 'Ctx', key: 'ctx' }],
    data: { b0: null },
    setup(ctx) {
      setups += 1
      ctx.bind(0, () => 'value')
    },
  })

  const instance = createInstance(def, {})
  assert.equal(setups, 0)
  assert.deepEqual(instance.calls, [])

  def.lifetimes.ready.call(instance)
  assert.equal(setups, 1)
  def.lifetimes.ready.call(instance)
  assert.equal(setups, 1)
  assert.deepEqual(instance.calls, [{ b0: 'value' }])

  def.lifetimes.attached.call(instance)
  assert.equal(setups, 1)
})

// ---------------------------------------------------------------------------
// Data proxy batching
// ---------------------------------------------------------------------------

test('keeps changes another writer queued before the flush', async () => {
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
  const queue = [[['other'], 1, undefined, undefined]]
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
    [['other'], 1, undefined, undefined],
    [['b0'], 2, undefined, undefined],
  ])
})

// ---------------------------------------------------------------------------
// Node refs
// ---------------------------------------------------------------------------

function createQueryHarness(rects) {
  return {
    createSelectorQuery() {
      const query = {
        selector: '',
        all: false,
        viewport: false,
        select(selector) {
          query.selector = selector
          return query
        },
        selectAll(selector) {
          query.selector = selector
          query.all = true
          return query
        },
        selectViewport() {
          query.viewport = true
          return query
        },
        boundingClientRect(callback) {
          const value = rects.get(query.selector)
          if (query.all) callback(Array.isArray(value) ? value : [])
          else callback(value ?? null)
          return query
        },
        scrollOffset(callback) {
          callback({ scrollTop: rects.get('__scrollTop') ?? 0 })
          return query
        },
        exec() {},
      }
      return query
    },
  }
}

function createRefInstance(rects) {
  let node
  const def = defineGlazeComponent({
    data: { b0: null },
    setup(ctx) {
      ctx.bind(0, () => null)
      ctx.ref(0, (value) => {
        node = value
      })
    },
  })
  const instance = {
    properties: {},
    __glaze: null,
    setData() {},
    ...createQueryHarness(rects),
  }
  def.lifetimes.created.call(instance)
  def.lifetimes.attached.call(instance)
  return {
    def,
    instance,
    get node() {
      return node
    },
  }
}

test('measures a node ref and re-measures it on demand', async () => {
  const rects = new Map([['#glaze-r0', { top: 10, left: 20, width: 30 }]])
  const ref = createRefInstance(rects)
  await tick()

  assert.equal(ref.node.top, 10)
  rects.set('#glaze-r0', { top: 99 })
  assert.deepEqual(await ref.node.getBoundingClientRect(), { top: 99 })
})

test('queries child nodes and returns null for a missing selector', async () => {
  const rects = new Map([
    ['#glaze-r0', { top: 0 }],
    ['#glaze-r0 .item', { top: 5 }],
    ['#glaze-r0 .list', [{ top: 1 }, { top: 2 }]],
  ])
  const ref = createRefInstance(rects)
  await tick()

  const child = await ref.node.querySelector('.item')
  assert.equal(child.top, 5)
  assert.equal(await ref.node.querySelector('.missing'), null)

  const children = await ref.node.querySelectorAll('.list')
  assert.deepEqual(
    children.map((item) => item.top),
    [1, 2],
  )
  assert.deepEqual(await ref.node.querySelectorAll('.none'), [])
})

test('scrolls into view through wx.pageScrollTo with an offset', async () => {
  const rects = new Map([
    ['#glaze-r0', { top: 10 }],
    ['__scrollTop', 5],
  ])
  const ref = createRefInstance(rects)
  await tick()

  const scrolled = []
  const originalWx = globalThis.wx
  globalThis.wx = { pageScrollTo: (input) => scrolled.push(input) }
  try {
    assert.equal(await ref.node.scrollIntoView({ offset: 3 }), true)
    assert.deepEqual(scrolled, [{ scrollTop: 12, duration: 300 }])

    assert.equal(await ref.node.scrollIntoView({ duration: 10 }), true)
    assert.deepEqual(scrolled.at(-1), { scrollTop: 15, duration: 10 })
  } finally {
    if (originalWx === undefined) delete globalThis.wx
    else globalThis.wx = originalWx
  }
})

test('scrollIntoView returns false when no scroll API exists', async () => {
  const rects = new Map([['#glaze-r0', { top: 10 }]])
  const ref = createRefInstance(rects)
  await tick()

  const originalWx = globalThis.wx
  delete globalThis.wx
  try {
    assert.equal(await ref.node.scrollIntoView({}), false)
  } finally {
    if (originalWx !== undefined) globalThis.wx = originalWx
  }
})

test('passes null to a ref callback when the selector does not match', async () => {
  const ref = createRefInstance(new Map())
  await tick()
  assert.equal(ref.node, null)
})
