import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import {
  createContext,
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  createStore,
  flush,
  NotReadyError,
  onCleanup,
} from 'solid-js'
import {
  defineGlazeComponent,
  diffList,
  isFlatList,
  listOps,
  listPatch,
  onAppError,
  onAppHide,
  onAppShow,
  onComponentError,
  onUnhandledRejection,
  projectList,
  useCommit,
  useLaunchOptions,
  usePageSize,
  usePageVisible,
} from '../src/mini.ts'
import { trackListValue } from '../src/list.ts'
import { withProvider } from '../src/provider.ts'

const originalComponent = globalThis.Component
globalThis.Component = (config) => config
after(() => {
  if (originalComponent === undefined) delete globalThis.Component
  else globalThis.Component = originalComponent
})

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

function createInstance(def, properties = {}, { paths = false, backend = null } = {}) {
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
    getBackendContext: backend ? () => backend : undefined,
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

test('seeds page size from wx.getWindowInfo when present', () => {
  const original = (globalThis as { wx?: unknown }).wx
  ;(globalThis as { wx?: unknown }).wx = {
    getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844 }),
  }
  try {
    let page
    const def = defineGlazeComponent({
      data: {},
      setup(ctx) {
        page = ctx
      },
    })
    createInstance(def)
    assert.deepEqual(page.pageSize(), { windowWidth: 390, windowHeight: 844 })
  } finally {
    ;(globalThis as { wx?: unknown }).wx = original
  }
})

test('page events store payloads and return handler results', async () => {
  let page
  const def = defineGlazeComponent({
    data: {},
    setup(ctx) {
      page = ctx
      ctx.onPageEvent('shareAppMessage', () => ({ title: 'shared' }))
      ctx.onPageEvent('scroll', () => undefined)
    },
  })
  const instance = createInstance(def)

  assert.equal(def.methods.__glazePageEvent.call(instance, 'scroll', { scrollTop: 12 }), undefined)
  await tick()
  assert.deepEqual(page.pageEvent('scroll'), { scrollTop: 12 })
  assert.deepEqual(
    def.methods.__glazePageEvent.call(instance, 'shareAppMessage', { from: 'menu' }),
    { title: 'shared' },
  )
})

test('routeDone and component move/detach hooks are exposed', async () => {
  let page
  let moves = 0
  let detaches = 0
  const def = defineGlazeComponent({
    data: {},
    setup(ctx) {
      page = ctx
      ctx.onComponentMoved(() => {
        moves += 1
      })
      ctx.onBeforeDetach(() => {
        detaches += 1
      })
    },
  })
  const instance = createInstance(def)

  def.lifetimes.moved.call(instance)
  def.lifetimes.beforeDetach.call(instance)
  def.pageLifetimes.routeDone.call(instance, { path: '/pages/home' })
  await tick()

  assert.equal(moves, 1)
  assert.equal(detaches, 1)
  assert.deepEqual(page.pageEvent('routeDone'), { path: '/pages/home' })
})

test('app visibility follows wx.onAppShow and wx.onAppHide', async () => {
  const original = (globalThis as { wx?: unknown }).wx
  const listeners = {}
  ;(globalThis as { wx?: unknown }).wx = {
    onAppShow: (listener) => {
      listeners.show = listener
    },
    onAppHide: (listener) => {
      listeners.hide = listener
    },
  }
  try {
    let page
    const def = defineGlazeComponent({
      data: {},
      setup(ctx) {
        page = ctx
        ctx.appVisible()
      },
    })
    createInstance(def)
    assert.equal(page.appVisible(), true)

    listeners.hide()
    await tick()
    assert.equal(page.appVisible(), false)
    listeners.show({ scene: 1001 })
    await tick()
    assert.equal(page.appVisible(), true)
  } finally {
    ;(globalThis as { wx?: unknown }).wx = original
  }
})

test('prototype-named props read the scalar property, not the compact object', () => {
  let page
  const def = defineGlazeComponent({
    data: {},
    properties: ['title', 'done', 'constructor'],
    structuredProps: true,
    setup(ctx, props) {
      page = { props, ctx }
    },
  })
  createInstance(def, {
    title: 'scalar-title',
    done: true,
    constructor: 'scalar-constructor',
    glazeprops: { title: 'object-title', done: false },
  })
  assert.equal(page.props.constructor, 'scalar-constructor')
  assert.equal(page.props.title, 'object-title')
  assert.equal(page.props.done, false)
})

test('app lifecycle callbacks and launch options follow wx', async () => {
  const original = (globalThis as { wx?: unknown }).wx
  const listeners = {}
  ;(globalThis as { wx?: unknown }).wx = {
    getLaunchOptionsSync: () => ({ path: 'pages/home', query: { id: '1' } }),
    onAppShow: (listener) => {
      listeners.show = listener
    },
    onAppHide: (listener) => {
      listeners.hide = listener
    },
    onError: (listener) => {
      listeners.error = listener
    },
    onUnhandledRejection: (listener) => {
      listeners.rejection = listener
    },
  }
  try {
    let page
    const seen = { show: [], hide: 0, error: null, rejection: null }
    const def = defineGlazeComponent({
      data: {},
      setup(ctx) {
        page = ctx
        onAppShow((options) => seen.show.push(options))
        onAppHide(() => {
          seen.hide += 1
        })
        onAppError((error) => {
          seen.error = error
        })
        onUnhandledRejection((reason) => {
          seen.rejection = reason
        })
        useLaunchOptions()
      },
    })
    const instance = createInstance(def)

    assert.deepEqual(page.appLaunchOptions(), { path: 'pages/home', query: { id: '1' } })
    listeners.show({ scene: 1001 })
    listeners.hide()
    const failure = new Error('boom')
    listeners.error(failure)
    listeners.rejection({ reason: 'no' })
    await tick()

    assert.deepEqual(seen.show, [{ scene: 1001 }])
    assert.equal(seen.hide, 1)
    assert.equal(seen.error, failure)
    assert.equal(seen.rejection, 'no')

    def.lifetimes.detached.call(instance)
    listeners.show({ scene: 1002 })
    assert.equal(seen.show.length, 1)
  } finally {
    ;(globalThis as { wx?: unknown }).wx = original
  }
})

