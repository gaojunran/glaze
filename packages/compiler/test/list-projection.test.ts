import assert from 'node:assert/strict'
import test from 'node:test'
import { compileComponent } from '../src/index.ts'

const fieldsOf = (result: { listFields: Record<string, string[]> }) =>
  Object.values(result.listFields)[0]

test('records the top-level fields WXML reads from a keyed row', () => {
  const result = compileComponent(`
    export default function Page() {
      const rows = [{ id: 1, title: 'a', done: true, extra: 'x' }]
      return (
        <For each={rows} keyed={(row) => row.id}>
          {(row) => (
            <view class={{ active: row().done }}>
              <text>{row().title}</text>
              <text>{row().done ? 'yes' : 'no'}</text>
            </view>
          )}
        </For>
      )
    }
  `)
  assert.deepEqual(fieldsOf(result), ['id', 'done', 'title'])
  assert.ok(result.js.includes('listFields:'))
})

test('records a nested field path instead of its first segment', () => {
  const result = compileComponent(`
    export default function Page() {
      const rows = [{ id: 1, user: { name: 'a', extra: 'x' } }]
      return (
        <For each={rows} keyed={(row) => row.id}>
          {(row) => <text>{row().user.name}</text>}
        </For>
      )
    }
  `)
  assert.deepEqual(fieldsOf(result), ['id', 'user.name'])
})

test('records several nested paths and keeps a whole-field read', () => {
  const result = compileComponent(`
    export default function Page() {
      const rows = [{ id: 1, user: { name: 'a', age: 1, extra: 'x' } }]
      return (
        <For each={rows} keyed={(row) => row.id}>
          {(row) => (
            <view title={row().user}>
              <text>{row().user.name}</text>
              <text>{row().user.age}</text>
            </view>
          )}
        </For>
      )
    }
  `)
  assert.deepEqual(fieldsOf(result), ['id', 'user', 'user.name', 'user.age'])
})

test('records a field read by a Show condition inside the loop', () => {
  const result = compileComponent(`
    import { Show } from 'solid-js'
    export default function Page() {
      const rows = [{ id: 1, title: 'a', done: true }]
      return (
        <For each={rows} keyed={(row) => row.id}>
          {(row) => <Show when={row().done}><text>{row().title}</text></Show>}
        </For>
      )
    }
  `)
  assert.deepEqual(fieldsOf(result).sort(), ['done', 'id', 'title'])
})

test('falls back when the whole row is passed to an expression', () => {
  const result = compileComponent(`
    export default function Page() {
      const rows = [{ id: 1, title: 'a' }]
      return (
        <For each={rows} keyed={(row) => row.id}>
          {(row) => <view title={row()}>{row().title}</view>}
        </For>
      )
    }
  `)
  assert.deepEqual(result.listFields, {})
  assert.doesNotMatch(result.js, /listFields:/)
})

test('falls back when a row field is accessed dynamically', () => {
  const result = compileComponent(`
    export default function Page(props) {
      const rows = [{ id: 1, title: 'a' }]
      return (
        <For each={rows} keyed={(row) => row.id}>
          {(row) => <text>{row()[props.field]}</text>}
        </For>
      )
    }
  `)
  assert.deepEqual(result.listFields, {})
})

test('does not project a *this keyed loop', () => {
  const result = compileComponent(`
    export default function Page() {
      const rows = [{ id: 1, title: 'a' }]
      return (
        <For each={rows} key="*this">
          {(row) => <text>{row.title}</text>}
        </For>
      )
    }
  `)
  assert.deepEqual(result.listFields, {})
  assert.match(result.wxml, /wx:key="\*this"/)
})

test('records an outer field used as a nested loop source', () => {
  const result = compileComponent(`
    export default function Page() {
      const rows = [{ id: 1, items: [{ name: 'a', extra: 'x' }] }]
      return (
        <For each={rows} keyed={(row) => row.id}>
          {(row) => (
            <For each={row().items} keyed={false}>
              {(item) => <text>{item().name}</text>}
            </For>
          )}
        </For>
      )
    }
  `)
  assert.deepEqual(Object.values(result.listFields), [['id', 'items']])
})

test('does not project an unkeyed loop or a prop-backed loop', () => {
  const unkeyed = compileComponent(`
    export default function Page() {
      const rows = [{ id: 1, title: 'a' }]
      return <For each={rows} keyed={false}>{(row) => <text>{row.title}</text>}</For>
    }
  `)
  assert.deepEqual(unkeyed.listFields, {})

  const propsLoop = compileComponent(`
    export default function Page(props) {
      return <For each={props.rows} key="id">{(row) => <text>{row.title}</text>}</For>
    }
  `)
  assert.deepEqual(propsLoop.listFields, {})
})
