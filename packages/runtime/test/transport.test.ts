import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { createSignal } from 'solid-js'
import { diffList } from '../src/list.ts'
import { defineGlazeComponent } from '../src/mini.ts'
import { createDataTransport } from '../src/transport.ts'

const originalComponent = globalThis.Component
globalThis.Component = (config) => config
after(() => {
  if (originalComponent === undefined) delete globalThis.Component
  else globalThis.Component = originalComponent
})

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

/**
 * Instance stub covering every transport capability combination. `options`
 * adds `groupUpdates`, `spliceArrayDataOnPath` and `replaceDataOnPath`; a test
 * can attach `_$dataGroup` afterwards to exercise the full proxy path.
 */
function createInstance(def, properties = {}, options = {}) {
  const calls = []
  const ops = []
  const pathCalls = []
  const instance = {
    properties,
    __glaze: null,
    calls,
    ops,
    pathCalls,
    setData(data) {
      calls.push(data)
    },
    triggerEvent() {},
  }
  if (options.groupUpdates !== false) instance.groupUpdates = (run) => run()
  if (options.splice !== false) {
    instance.spliceArrayDataOnPath = (path, index, del, inserts) => {
      ops.push({ path, index, del, inserts })
    }
  }
  if (options.replace) {
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

// ---------------------------------------------------------------------------
// Capability matrix
// ---------------------------------------------------------------------------

test('DataGroup transport keeps the existing queue and the tuple format', () => {
  const events = []
  const group = {
    queue: [['other', 1, undefined, undefined]],
    getChanges() {
      events.push('get')
      assert.equal(this, group)
      return this.queue
    },
    setChanges(changes) {
      events.push('set')
      assert.equal(this, group)
      this.queue = changes
    },
    applyDataUpdates() {
      events.push('apply')
      assert.equal(this, group)
    },
  }
  const component = {
    setData() {
      assert.fail('setData must not run when a data group exists')
    },
    groupUpdates() {
      assert.fail('groupUpdates must not run when a data group exists')
    },
    spliceArrayDataOnPath() {
      assert.fail('splice must go through the data group')
    },
    _$dataGroup: group,
  }

  const transport = createDataTransport(component)
  assert.equal(transport.kind, 'data-group')
  assert.equal(transport.canSplice, true)
  transport.apply([
    { path: ['b0'], value: 1 },
    { path: ['b1'], splice: { index: 2, del: 1, inserts: [{ id: 3 }] } },
  ])

  assert.deepEqual(group.queue, [
    ['other', 1, undefined, undefined],
    [['b0'], 1, undefined, undefined],
    [['b1'], [{ id: 3 }], 2, 1],
  ])
  assert.deepEqual(events, ['get', 'set', 'apply'])
})

test('groupUpdates + replaceDataOnPath cannot commit a splice', () => {
  const replacements = []
  const component = {
    setData() {
      assert.fail('setData must not run while replaceDataOnPath can take the change')
    },
    groupUpdates(run) {
      run()
    },
    replaceDataOnPath(path, value) {
      replacements.push([path, value])
    },
  }

  const transport = createDataTransport(component)
  assert.equal(transport.kind, 'grouped')
  assert.equal(transport.canSplice, false)

  transport.apply([{ path: ['b0'], value: 1 }])
  assert.deepEqual(replacements, [[['b0'], 1]])

  replacements.length = 0
  assert.throws(
    () => transport.apply([{ path: ['b0'], splice: { index: 0, del: 1, inserts: [] } }]),
    /cannot commit a splice/,
  )
  // Validation happens before groupUpdates, so nothing is partially applied.
  assert.deepEqual(replacements, [])
})

test('groupUpdates + spliceArrayDataOnPath commits a lone splice but reports no safe capability', () => {
  const ops = []
  const calls = []
  const component = {
    setData(data) {
      calls.push(data)
    },
    groupUpdates(run) {
      run()
    },
    spliceArrayDataOnPath(path, index, del, inserts) {
      ops.push({ path, index, del, inserts })
    },
  }

  const transport = createDataTransport(component)
  assert.equal(transport.kind, 'grouped')
  // Replacements are deferred to setData after the group, so a batch that also
  // splices could lose the splice. `canSplice` is false until
  // `replaceDataOnPath` can keep both shapes inside one group.
  assert.equal(transport.canSplice, false)

  transport.apply([{ path: ['b0'], splice: { index: 1, del: 1, inserts: [{ id: 9 }] } }])
  assert.deepEqual(ops, [{ path: ['b0'], index: 1, del: 1, inserts: [{ id: 9 }] }])

  transport.apply([{ path: ['b1'], value: 2 }])
  assert.deepEqual(calls, [{ b1: 2 }])
})

test('groupUpdates + replace + splice uses the path APIs for both shapes', () => {
  const ops = []
  const replacements = []
  const component = {
    setData() {
      assert.fail('setData must not run when both path APIs exist')
    },
    groupUpdates(run) {
      run()
    },
    replaceDataOnPath(path, value) {
      replacements.push([path, value])
    },
    spliceArrayDataOnPath(path, index, del, inserts) {
      ops.push({ path, index, del, inserts })
    },
  }

  const transport = createDataTransport(component)
  assert.equal(transport.canSplice, true)
  transport.apply([
    { path: ['b0', 0, 'done'], value: true },
    { path: ['b1'], splice: { index: 0, del: 0, inserts: [{ id: 1 }] } },
  ])

  assert.deepEqual(replacements, [[['b0', 0, 'done'], true]])
  assert.deepEqual(ops, [{ path: ['b1'], index: 0, del: 0, inserts: [{ id: 1 }] }])
})

test('grouped replace + splice applies a mixed batch in order inside the group', () => {
  const data = { b0: [{ id: 1 }] }
  const component = {
    setData() {
      assert.fail('setData must not run when both path APIs exist')
    },
    groupUpdates(run) {
      run()
    },
    replaceDataOnPath(path, value) {
      data[path[0]] = value
    },
    spliceArrayDataOnPath(path, index, del, inserts) {
      data[path[0]].splice(index, del, ...inserts)
    },
  }

  const transport = createDataTransport(component)
  assert.equal(transport.canSplice, true)
  transport.apply([
    { path: ['b0'], value: [{ id: 1 }, { id: 2 }] },
    { path: ['b0'], splice: { index: 0, del: 0, inserts: [{ id: 0 }] } },
  ])
  assert.deepEqual(data.b0, [{ id: 0 }, { id: 1 }, { id: 2 }])
})

test('a splice-only grouped transport falls back to the whole list, keeping data', () => {
  const data = { b0: [{ id: 1, title: 'old' }] }
  const component = {
    setData(update) {
      Object.assign(data, update)
    },
    groupUpdates(run) {
      run()
    },
    spliceArrayDataOnPath(path, index, del, inserts) {
      data[path[0]].splice(index, del, ...inserts)
    },
  }

  const transport = createDataTransport(component)
  assert.equal(transport.canSplice, false)

  // A structural change that also edits a retained row. Choosing a splice here
  // would drop the title edit and a replacement after the group would drop the
  // insert, so the safe capability keeps the whole-value path.
  const next = [
    { id: 1, title: 'new' },
    { id: 2, title: 'two' },
  ]
  assert.equal(diffList(data.b0, next, 'id', 'b0', transport.canSplice), null)
  transport.apply([{ path: ['b0'], value: next }])
  assert.deepEqual(data.b0, next)
})

test('plain setData transport rejects a splice instead of dropping it', () => {
  const calls = []
  const component = {
    setData(data) {
      calls.push(data)
    },
  }

  const transport = createDataTransport(component)
  assert.equal(transport.kind, 'set-data')
  assert.equal(transport.canSplice, false)

  transport.apply([{ path: ['b0', 0, 'done'], value: true }])
  assert.deepEqual(calls, [{ 'b0[0].done': true }])

  assert.throws(
    () => transport.apply([{ path: ['b0'], splice: { index: 0, del: 1, inserts: [] } }]),
    /cannot commit a splice/,
  )
  // The rejected call did not reach setData.
  assert.equal(calls.length, 1)
})

// ---------------------------------------------------------------------------
// Runtime integration
// ---------------------------------------------------------------------------

test('a splice without a group or data proxy replaces the whole list', async () => {
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

  // The splice API exists, but without `groupUpdates` it cannot be committed.
  const instance = createInstance(def, {}, { groupUpdates: false })
  def.lifetimes.attached.call(instance)

  setItems([{ id: 1 }, { id: 9 }, { id: 3 }])
  await tick()

  assert.deepEqual(instance.ops, [])
  assert.deepEqual(instance.calls.at(-1), { b0: [{ id: 1 }, { id: 9 }, { id: 3 }] })
})

test('a grouped splice-only transport replaces structural list changes with the whole list', async () => {
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

  const instance = createInstance(def, {}, { replace: false })
  def.lifetimes.attached.call(instance)

  setItems([{ id: 1 }, { id: 9 }, { id: 3 }])
  await tick()

  // Without `replaceDataOnPath`, a replacement queued after the group could
  // overwrite the splice, so the transport reports no safe splice capability.
  assert.deepEqual(instance.ops, [])
  assert.deepEqual(instance.calls.at(-1), { b0: [{ id: 1 }, { id: 9 }, { id: 3 }] })
})

test('*this list updates send a detached, unprojected payload', async () => {
  let setRows
  const def = defineGlazeComponent({
    data: { b0: null },
    listBindings: { 0: '*this' },
    setup(ctx) {
      const [rows, set] = createSignal([{ id: 1, value: 2, extra: 'keep' }])
      setRows = set
      ctx.bind(0, () => rows())
    },
  })

  const instance = createInstance(def, {}, { groupUpdates: false, splice: false })
  def.lifetimes.attached.call(instance)

  const next = [{ id: 1, value: 3, extra: 'keep' }]
  setRows(next)
  await tick()

  const payload = instance.calls.at(-1).b0
  assert.notEqual(payload, next)
  assert.notEqual(payload[0], next[0])
  // `*this` lists are never projected by the compiler; the payload keeps every
  // field and is only detached from the application row.
  assert.deepEqual(payload, next)

  payload[0].value = 99
  payload.push({ id: 2, value: 4 })
  assert.equal(next[0].value, 3)
  assert.equal(next.length, 1)
})

test('a keyed list without listFields also sends a detached payload', async () => {
  let setRows
  const row = { id: 1, value: 2 }
  const def = defineGlazeComponent({
    data: { b0: null },
    listBindings: { 0: 'id' },
    setup(ctx) {
      const [rows, set] = createSignal([row])
      setRows = set
      ctx.bind(0, () => rows())
    },
  })

  const instance = createInstance(def, {}, { groupUpdates: false, splice: false })
  def.lifetimes.attached.call(instance)

  const next = [{ id: 1, value: 2 }, { id: 2, value: 3 }]
  setRows(next)
  await tick()

  const payload = instance.calls.at(-1).b0
  assert.notEqual(payload, next)
  assert.notEqual(payload[0], next[0])
  payload[0].value = 99
  payload.push({ id: 3, value: 4 })
  assert.equal(next[0].value, 2)
  assert.equal(next.length, 2)
})

test('a throwing transport reports the failure and does not replay the batch', async () => {
  let setCount
  const def = defineGlazeComponent({
    data: { b0: null },
    setup(ctx) {
      const [count, set] = createSignal(0)
      setCount = set
      ctx.bind(0, () => count())
    },
  })

  const instance = createInstance(def, {}, { groupUpdates: false, splice: false })
  const failure = new Error('transport failed')
  let applies = 0
  instance._$dataGroup = {
    getChanges: () => [],
    setChanges: () => {},
    applyDataUpdates: () => {
      applies += 1
      throw failure
    },
  }

  const log = captureConsoleError()
  try {
    def.lifetimes.attached.call(instance)

    setCount(1)
    await tick()
    assert.equal(applies, 1)
    assert.equal(instance.__glaze.error, failure)
    assert.ok(log.errors.some((args) => String(args[0]).includes('data transport failed')))

    // `pending` was cleared and the failed batch is not replayed; the next
    // change flushes once on its own, from an invalidated baseline.
    setCount(2)
    await tick()
    assert.equal(applies, 2)
    assert.equal(instance.calls.length, 1)
  } finally {
    log.restore()
  }
})

test('a failed flush invalidates the baselines of its bindings', async () => {
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

  const instance = createInstance(def, {}, { groupUpdates: false, splice: false })
  const failure = new Error('transport failed')
  let applies = 0
  const queue = []
  const batches = []
  instance._$dataGroup = {
    getChanges: () => queue,
    setChanges: (changes) => {
      queue.splice(0, queue.length, ...changes)
    },
    applyDataUpdates: () => {
      applies += 1
      batches.push(queue.slice())
      // Consume the batch before failing: a real group does not keep it for a
      // replay either.
      queue.length = 0
      if (applies === 1) throw failure
    },
  }

  const log = captureConsoleError()
  try {
    def.lifetimes.attached.call(instance)

    // The structural change is a splice, but the flush fails before commit.
    setItems([{ id: 1 }, { id: 2 }])
    await tick()
    assert.equal(applies, 1)
    assert.equal(instance.__glaze.error, failure)

    // The next diff must not use the uncommitted splice baseline (that would
    // insert only id 3 and leave the platform without id 2).
    setItems([{ id: 1 }, { id: 2 }, { id: 3 }])
    await tick()
    assert.equal(applies, 2)
    assert.deepEqual(batches.at(-1), [
      [
        ['b0'],
        [{ id: 1 }, { id: 2 }, { id: 3 }],
        undefined,
        undefined,
      ],
    ])
  } finally {
    log.restore()
  }
})

// ---------------------------------------------------------------------------
// diffList entry point
// ---------------------------------------------------------------------------

test('diffList picks patch, splice, or whole value in one place', () => {
  const before = [{ id: 1, done: false }]
  const fieldChange = diffList(before, [{ id: 1, done: true }], 'id', 'b0', true)
  assert.deepEqual(fieldChange, [{ path: ['b0', 0, 'done'], value: true }])

  const inserted = { id: 2, done: false }
  const structural = diffList(before, [...before, inserted], 'id', 'b0', true)
  assert.deepEqual(structural, [
    { path: ['b0'], splice: { index: 1, del: 0, inserts: [inserted] } },
  ])

  // Same structural change without splice support must fall back to setData.
  assert.equal(diffList(before, [...before, inserted], 'id', 'b0', false), null)
  assert.equal(diffList([1, 2], [1, 3], 'x', 'b0', true), null)
  assert.equal(diffList(before, before, '*this', 'b0', true), null)
})

test('diffList sends the whole list when a splice would keep a changed row', () => {
  const before = [{ id: 1, title: 'old' }]
  const next = [
    { id: 1, title: 'new' },
    { id: 2, title: 'two' },
  ]
  // Row 1 is retained by the splice, so its title edit needs the whole value.
  assert.equal(diffList(before, next, 'id', 'b0', true), null)

  // A changed suffix row has the same problem.
  assert.equal(
    diffList(
      [{ id: 1 }, { id: 2, title: 'old' }],
      [{ id: 0, title: 'new' }, { id: 2, title: 'two' }],
      'id',
      'b0',
      true,
    ),
    null,
  )

  // A pure insert with unchanged retained rows still splices.
  const inserted = { id: 2, title: 'two' }
  assert.deepEqual(diffList(before, [...before, inserted], 'id', 'b0', true), [
    { path: ['b0'], splice: { index: 1, del: 0, inserts: [inserted] } },
  ])

  // Retained rows compare with the full helper, not a shallow field check.
  assert.equal(
    diffList(
      [{ id: 1, at: new Date(0), pattern: /a/g }],
      [{ id: 1, at: new Date(1), pattern: /a/g }, { id: 2 }],
      'id',
      'b0',
      true,
    ),
    null,
  )
  assert.equal(
    diffList(
      [{ id: 1, pattern: /a/g }],
      [{ id: 1, pattern: /b/g }, { id: 2 }],
      'id',
      'b0',
      true,
    ),
    null,
  )
})

test('an integration flush keeps a retained row edit and the inserted row', async () => {
  let setItems
  const def = defineGlazeComponent({
    data: { b0: null },
    listBindings: { 0: 'id' },
    setup(ctx) {
      const [items, set] = createSignal([{ id: 1, title: 'old' }])
      setItems = set
      ctx.bind(0, () => items())
    },
  })

  const instance = createInstance(def)
  const data = { b0: instance.calls[0].b0 }
  const queue = []
  let applied = false
  instance._$dataGroup = {
    getChanges: () => queue,
    setChanges: (changes) => {
      queue.splice(0, queue.length, ...changes)
    },
    applyDataUpdates: () => {
      applied = true
      for (const [path, value, index, del] of queue) {
        if (typeof index === 'number') data.b0.splice(index, del, ...value)
        else data.b0 = value
      }
      queue.length = 0
    },
  }
  def.lifetimes.attached.call(instance)

  setItems([
    { id: 1, title: 'new' },
    { id: 2, title: 'two' },
  ])
  await tick()

  assert.equal(applied, true)
  assert.deepEqual(data.b0, [
    { id: 1, title: 'new' },
    { id: 2, title: 'two' },
  ])
})


test('page path transport uses replaceDataOnPath and applyDataUpdates', () => {
  const replacements = []
  let applied = 0
  const component = {
    setData() {
      assert.fail('setData must not run when page path APIs exist')
    },
    replaceDataOnPath(path, value) {
      replacements.push([path, value])
    },
    applyDataUpdates() {
      applied += 1
    },
  }

  const transport = createDataTransport(component, true)
  assert.equal(transport.kind, 'page-path')
  assert.equal(transport.canSplice, false)

  transport.apply([
    { path: ['b0', 0, 'done'], value: true },
    { path: ['b1'], value: [{ id: 1 }] },
  ])
  assert.deepEqual(replacements, [
    [['b0', 0, 'done'], true],
    [['b1'], [{ id: 1 }]],
  ])
  assert.equal(applied, 1)

  replacements.length = 0
  assert.throws(
    () => transport.apply([{ path: ['b0'], splice: { index: 0, del: 1, inserts: [] } }]),
    /cannot commit a splice/,
  )
  assert.deepEqual(replacements, [])
  assert.equal(applied, 1)
})

test('page path transport batches a large fan-out through setData', () => {
  const calls = []
  let applied = 0
  const component = {
    setData(data) {
      calls.push(data)
    },
    replaceDataOnPath() {
      assert.fail('a large batch must use one setData payload')
    },
    applyDataUpdates() {
      applied += 1
    },
  }

  const transport = createDataTransport(component, true)
  const changes = Array.from({ length: 65 }, (_, index) => ({
    path: ['b0', index, 'title'],
    value: `row-${index}`,
  }))
  transport.apply(changes)

  assert.equal(calls.length, 1)
  assert.equal(Object.keys(calls[0]).length, 65)
  assert.equal(calls[0]['b0[0].title'], 'row-0')
  assert.equal(calls[0]['b0[64].title'], 'row-64')
  assert.equal(applied, 0)
})