test('binding errors reach onComponentError', async () => {
  const seen = []
  const def = defineGlazeComponent({
    data: { b0: null },
    setup(ctx) {
      ctx.onComponentError((error) => seen.push(error))
      ctx.bind(0, () => {
        throw new Error('binding boom')
      })
    },
  })
  createInstance(def)
  await tick()

  assert.equal(seen.length, 1)
  assert.match(String(seen[0]), /binding boom/)
})

test('page lifecycles update page visibility and size signals', async () => {
  let page
  const def = defineGlazeComponent({
    data: {},
    setup(ctx) {
      page = ctx
    },
  })
  const instance = createInstance(def)

  assert.equal(page.pageVisible(), true)
  def.pageLifetimes.hide.call(instance)
  await tick()
  assert.equal(page.pageVisible(), false)
  def.pageLifetimes.show.call(instance)
  await tick()
  assert.equal(page.pageVisible(), true)

  def.pageLifetimes.resize.call(instance, {
    size: { windowWidth: 320, windowHeight: 640 },
  })
  await tick()
  assert.deepEqual(page.pageSize(), { windowWidth: 320, windowHeight: 640 })
})

test('page and error hooks work from the component setup body', async () => {
  const capture = captureConsoleError()
  try {
    let visible
    let size
    const seen = []
    const def = defineGlazeComponent({
      data: {},
      setup() {
        visible = usePageVisible()
        size = usePageSize()
        onComponentError((error) => seen.push(error))
      },
    })
    const instance = createInstance(def)

    def.pageLifetimes.hide.call(instance)
    def.pageLifetimes.resize.call(instance, {
      size: { windowWidth: 300, windowHeight: 600 },
    })
    def.lifetimes.error.call(instance, new Error('hooked'))
    await tick()

    assert.equal(visible(), false)
    assert.deepEqual(size(), { windowWidth: 300, windowHeight: 600 })
    assert.equal(seen.length, 1)
  } finally {
    capture.restore()
  }
})

test('hooks throw outside a component setup body', () => {
  assert.throws(() => usePageVisible(), /during component setup/)
  assert.throws(() => usePageSize(), /during component setup/)
  assert.throws(() => useLaunchOptions(), /during component setup/)
  assert.throws(() => onComponentError(() => {}), /during component setup/)
  assert.throws(() => onAppShow(() => {}), /during component setup/)
  assert.throws(() => onAppHide(() => {}), /during component setup/)
  assert.throws(() => onAppError(() => {}), /during component setup/)
  assert.throws(() => onUnhandledRejection(() => {}), /during component setup/)
})

test('error lifetime stores the error and notifies and unsubscribes handlers', () => {
  const capture = captureConsoleError()
  try {
    let page
    const seen = []
    const def = defineGlazeComponent({
      data: {},
      setup(ctx) {
        page = ctx
        ctx.onComponentError((error) => seen.push(error))
        const remove = ctx.onComponentError((error) => seen.push(error))
        remove()
      },
    })
    const instance = createInstance(def)
    const error = new Error('boom')

    def.lifetimes.error.call(instance, error)

    assert.equal(instance.__glaze.error, error)
    assert.deepEqual(seen, [error])
  } finally {
    capture.restore()
  }
})

test('defers exparser setup to attached so parent props are visible', () => {
  let seen: unknown = 'not-run'
  const def = defineGlazeComponent({
    componentFramework: 'exparser',
    properties: ['title'],
    data: { b0: null },
    setup(ctx, props) {
      seen = props.title
      ctx.bind(0, () => props.title)
    },
  })

  assert.deepEqual(def.options, {})
  const instance = createInstance(def, { title: 'default' })
  assert.equal(seen, 'not-run')
  assert.deepEqual(instance.calls, [])

  instance.properties.title = 'Parent'
  def.lifetimes.attached.call(instance)

  assert.equal(seen, 'Parent')
  assert.equal(instance.calls[0].b0, 'Parent')
})

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

test('reads structured props and falls back to the scalar property', async () => {
  let observed
  const def = defineGlazeComponent({
    properties: ['title', 'done'],
    propSignals: ['title'],
    structuredProps: true,
    data: { b0: null },
    setup(ctx, props) {
      observed = props
      ctx.bind(0, () => props.title)
    },
  })
  const instance = createInstance(def, {
    title: 'scalar',
    glazeprops: { title: 'structured' },
  })
  def.lifetimes.attached.call(instance)

  assert.equal(observed.title, 'structured')
  assert.equal(instance.calls[0].b0, 'structured')
  assert.equal(observed.glazeprops, undefined)
  assert.deepEqual(Object.keys(observed), ['title'])

  instance.properties.glazeprops = { title: 'next' }
  def.observers.glazeprops.call(instance, { title: 'next' })
  await tick()
  assert.equal(observed.title, 'next')
  assert.equal(instance.calls.at(-1).b0, 'next')

  instance.properties.glazeprops = { title: null }
  def.observers.glazeprops.call(instance, { title: null })
  await tick()
  assert.equal(observed.title, undefined)

  instance.properties.glazeprops = { title: undefined }
  def.observers.glazeprops.call(instance, { title: undefined })
  await tick()
  assert.equal(observed.title, 'scalar')

  instance.properties.glazeprops = null
  def.observers.glazeprops.call(instance, null)
  await tick()
  assert.equal(observed.title, 'scalar')
})

