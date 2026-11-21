import assert from 'node:assert/strict'
import test from 'node:test'
import { compileComponent } from '../src/index.mjs'

const source = `
import { createSignal, For, Show } from 'solid-js'

export default function Counter() {
  const [count, setCount] = createSignal(0)
  const items = [{ id: 1, title: 'a' }]
  return (
    <view class="page">
      <text>{count()}</text>
      <button onClick={() => setCount((value) => value + 1)}>+</button>
      <Show when={count() > 0}>
        <text>positive</text>
      </Show>
      <For each={items} key="id">
        {(item) => <text>{item.title}</text>}
      </For>
    </view>
  )
}
`

test('compiles bindings, events, Show and For to WXML', () => {
  const result = compileComponent(source)

  assert.match(result.wxml, /<text>\{\{b0\}\}<\/text>/)
  assert.match(result.wxml, /bindtap="e0"/)
  assert.match(result.wxml, /wx:if="\{\{b1\}\}"/)
  assert.match(result.wxml, /wx:for="\{\{b2\}\}"/)
  assert.match(result.wxml, /wx:key="id"/)
  assert.match(result.wxml, /\{\{item\.title\}\}/)
  assert.equal(result.bindingCount, 3)
  assert.equal(result.handlerCount, 1)
})

test('keeps module-level constants in the generated module', () => {
  const result = compileComponent(source)
  assert.match(result.js, /const items =/)
  assert.match(result.js, /ctx\.bind\(0, \(\) => \(count\(\)\)\)/)
  assert.match(result.js, /ctx\.event\(0, \(\) => setCount/)
})

test('rejects an unsupported nested component', () => {
  assert.throws(
    () =>
      compileComponent(`
        export default function Bad() {
          return <view><Counter /></view>
        }
      `),
    /Component <Counter> is not supported/,
  )
})
