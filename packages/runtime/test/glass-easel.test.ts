import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import * as glassEasel from 'glass-easel'
import { createSignal } from 'solid-js'

// Glaze's mini-program entry calls the platform `Component()` factory at import
// time. Register it against a real glass-easel ComponentSpace so these tests
// exercise glass-easel's own lifecycle, property observer and DataGroup instead
// of the lightweight fake instance used by mini.test.ts.
const space = new glassEasel.ComponentSpace()
const originalComponent = globalThis.Component
globalThis.Component = (config) => space.defineComponent(config)
const { defineGlazeComponent } = await import('../src/mini.ts')
after(() => {
  if (originalComponent === undefined) delete globalThis.Component
  else globalThis.Component = originalComponent
})

// EmptyBackendContext schedules render callbacks after 16 ms. A Glaze update
// can need the Solid flush and that render callback, so 40 ms is too close to
// the frame boundary when the suite is under load.
const tick = () => new Promise((resolve) => setTimeout(resolve, 100))

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

function create(config, id = 'root') {
  const def = defineGlazeComponent(config)
  return glassEasel.Component.createWithContext(
    id,
    def,
    new glassEasel.EmptyBackendContext(),
  ).general()
}

function mount(config) {
  const element = create(config)
  glassEasel.Component.pretendAttached(element)
  return element
}

function deferredConfig(setup) {
  return {
    properties: ['glazecontext'],
    boundaryContexts: [{ name: 'Ctx', key: 'ctx' }],
    data: { b0: null },
    setup,
  }
}

test('real glass-easel lifecycle applies scalar bindings into DataGroup data', async () => {
  const element = mount({
    properties: ['count'],
    data: { b0: null },
    setup(ctx, props) {
      ctx.bind(0, () => props.count)
    },
  })
  element.setData({ count: 3 })
  await tick()
  assert.equal(element.data.b0, 3)
  assert.equal(element.data.count, 3)
})

test('real glass-easel DataGroup receives list field patches and splices', async () => {
  let setRows
  const element = mount({
    data: { b0: null },
    listBindings: { 0: 'id' },
    setup(ctx) {
      const [rows, set] = createSignal([
        { id: 1, title: 'one' },
        { id: 2, title: 'two' },
      ])
      setRows = set
      ctx.bind(0, () => rows())
    },
  })
  await tick()
  assert.deepEqual(element.data.b0, [
    { id: 1, title: 'one' },
    { id: 2, title: 'two' },
  ])
  setRows((rows) => rows.map((row) => (row.id === 2 ? { ...row, title: 'TWO' } : row)))
  await tick()
  assert.equal(element.data.b0[1].title, 'TWO')
  setRows((rows) => [{ id: 3, title: 'three' }, ...rows])
  await tick()
  assert.equal(element.data.b0[0].id, 3)
  assert.equal(element.data.b0.length, 3)
})

test('real glass-easel custom event props reach listeners with detail', async () => {
  let api
  const element = mount({
    properties: [],
    data: {},
    eventProps: { onPing: 'ping' },
    setup(_ctx, props) {
      api = props
    },
  })
  const seen = []
  element.addListener('ping', (event) => seen.push(event.detail))
  api.onPing(7)
  assert.deepEqual(seen, [7])
})

test('real glass-easel detach and reattach rebuilds a fresh component root', async () => {
  let setValue
  const element = mount({
    data: { b0: null },
    setup(ctx) {
      const [value, set] = createSignal('first')
      setValue = set
      ctx.bind(0, () => value())
    },
  })
  await tick()
  assert.equal(element.data.b0, 'first')
  glassEasel.Component.pretendDetached(element)
  setValue('detached')
  await tick()
  assert.equal(element.data.b0, 'first')
  glassEasel.Component.pretendAttached(element)
  await tick()
  // Glaze disposes the component's Solid root on detach; re-attach runs setup
  // again, so component-local state starts over rather than keeping the old
  // signal (the documented reattach semantics).
  assert.equal(element.data.b0, 'first')
})

test('real glass-easel property observer updates a prop signal', async () => {
  let seen
  const element = mount({
    properties: ['label'],
    data: { b0: null },
    setup(ctx, props) {
      ctx.bind(0, () => props.label)
      seen = () => props.label
    },
  })
  element.setData({ label: 'hello' })
  await tick()
  assert.equal(element.data.b0, 'hello')
  assert.equal(seen(), 'hello')
})

test('deferred component builds its root at ready, not at attached', async () => {
  let setups = 0
  const element = create(
    deferredConfig((ctx) => {
      setups += 1
      ctx.bind(0, () => 'ready')
    }),
  )

  glassEasel.Component.pretendAttached(element)
  await tick()
  assert.equal(setups, 0)
  assert.equal(element.data.b0, null)

  element.triggerLifetime('ready', [])
  await tick()
  assert.equal(setups, 1)
  assert.equal(element.data.b0, 'ready')
})