test('rejects a case variant of the structured property name', () => {
  assert.throws(
    () =>
      defineGlazeComponent({
        properties: ['glazeProps'],
        structuredProps: true,
        setup() {},
      }),
    /reserved property "glazeprops"/,
  )
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

test('normalizes an undefined list payload to null on mount and update', async () => {
  let setRows
  const def = defineGlazeComponent({
    data: { b0: null },
    listBindings: { 0: 'id' },
    setup(ctx) {
      const [rows, set] = createSignal(undefined)
      setRows = set
      ctx.bind(0, () => rows())
    },
  })

  const instance = createInstance(def)
  assert.equal(instance.calls[0].b0, null)

  def.lifetimes.attached.call(instance)
  setRows([{ id: 1 }])
  await tick()
  setRows(undefined)
  await tick()
  assert.equal(instance.calls.at(-1).b0, null)
})

test('flat projected payload keeps its baseline independent', async () => {
  let setRows
  const def = defineGlazeComponent({
    data: { b0: null },
    listBindings: { 0: 'id' },
    listFields: { 0: ['id', 'title'] },
    setup(ctx) {
      const [rows, set] = createSignal([{ id: 1, title: 'one' }])
      setRows = set
      ctx.bind(0, () => rows())
    },
  })
  const instance = createInstance(def)
  def.lifetimes.attached.call(instance)

  const payload = instance.calls[0].b0
  payload[0].title = 'mutated by platform'
  const callCount = instance.calls.length
  setRows([{ id: 1, title: 'one' }])
  await tick()

  assert.equal(instance.calls.length, callCount)
})

test('isFlatList only accepts plain rows with primitive fields', () => {
  assert.equal(isFlatList([{ id: 1, title: 'one' }]), true)
  assert.equal(isFlatList([{ id: 1, meta: {} }]), false)
  assert.equal(isFlatList([{ id: 1, tags: ['a'] }]), false)
  assert.equal(isFlatList([{ id: 1, when: new Date() }]), false)
  assert.equal(isFlatList([1, 2]), false)
})

test('projects only the fields the compiler recorded for a keyed list', () => {
  const rows = [
    { id: 1, title: 'one', extra: 'x'.repeat(2000) },
    { id: 2, title: 'two', extra: 'y'.repeat(2000) },
  ]
  const def = defineGlazeComponent({
    data: { b0: null },
    listBindings: { 0: 'id' },
    listFields: { 0: ['id', 'title'] },
    setup(ctx) {
      ctx.bind(0, () => rows)
    },
  })

  const instance = createInstance(def)
  assert.deepEqual(instance.calls[0].b0, [
    { id: 1, title: 'one' },
    { id: 2, title: 'two' },
  ])
})

test('projects list updates and still emits one field path', async () => {
  let setRows
  const rows = [{ id: 1, title: 'one', extra: 'x'.repeat(2000) }]
  const def = defineGlazeComponent({
    data: { b0: null },
    listBindings: { 0: 'id' },
    listFields: { 0: ['id', 'title'] },
    setup(ctx) {
      const [items, set] = createSignal(rows)
      setRows = set
      ctx.bind(0, () => items())
    },
  })

  const instance = createInstance(def, {}, { paths: true })
  def.lifetimes.attached.call(instance)

  setRows([{ id: 1, title: 'two', extra: 'changed but unused' }])
  await tick()

  assert.deepEqual(instance.pathCalls, [[['b0', 0, 'title'], 'two']])
})

test('keeps the key in the projection even when the template does not read it', () => {
  const rows = [{ id: 7, title: 'one', extra: 'x' }]
  const def = defineGlazeComponent({
    data: { b0: null },
    listBindings: { 0: 'id' },
    listFields: { 0: ['title'] },
    setup(ctx) {
      ctx.bind(0, () => rows)
    },
  })

  const instance = createInstance(def)
  assert.deepEqual(instance.calls[0].b0, [{ id: 7, title: 'one' }])
})

test('falls back to the original list when rows are not plain objects', () => {
  const primitives = [1, 2]
  assert.equal(projectList(primitives, ['id']), primitives)

  class Row {
    constructor(id) {
      this.id = id
    }
  }
  const instances = [new Row(1)]
  assert.equal(projectList(instances, ['id']), instances)
})

test('projected rows are detached from the application rows', () => {
  const row = { id: 1, title: 'first', extra: 'x' }
  const rows = [row]
  const def = defineGlazeComponent({
    data: { b0: null },
    listBindings: { 0: 'id' },
    listFields: { 0: ['id', 'title'] },
    setup(ctx) {
      ctx.bind(0, () => rows)
    },
  })

  const instance = createInstance(def)
  instance.calls[0].b0[0].title = 'mutated by platform'
  assert.equal(row.title, 'first')
})

test('projected object fields are detached before entering data', () => {
  const meta = { done: false, extra: 'x' }
  const rows = [{ id: 1, title: 'one', meta }]
  const def = defineGlazeComponent({
    data: { b0: null },
    listBindings: { 0: 'id' },
    listFields: { 0: ['id', 'title', 'meta'] },
    setup(ctx) {
      ctx.bind(0, () => rows)
    },
  })

  const instance = createInstance(def)
  const initial = instance.calls[0].b0[0]
  assert.notEqual(initial.meta, meta)
  initial.meta.done = true
  assert.equal(meta.done, false)
})

test('initial list data is detached from the source array', () => {
  const row = { id: 1, title: 'first' }
  const rows = [row]
  const def = defineGlazeComponent({
    data: { b0: null },
    listBindings: { 0: 'id' },
    setup(ctx) {
      ctx.bind(0, () => rows)
    },
  })

  const instance = createInstance(def)
  const initial = instance.calls[0].b0
  assert.notEqual(initial, rows)
  assert.notEqual(initial[0], row)

  // A platform path update mutates the data object in place. It must not
  // reach the array or row objects owned by application state.
  initial[0].title = 'mutated by platform'
  assert.equal(row.title, 'first')
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

  const instance = createInstance(def, {}, { paths: true })
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

test('coalesces updates into one view-frame commit when the host exposes a backend', async () => {
  let setCount
  const frames = []
  const def = defineGlazeComponent({
    data: { b0: null, b1: null },
    setup(ctx) {
      const [count, set] = createSignal(0)
      setCount = set
      ctx.bind(0, () => count())
      ctx.bind(1, () => count() + 1)
    },
  })

  const instance = createInstance(def, {}, { backend: { render: (callback) => frames.push(callback) } })
  def.lifetimes.attached.call(instance)
  const before = instance.calls.length

  setCount(1)
  setCount(2)
  await tick()
  assert.equal(frames.length, 1)
  assert.equal(instance.calls.length, before)

  frames[0]()
  await tick()
  assert.equal(instance.calls.length, before + 1)
  assert.deepEqual(instance.calls.at(-1), { b0: 2, b1: 3 })
})

test('keeps a component root without a boundary on microtask commits', async () => {
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
  const frames = []
  instance.setData = (data, callback) => {
    instance.calls.push(data)
    if (Object.keys(data).length === 0) frames.push(callback)
  }
  def.lifetimes.attached.call(instance)
  const before = instance.calls.length

  setCount(1)
  await tick()
  assert.equal(frames.length, 0)
  assert.equal(instance.calls.length, before + 1)
  assert.deepEqual(instance.calls.at(-1), { b0: 1 })
})

test('uses the frame token on a component with a boundary', async () => {
  const holder = globalThis as unknown as { wx?: unknown }
  const originalWx = holder.wx
  holder.wx = {}
  try {
    let setCount
    const def = defineGlazeComponent({
      boundaries: [
        { id: 0, kind: 'loading', parent: null, region: 'content', content: [0], children: [], keepPrevious: true },
      ],
      data: { b0: null },
      setup(ctx) {
        const [count, set] = createSignal(0)
        setCount = set
        ctx.bind(0, () => count())
      },
    })

    const instance = createInstance(def)
    const frames = []
    instance.setData = (data, callback) => {
      instance.calls.push(data)
      if (Object.keys(data).length === 0) frames.push(callback)
    }
    def.lifetimes.attached.call(instance)
    const dataCalls = () => instance.calls.filter((data) => Object.keys(data).length > 0)
    const before = dataCalls().length

    setCount(1)
    await tick()
    assert.ok(frames.length > 0)
    assert.equal(dataCalls().length, before)

    for (const frame of frames) frame()
    await tick()
    assert.equal(dataCalls().length, before + 1)
    assert.deepEqual(dataCalls().at(-1), { b0: 1 })
  } finally {
    if (originalWx === undefined) delete holder.wx
    else holder.wx = originalWx
  }
})

test('ctx.commit waits for the view frame on a boundary component', async () => {
  const holder = globalThis as unknown as { wx?: unknown }
  const originalWx = holder.wx
  holder.wx = {}
  try {
    let setCount
    let commit
    const def = defineGlazeComponent({
      boundaries: [
        { id: 0, kind: 'loading', parent: null, region: 'content', content: [0], children: [], keepPrevious: true },
      ],
      data: { b0: null },
      setup(ctx) {
        const [count, set] = createSignal(0)
        setCount = set
        commit = () => ctx.commit()
        ctx.bind(0, () => count())
      },
    })

    const instance = createInstance(def)
    const frames = []
    instance.setData = (data, callback) => {
      instance.calls.push(data)
      if (Object.keys(data).length === 0) frames.push(callback)
    }
    def.lifetimes.attached.call(instance)
    const dataCalls = () => instance.calls.filter((data) => Object.keys(data).length > 0)
    const before = dataCalls().length

    setCount(1)
    let settled = false
    const pending = commit().then(() => {
      settled = true
    })
    await tick()
    assert.equal(settled, false)
    assert.equal(dataCalls().length, before)
    assert.ok(frames.length > 0)

    for (const frame of frames) frame()
    await pending
    assert.equal(settled, true)
    assert.equal(dataCalls().length, before + 1)
    assert.deepEqual(dataCalls().at(-1), { b0: 1 })
  } finally {
    if (originalWx === undefined) delete holder.wx
    else holder.wx = originalWx
  }
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

test('a stale frame callback does not flush a later attach', async () => {
  let setCount
  const frames = []
  const def = defineGlazeComponent({
    data: { b0: null },
    setup(ctx) {
      const [count, set] = createSignal(0)
      setCount = set
      ctx.bind(0, () => count())
    },
  })

  const instance = createInstance(def, {}, { backend: { render: (callback) => frames.push(callback) } })
  def.lifetimes.attached.call(instance)
  setCount(1)
  await tick()
  assert.equal(frames.length, 1)

  def.lifetimes.detached.call(instance)
  def.lifetimes.attached.call(instance)
  const before = instance.calls.length
  setCount(2)
  await tick()
  assert.equal(frames.length, 2)

  frames[0]()
  await tick()
  assert.equal(instance.calls.length, before)

  frames[1]()
  await tick()
  assert.deepEqual(instance.calls.at(-1), { b0: 2 })
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

  assert.deepEqual(listOps([first], [first, second], 'id'), {
    index: 1,
    del: 0,
    inserts: [second],
  })
  assert.equal(listOps([first], [first], 'id'), null)
  assert.deepEqual(listPatch([{ id: 1, done: false }], [{ id: 1, done: true }], 'id', 'b0'), [
    { path: ['b0', 0, 'done'], value: true },
  ])
  assert.equal(
    listPatch([{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 1 }], 'id', 'b0'),
    null,
  )
  assert.deepEqual(
    listPatch(
      [{ id: 1, a: 1, b: 2, c: 3 }],
      [{ id: 1, a: 9, b: 8, c: 7 }],
      'id',
      'b0',
    ),
    [{ path: ['b0', 0], value: { id: 1, a: 9, b: 8, c: 7 } }],
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

test('patches a replaced nested field at its leaf', async () => {
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
    [['b0', 0, 'meta', 'tag'], 'changed'],
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

test('trackListValue reads only the projected fields', () => {
  const [state, setState] = createStore({
    rows: [{ id: 1, title: 'one', extra: 0 }],
  })
  let runs = 0
  createRoot((dispose) => {
    createEffect(
      () => {
        runs += 1
        trackListValue(state.rows, ['id', 'title'])
      },
      { effect() {} },
    )
    return dispose
  })
  flush()
  assert.equal(runs, 1)

  setState((draft) => {
    draft.rows[0].extra = 1
  })
  flush()
  assert.equal(runs, 1)

  setState((draft) => {
    draft.rows[0].title = 'two'
  })
  flush()
  assert.equal(runs, 2)
})

test('an unkeyed store array re-sends after an in-place mutation', async () => {
  let setStore
  const def = defineGlazeComponent({
    data: { b0: null },
    setup(ctx) {
      const [state, set] = createStore({ rows: [{ id: 1, title: 'one' }] })
      setStore = set
      ctx.bind(0, () => state.rows)
    },
  })

  const instance = createInstance(def)
  def.lifetimes.attached.call(instance)

  setStore((draft) => {
    draft.rows.push({ id: 2, title: 'two' })
  })
  await tick()

  const last = instance.calls.at(-1)
  assert.equal(last.b0.length, 2)
  assert.equal(last.b0[1].title, 'two')
})

test('tracks async pending and errored bindings for Loading and Errored', async () => {
  const def = defineGlazeComponent({
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
  assert.equal(instance.calls.some((call) => call.b1 === true), true)
  assert.equal(instance.calls.some((call) => call.b3 === true), true)
  assert.equal(instance.calls.at(-1).b4, 'boom')
  assert.equal(instance.calls[0].b0, undefined)
  assert.equal(instance.calls[0].b2, undefined)
})

test('keeps the previous value while a settled Loading boundary refetches', async () => {
  let setPhase
  const def = defineGlazeComponent({
    asyncStatus: [
      { index: 1, kind: 'loading', boundary: 0 },
      { index: 2, kind: 'settled', boundary: 0 },
    ],
    data: { b0: null, b1: null, b2: null },
    setup(ctx) {
      const [phase, set] = createSignal(0)
      setPhase = set
      ctx.bind(0, () => {
        if (phase() !== 1) throw new NotReadyError()
        return 'value'
      }, 0)
      ctx.bind(1, () => ctx.loading(0))
      ctx.bind(2, () => ctx.hasValue(0))
    },
  })
  const instance = createInstance(def)
  def.lifetimes.attached.call(instance)
  await tick()

  assert.equal(instance.calls.some((call) => call.b1 === true), true)
  assert.equal(instance.calls.some((call) => call.b2 === false), true)

  setPhase(1)
  await tick()
  assert.equal(instance.calls.some((call) => call.b0 === 'value'), true)
  assert.equal(instance.calls.some((call) => call.b1 === false), true)
  assert.equal(instance.calls.some((call) => call.b2 === true), true)
  assert.deepEqual(
    { b0: instance.calls.at(-1).b0, b1: instance.calls.at(-1).b1, b2: instance.calls.at(-1).b2 },
    { b0: 'value', b1: false, b2: true },
  )

  setPhase(2)
  await tick()
  assert.equal(instance.calls.some((call) => call.b1 === true), true)
  assert.equal(instance.calls.some((call) => call.b2 === true), true)
  assert.equal(
    instance.calls.every((call) => call.b0 === undefined || call.b0 === 'value'),
    true,
  )
})

test('marks a Loading boundary settled only after every binding has a value', async () => {
  let setReady
  const def = defineGlazeComponent({
    asyncStatus: [
      { index: 2, kind: 'loading', boundary: 0 },
      { index: 3, kind: 'settled', boundary: 0 },
    ],
    data: { b0: null, b1: null, b2: null, b3: null },
    setup(ctx) {
      const [ready, set] = createSignal(false)
      setReady = set
      ctx.bind(0, () => 'first', 0)
      ctx.bind(1, () => {
        if (!ready()) throw new NotReadyError()
        return 'second'
      }, 0)
      ctx.bind(2, () => ctx.loading(0))
      ctx.bind(3, () => ctx.hasValue(0))
    },
  })
  const instance = createInstance(def)
  def.lifetimes.attached.call(instance)
  await tick()
  assert.equal(instance.calls.some((call) => call.b3 === false), true)

  setReady(true)
  await tick()
  assert.equal(instance.calls.some((call) => call.b3 === true), true)
  assert.equal(instance.calls.some((call) => call.b1 === 'second'), true)
})

test('two async row instances keep independent boundary state', async () => {
  const rows = []
  const def = defineGlazeComponent({
    asyncStatus: [
      { index: 1, kind: 'loading', boundary: 0 },
      { index: 3, kind: 'error', boundary: 0 },
    ],
    data: { b0: null, b1: null, b2: null, b3: null, b4: null },
    setup(ctx) {
      const [phase, setPhase] = createSignal(0)
      const [fail, setFail] = createSignal(false)
      rows.push({ setPhase, setFail })
      ctx.bind(0, () => {
        if (phase() === 0) throw new NotReadyError()
        return 'row-a'
      }, 0)
      ctx.bind(1, () => ctx.loading(0))
      ctx.bind(2, () => {
        if (fail()) throw new Error('row-b')
        return 'row-a'
      }, 0)
      ctx.bind(3, () => ctx.errored(0))
      ctx.bind(4, () => (ctx.error(0) as Error)?.message)
    },
  })
  const first = createInstance(def)
  def.lifetimes.attached.call(first)
  const second = createInstance(def)
  def.lifetimes.attached.call(second)
  await tick()

  assert.equal(first.calls.some((call) => call.b1 === true), true)
  assert.equal(second.calls.some((call) => call.b1 === true), true)
  rows[0].setPhase(1)
  await tick()
  assert.equal(first.calls.some((call) => call.b1 === false), true)
  assert.equal(second.calls.some((call) => call.b1 === true), true)

  rows[1].setFail(true)
  await tick()
  assert.equal(second.calls.some((call) => call.b3 === true), true)
  assert.equal(second.calls.some((call) => call.b4 === 'row-b'), true)
  assert.equal(first.calls.some((call) => call.b3 === true), false)
})

test('tracks nested async boundaries separately', async () => {
  const def = defineGlazeComponent({
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

test('holds content writes while a Loading boundary shows its fallback', async () => {
  let setReady
  let setValue
  const def = defineGlazeComponent({
    asyncStatus: [{ index: 2, kind: 'loading', boundary: 0 }],
    boundaries: [
      { id: 0, kind: 'loading', parent: null, region: 'content', content: [0, 1], children: [], keepPrevious: true },
    ],
    data: { b0: null, b1: null, b2: null },
    setup(ctx) {
      const [ready, setR] = createSignal(false)
      const [value, setV] = createSignal(0)
      setReady = setR
      setValue = setV
      ctx.bind(0, () => value(), 0)
      ctx.bind(1, () => {
        if (!ready()) throw new NotReadyError()
        return 'ok'
      }, 0)
      ctx.bind(2, () => ctx.loading(0))
    },
  })
  const instance = createInstance(def)
  def.lifetimes.attached.call(instance)
  await tick()

  assert.equal(instance.__glaze?.boundaryTree.get(0)?.fallback(), true)
  setValue(1)
  await tick()
  assert.notEqual(instance.calls.at(-1)?.b0, 1)

  setReady(true)
  await tick()
  assert.equal(instance.calls.at(-1)?.b0, 1)
})

test('builds a real loading boundary from the descriptor tree', async () => {
  let setReady
  const def = defineGlazeComponent({
    asyncStatus: [
      { index: 1, kind: 'loading', boundary: 0 },
      { index: 2, kind: 'settled', boundary: 0 },
    ],
    boundaries: [
      { id: 0, kind: 'loading', parent: null, region: 'content', content: [0], children: [], keepPrevious: true },
    ],
    data: { b0: null, b1: null, b2: null },
    setup(ctx) {
      const [ready, set] = createSignal(false)
      setReady = set
      ctx.bind(0, () => {
        if (!ready()) throw new NotReadyError()
        return 'real-value'
      }, 0)
      ctx.bind(1, () => ctx.loading(0))
      ctx.bind(2, () => ctx.hasValue(0))
    },
  })
  const instance = createInstance(def)
  def.lifetimes.attached.call(instance)
  await tick()
  assert.equal(instance.calls.at(-1).b1, true)
  assert.equal(instance.calls.at(-1).b2, false)

  setReady(true)
  await tick()
  assert.equal(instance.calls.at(-1).b0, 'real-value')
  assert.equal(instance.calls.at(-1).b1, false)
  assert.equal(instance.calls.at(-1).b2, true)
})

test('a nested real loading boundary does not show the outer fallback', async () => {
  let setReady
  const def = defineGlazeComponent({
    asyncStatus: [
      { index: 1, kind: 'loading', boundary: 0 },
      { index: 2, kind: 'loading', boundary: 1 },
    ],
    boundaries: [
      { id: 0, kind: 'loading', parent: null, region: 'content', content: [], children: [1], keepPrevious: true },
      { id: 1, kind: 'loading', parent: 0, region: 'content', content: [0], children: [], keepPrevious: true },
    ],
    data: { b0: null, b1: null, b2: null },
    setup(ctx) {
      const [ready, set] = createSignal(false)
      setReady = set
      ctx.bind(0, () => {
        if (!ready()) throw new NotReadyError()
        return 'nested-value'
      }, 1)
      ctx.bind(1, () => ctx.loading(0))
      ctx.bind(2, () => ctx.loading(1))
    },
  })
  const instance = createInstance(def)
  def.lifetimes.attached.call(instance)
  await tick()
  assert.equal(instance.calls.at(-1).b1, false)
  assert.equal(instance.calls.at(-1).b2, true)

  setReady(true)
  await tick()
  assert.equal(instance.calls.at(-1).b2, false)
  assert.equal(instance.calls.at(-1).b0, 'nested-value')
})

test('a real error boundary catches content errors and resets', async () => {
  let setFail
  let page
  const def = defineGlazeComponent({
    asyncStatus: [{ index: 1, kind: 'error', boundary: 0 }],
    boundaries: [
      { id: 0, kind: 'error', parent: null, region: 'content', content: [0], children: [] },
    ],
    data: { b0: null, b1: null, b2: null },
    setup(ctx) {
      page = ctx
      const [fail, set] = createSignal(true)
      setFail = set
      ctx.bind(0, () => {
        if (fail()) throw new Error('real-boom')
        return 'recovered'
      }, null, 0)
      ctx.bind(1, () => ctx.errored(0))
      ctx.bind(2, () => (ctx.error(0) as Error | undefined)?.message)
    },
  })
  const instance = createInstance(def)
  def.lifetimes.attached.call(instance)
  await tick()
  const last = (key) =>
    [...instance.calls].reverse().find((call) => Object.hasOwn(call, key))?.[key]
  assert.equal(instance.calls.some((call) => call.b1 === true), true)
  assert.equal(last('b2'), 'real-boom')

  setFail(false)
  await tick()
  assert.equal(instance.calls.some((call) => call.b1 === true), true)

  page.reset(0)
  await tick()
  await tick()
  assert.equal(last('b0'), 'recovered')
  assert.equal(last('b1'), false)
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

test('ctx.commit resolves after the pending batch reaches setData', async () => {
  let setValue
  let commit
  const def = defineGlazeComponent({
    data: { b0: null },
    setup(ctx) {
      const [value, set] = createSignal('old')
      setValue = set
      commit = () => ctx.commit()
      ctx.bind(0, () => value())
    },
  })
  const instance = createInstance(def)
  def.lifetimes.attached.call(instance)
  await tick()
  const before = instance.calls.length

  setValue('new')
  await commit()

  assert.equal(instance.calls.length, before + 1)
  assert.equal(instance.calls.at(-1).b0, 'new')
})

test('useCommit exposes ctx.commit to a component body', async () => {
  let setValue
  let commit
  const def = defineGlazeComponent({
    data: { b0: null },
    setup(ctx) {
      const [value, set] = createSignal('a')
      setValue = set
      commit = useCommit()
      ctx.bind(0, () => value())
    },
  })
  const instance = createInstance(def)
  def.lifetimes.attached.call(instance)
  await tick()
  const before = instance.calls.length

  setValue('b')
  await commit()
  assert.equal(instance.calls.length, before + 1)
  assert.equal(instance.calls.at(-1).b0, 'b')
})

test('ctx.commit coalesces several writes into one batch', async () => {
  let setA
  let setB
  let commit
  const def = defineGlazeComponent({
    data: { b0: null, b1: null },
    setup(ctx) {
      const [a, set] = createSignal(0)
      const [b, setOther] = createSignal(0)
      setA = set
      setB = setOther
      commit = () => ctx.commit()
      ctx.bind(0, () => a())
      ctx.bind(1, () => b())
    },
  })
  const instance = createInstance(def)
  def.lifetimes.attached.call(instance)
  await tick()
  const before = instance.calls.length

  setA(1)
  setB(2)
  await commit()

  assert.equal(instance.calls.length, before + 1)
  assert.equal(instance.calls.at(-1).b0, 1)
  assert.equal(instance.calls.at(-1).b1, 2)
})

test('ctx.commit resolves immediately when nothing is pending', async () => {
  let commit
  const def = defineGlazeComponent({
    data: { b0: null },
    setup(ctx) {
      commit = () => ctx.commit()
      ctx.bind(0, () => 1)
    },
  })
  const instance = createInstance(def)
  def.lifetimes.attached.call(instance)
  await tick()
  const before = instance.calls.length

  await commit()
  assert.equal(instance.calls.length, before)
})

test('ctx.commit rejects when the transport commit fails', async () => {
  let setValue
  let commit
  const def = defineGlazeComponent({
    data: { b0: null },
    setup(ctx) {
      const [value, set] = createSignal('a')
      setValue = set
      commit = () => ctx.commit()
      ctx.bind(0, () => value())
    },
  })
  const instance = createInstance(def)
  def.lifetimes.attached.call(instance)
  await tick()

  instance.setData = () => {
    throw new Error('transport boom')
  }
  setValue('b')
  await assert.rejects(commit(), /transport boom/)
})

test('ctx.commit rejects when the component detaches before the batch commits', async () => {
  let setValue
  let commit
  const def = defineGlazeComponent({
    data: { b0: null },
    setup(ctx) {
      const [value, set] = createSignal('a')
      setValue = set
      commit = () => ctx.commit()
      ctx.bind(0, () => value())
    },
  })
  const instance = createInstance(def)
  def.lifetimes.attached.call(instance)
  await tick()

  setValue('b')
  const pending = commit()
  def.lifetimes.detached.call(instance)
  await assert.rejects(pending, /detached before commit/)
})

test('ctx.commit rejects outside an attached component', async () => {
  let commit
  const def = defineGlazeComponent({
    data: {},
    setup(ctx) {
      commit = () => ctx.commit()
    },
  })
  const instance = createInstance(def)
  await assert.rejects(commit(), /requires an attached component/)
  def.lifetimes.attached.call(instance)
  await tick()
  await commit()
})

test('shares a memo between bindings and ignores unrelated signals', async () => {
  let setA
  let setB
  let memoRuns = 0
  const effectValues = []
  const def = defineGlazeComponent({
    data: { b0: null, b1: null, b2: null },
    setup(ctx) {
      const [a, set] = createSignal(0)
      const [b, setOther] = createSignal(0)
      setA = set
      setB = setOther
      const doubled = createMemo(() => {
        memoRuns += 1
        return a() * 2
      })
      ctx.bind(0, () => doubled())
      ctx.bind(1, () => doubled())
      ctx.bind(2, () => b())
      createEffect(
        () => doubled(),
        {
          effect(value) {
            effectValues.push(value)
          },
        },
      )
    },
  })
  const instance = createInstance(def)
  def.lifetimes.attached.call(instance)
  await tick()
  assert.equal(memoRuns, 1)
  assert.deepEqual(effectValues, [0])

  const calls = instance.calls.length
  setA(1)
  await tick()
  assert.equal(memoRuns, 2)
  assert.deepEqual(effectValues, [0, 2])
  assert.equal(instance.calls.length, calls + 1)
  assert.equal(instance.calls.at(-1).b0, 2)
  assert.equal(instance.calls.at(-1).b1, 2)
  // The unchanged b2 is not part of this batch; its previous value stays in
  // the platform data.
  assert.equal(Object.assign({}, ...instance.calls).b2, 0)

  setB(1)
  await tick()
  // The memo depends only on `a`, so a write to `b` must not recompute it.
  assert.equal(memoRuns, 2)
  assert.deepEqual(effectValues, [0, 2])
  assert.equal(instance.calls.at(-1).b2, 1)
})

test('disposes user effects on detach and skips them while detached', async () => {
  let setA
  let runs = 0
  let cleanups = 0
  const def = defineGlazeComponent({
    data: { b0: null },
    setup(ctx) {
      const [a, set] = createSignal(0)
      setA = set
      ctx.bind(0, () => a())
      createEffect(
        () => {
          runs += 1
          a()
          onCleanup(() => {
            cleanups += 1
          })
        },
        { effect() {} },
      )
    },
  })
  const instance = createInstance(def)
  def.lifetimes.attached.call(instance)
  await tick()
  assert.equal(runs, 1)

  def.lifetimes.detached.call(instance)
  await tick()
  assert.equal(cleanups, 1)

  setA(1)
  await tick()
  assert.equal(runs, 1, 'a detached effect must not run')

  def.lifetimes.attached.call(instance)
  await tick()
  assert.equal(runs, 2, 'a re-attached root installs the effect again')
})

test('multiple writes in one tick produce one transport batch with final values', async () => {
  let setA
  let setB
  const seen = []
  const def = defineGlazeComponent({
    data: { b0: null, b1: null },
    setup(ctx) {
      const [a, set] = createSignal(0)
      const [b, setOther] = createSignal(0)
      setA = set
      setB = setOther
      ctx.bind(0, () => a())
      ctx.bind(1, () => b())
      createEffect(
        () => {
          seen.push(a())
        },
        { effect() {} },
      )
    },
  })
  const instance = createInstance(def)
  def.lifetimes.attached.call(instance)
  await tick()
  const calls = instance.calls.length

  setA(1)
  setA(2)
  setB(3)
  await tick()

  assert.equal(instance.calls.length, calls + 1)
  assert.equal(instance.calls.at(-1).b0, 2)
  assert.equal(instance.calls.at(-1).b1, 3)
  // The effect sees the final value once, not every intermediate write.
  assert.deepEqual(seen, [0, 2])

  // Writing the same values again is a no-op at the binding layer.
  const settledCalls = instance.calls.length
  setA(2)
  setB(3)
  await tick()
  assert.equal(instance.calls.length, settledCalls)
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
  assert.deepEqual(instance.__glaze.lifecycle, {
    phase: 'waiting-context',
    attachedBeforeMount: false,
  })
  def.lifetimes.attached.call(instance)
  assert.deepEqual(instance.__glaze.lifecycle, {
    phase: 'waiting-context',
    attachedBeforeMount: true,
  })
  def.lifetimes.ready.call(instance)
  assert.equal(instance.__glaze.lifecycle.phase, 'attached')
  await tick()

  def.lifetimes.detached.call(instance)
  assert.equal(instance.__glaze.lifecycle.phase, 'detached')
  def.lifetimes.attached.call(instance)
  assert.equal(instance.__glaze.lifecycle.phase, 'attached')
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

test('logs a failing binding that has no async boundary', () => {
  const log = captureConsoleError()
  try {
    const def = defineGlazeComponent({
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

test('duplicate or missing list keys fall back to the whole list', () => {
  const duplicate = [
    { id: 1, title: 'a' },
    { id: 1, title: 'b' },
  ]
  const duplicateNext = [
    { id: 1, title: 'a' },
    { id: 1, title: 'c' },
  ]
  assert.equal(listOps(duplicate, duplicateNext, 'id'), null)
  assert.equal(listPatch(duplicate, duplicateNext, 'id', 'b0'), null)
  assert.equal(diffList(duplicate, duplicateNext, 'id', 'b0', true), null)

  const missing = [{ title: 'a' }, { title: 'b' }]
  assert.equal(listOps(missing, [{ title: 'a' }, { title: 'c' }], 'id'), null)
  assert.equal(listPatch(missing, [{ title: 'a' }, { title: 'c' }], 'id', 'b0'), null)
  assert.equal(listPatch([{ title: 'a' }], [{ title: 'b' }], 'id', 'b0'), null)
})

test('a changed key becomes a remove and insert, not a field patch', () => {
  const before = [{ id: 1, title: 'one' }]
  const next = [{ id: 2, title: 'one' }]
  assert.deepEqual(diffList(before, next, 'id', 'b0', true), [
    { path: ['b0'], splice: { index: 0, del: 1, inserts: next } },
  ])
  assert.equal(diffList(before, next, 'id', 'b0', false), null)
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

test('detects a nested field mutated in place on a row object', async () => {
  const row = { id: 1, meta: { tag: 'a', flags: [1] } }
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

  row.meta.tag = 'b'
  setItems([...initial])
  await tick()
  assert.deepEqual(instance.pathCalls, [[['b0', 0, 'meta', 'tag'], 'b']])
})


test('a primitive context value updates a binding through ctx.context', async () => {
  const Theme = createContext('light')
  let setTheme
  const def = defineGlazeComponent({
    data: { b0: null },
    setup(ctx) {
      const [theme, set] = createSignal('light')
      setTheme = set
      withProvider(
        Theme,
        'light',
        () => {
          const read = ctx.context(Theme)
          ctx.bind(0, () => read())
        },
        () => theme(),
      )
    },
  })
  const instance = createInstance(def)
  def.lifetimes.attached.call(instance)
  await tick()
  assert.equal(instance.calls.at(-1).b0, 'light')
  setTheme('dark')
  await tick()
  assert.equal(instance.calls.at(-1).b0, 'dark')
})

test('an object context value exposes current fields through ctx.context', async () => {
  const Palette = createContext({ color: 'light' })
  let setColor
  const def = defineGlazeComponent({
    data: { b0: null },
    setup(ctx) {
      const [color, set] = createSignal('light')
      setColor = set
      withProvider(
        Palette,
        { color: 'light' },
        () => {
          const read = ctx.context(Palette)
          ctx.bind(0, () => read().color)
        },
        () => ({ color: color() }),
      )
    },
  })
  const instance = createInstance(def)
  def.lifetimes.attached.call(instance)
  await tick()
  assert.equal(instance.calls.at(-1).b0, 'light')
  setColor('dark')
  await tick()
  assert.equal(instance.calls.at(-1).b0, 'dark')
})


test('a binding uses the nearest Loading and the nearest Errored boundary separately', async () => {
  let setPhase
  const def = defineGlazeComponent({
    data: { b0: null, b1: null, b2: null },
    asyncStatus: [
      { index: 0, kind: 'loading', boundary: 0 },
      { index: 1, kind: 'error', boundary: 1 },
    ],
    setup(ctx) {
      const [phase, set] = createSignal(0)
      setPhase = set
      ctx.bind(0, () => ctx.loading(0))
      ctx.bind(1, () => ctx.errored(1))
      ctx.bind(2, () => {
        if (phase() === 0) throw new NotReadyError()
        throw new Error('boom')
      }, 0, 1)
    },
  })
  const instance = createInstance(def)
  def.lifetimes.attached.call(instance)
  await tick()
  assert.equal(instance.calls.at(-1).b0, true)
  assert.notEqual(instance.calls.at(-1).b1, true)

  setPhase(1)
  await tick()
  assert.equal(instance.calls.at(-1).b0, false)
  assert.equal(instance.calls.at(-1).b1, true)
})


test('detects a nested array mutated in place on a row object', async () => {
  const row = { id: 1, tags: ['a'] }
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

  row.tags.push('b')
  setItems([...initial])
  await tick()
  assert.deepEqual(instance.pathCalls, [[['b0', 0, 'tags'], ['a', 'b']]])
})


test('clears Loading when a binding fails without an Errored boundary', async () => {
  let setPhase
  const def = defineGlazeComponent({
    asyncStatus: [{ index: 1, kind: 'loading', boundary: 0 }],
    data: { b0: null, b1: null },
    setup(ctx) {
      const [phase, set] = createSignal(0)
      setPhase = set
      ctx.bind(0, () => {
        if (phase() === 0) throw new NotReadyError()
        throw new Error('no error boundary')
      }, 0, null)
      ctx.bind(1, () => ctx.loading(0))
    },
  })
  const instance = createInstance(def)
  def.lifetimes.attached.call(instance)
  await tick()
  assert.equal(instance.calls.at(-1).b1, true)

  setPhase(1)
  await tick()
  await tick()
  assert.equal(instance.calls.at(-1).b1, false)
})
test('page context shares options and events across component boundaries', async () => {
  let root
  let child
  const seen = []
  const routes = []
  const rootDef = defineGlazeComponent({
    data: {},
    properties: ['glazepage'],
    pageContext: true,
    pageRoot: true,
    setup(ctx) {
      root = ctx
    },
  })
  const childDef = defineGlazeComponent({
    data: {},
    properties: ['glazepage'],
    pageContext: true,
    setup(ctx) {
      child = ctx
      ctx.onPageEvent('scroll', (payload) => seen.push(payload))
      ctx.onPageEvent('routeDone', (payload) => routes.push(payload))
    },
  })
  const page = { id: 'page-1', query: { from: 'scan' } }
  const rootInstance = createInstance(rootDef, { glazepage: page })
  const childInstance = createInstance(childDef, { glazepage: page })

  assert.deepEqual(root.pageOptions(), page)
  assert.deepEqual(child.pageOptions(), page)
  rootDef.methods.__glazePageEvent.call(rootInstance, 'scroll', { scrollTop: 5 })
  assert.deepEqual(seen, [{ scrollTop: 5 }])
  assert.deepEqual(child.pageEvent('scroll'), { scrollTop: 5 })

  // routeDone reaches every component through pageLifetimes; the root owns the
  // channel write, so the handler fires once, not once per component.
  rootDef.pageLifetimes.routeDone.call(rootInstance, { path: '/home' })
  childDef.pageLifetimes.routeDone.call(childInstance, { path: '/home' })
  assert.deepEqual(routes, [{ path: '/home' }])
  assert.deepEqual(child.pageEvent('routeDone'), { path: '/home' })

  childDef.lifetimes.detached.call(childInstance)
  rootDef.pageLifetimes.routeDone.call(rootInstance, { path: '/next' })
  assert.equal(routes.length, 1)
})