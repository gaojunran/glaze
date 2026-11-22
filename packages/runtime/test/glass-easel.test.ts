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

const tick = () => new Promise((resolve) => setTimeout(resolve, 5))

function mount(config) {
  const def = defineGlazeComponent(config)
  const element = glassEasel.Component.createWithContext(
    'root',
    def,
    new glassEasel.EmptyBackendContext(),
  ).general()
  glassEasel.Component.pretendAttached(element)
  return element
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