test('ready before attached installs one root and later attach applies updates', async () => {
  let setups = 0
  let setValue
  const element = create(
    deferredConfig((ctx) => {
      setups += 1
      const [value, set] = createSignal('first')
      setValue = set
      ctx.bind(0, () => value())
    }),
  )

  element.triggerLifetime('ready', [])
  await tick()
  assert.equal(setups, 1)
  assert.equal(element.data.b0, 'first')

  glassEasel.Component.pretendAttached(element)
  setValue('after-attach')
  await tick()
  assert.equal(setups, 1)
  assert.equal(element.data.b0, 'after-attach')
})

test('a detached deferred instance can attach and ready again', async () => {
  let setups = 0
  const element = create(
    deferredConfig((ctx) => {
      setups += 1
      ctx.bind(0, () => 'ready')
    }),
  )

  glassEasel.Component.pretendAttached(element)
  glassEasel.Component.pretendDetached(element)
  glassEasel.Component.pretendAttached(element)
  element.triggerLifetime('ready', [])
  await tick()

  assert.equal(setups, 1)
  assert.equal(element.data.b0, 'ready')
})

test('ready after detached does not revive a deferred root', async () => {
  let setups = 0
  const element = create(
    deferredConfig((ctx) => {
      setups += 1
      ctx.bind(0, () => 'ready')
    }),
  )

  glassEasel.Component.pretendAttached(element)
  glassEasel.Component.pretendDetached(element)
  element.triggerLifetime('ready', [])
  await tick()

  assert.equal(setups, 0)
  assert.equal(element.data.b0, null)
})

test('a moved component keeps its root and state', async () => {
  let setValue
  let setups = 0
  let moves = 0
  let hookMoves = 0
  const element = create({
    data: { b0: null },
    setup(ctx) {
      setups += 1
      const [value, set] = createSignal('first')
      setValue = set
      ctx.bind(0, () => value())
      ctx.onComponentMoved(() => {
        hookMoves += 1
      })
    },
  })
  element.addLifetimeListener('moved', () => {
    moves += 1
  })
  const parent = (name) => {
    const parentElement = glassEasel.Component.createWithContext(
      name,
      space.defineComponent({}),
      new glassEasel.EmptyBackendContext(),
    ).general()
    glassEasel.Component.pretendAttached(parentElement)
    return parentElement
  }
  const first = parent('first')
  const second = parent('second')

  first.appendChild(element)
  await tick()
  assert.equal(setups, 1)
  assert.equal(element.data.b0, 'first')

  second.appendChild(element)
  await tick()
  assert.equal(moves, 1, 'the platform moved lifetime fired')
  assert.equal(hookMoves, 1, 'the component moved hook fired')
  assert.equal(setups, 1, 'moving must not rebuild the root')

  setValue('moved')
  await tick()
  assert.equal(element.data.b0, 'moved')
})

test('real glass-easel page lifetimes reach the page signals', async () => {
  let page
  const element = mount({
    data: {},
    setup(ctx) {
      page = ctx
    },
  })

  element.triggerPageLifetime('hide', [])
  await tick()
  assert.equal(page.pageVisible(), false)
  element.triggerPageLifetime('show', [])
  await tick()
  assert.equal(page.pageVisible(), true)
  element.triggerPageLifetime('resize', [
    { size: { windowWidth: 320, windowHeight: 640 } },
  ])
  await tick()
  assert.deepEqual(page.pageSize(), { windowWidth: 320, windowHeight: 640 })

  element.triggerPageLifetime('routeDone', [{ path: '/pages/home/index' }])
  await tick()
  assert.deepEqual(page.pageEvent('routeDone'), { path: '/pages/home/index' })
})

test('real glass-easel beforeDetach runs before the root is disposed', async () => {
  let detaches = 0
  const element = mount({
    data: {},
    setup(ctx) {
      ctx.onBeforeDetach(() => {
        detaches += 1
      })
    },
  })

  element.triggerLifetime('beforeDetach', [])
  assert.equal(detaches, 1)
  glassEasel.Component.pretendDetached(element)
  await tick()
})

test('real glass-easel error lifetime reaches the error handler', () => {
  const capture = captureConsoleError()
  try {
    let page
    const seen = []
    const element = mount({
      data: {},
      setup(ctx) {
        page = ctx
        ctx.onComponentError((error) => seen.push(error))
      },
    })
    const error = new Error('boom')

    element.triggerLifetime('error', [error])

    assert.equal(element.__glaze.error, error)
    assert.deepEqual(seen, [error])
  } finally {
    capture.restore()
  }
})

test('real glass-easel keeps an error in one binding from freezing another', async () => {
  const element = mount({
    data: { b0: null, b1: null },
    setup(ctx) {
      ctx.bind(0, () => {
        throw new Error('boom')
      })
      ctx.bind(1, () => 'alive')
    },
  })
  await tick()
  assert.equal(element.data.b1, 'alive')
})
