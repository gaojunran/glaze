import assert from 'node:assert/strict'
import test from 'node:test'
import * as glassEasel from 'glass-easel'
import { compileComponent } from '../../compiler/src/index.ts'
import { mount, register, textContentOf, tick } from './harness.ts'

// JS values are rendered the same way a Solid text expression would be:
// `null` and `undefined` disappear, everything else is stringified.
const display = (value: unknown) => (value === undefined || value === null ? '' : String(value))

async function renderProjected(expression: string, data: Record<string, unknown>) {
  const result = compileComponent(
    `export default function Page(props) {
      return <text id="value">{${expression}}</text>
    }`,
    { sourceFile: '/project/src/Page.tsx' },
  )
  // Every case here is a props-only expression: it must be projected into WXML
  // rather than compiled into a Solid binding.
  assert.equal(result.bindingCount, 0)
  const root = new glassEasel.ComponentSpace()
  const def = register(root, { wxml: result.wxml, config: { data } })
  const comp = mount(root, def)
  await tick()
  return textContentOf(comp.getShadowRoot().querySelector('#value'))
}

const scalars: Array<[string, Record<string, unknown>, unknown]> = [
  ['props.value', { value: undefined }, undefined],
  ['props.value', { value: null }, null],
  ['props.value', { value: 0 }, 0],
  ['props.value', { value: false }, false],
  ['props.count + 1', { count: 0 }, 1],
  ['props.count + 1', {}, Number.NaN],
  ['props.title + props.suffix', { title: 'a', suffix: 1 }, 'a1'],
  ['props.title + props.suffix', { suffix: 1 }, Number.NaN],
]

for (const [expression, data, expected] of scalars) {
  test(`WXML projection matches JS for ${expression} with ${JSON.stringify(data)}`, async () => {
    assert.equal(await renderProjected(expression, data), display(expected))
  })
}

async function renderStructured(data: Record<string, unknown>) {
  const result = compileComponent(
    `export default function Page(props) {
      return <view>
        <text id="value">{props.title}</text>
        <text>{props.done}</text>
      </view>
    }`,
    { sourceFile: '/project/src/Page.tsx', structuredProps: true },
  )
  assert.equal(result.bindingCount, 0)
  assert.equal(result.structuredProps, true)
  const root = new glassEasel.ComponentSpace()
  const def = register(root, { wxml: result.wxml, config: { data } })
  const comp = mount(root, def)
  await tick()
  return textContentOf(comp.getShadowRoot().querySelector('#value'))
}

const structured: Array<[Record<string, unknown>, unknown]> = [
  [{ glazeprops: null, title: 'scalar' }, 'scalar'],
  [{ glazeprops: {}, title: 'scalar' }, 'scalar'],
  [{ glazeprops: { title: null }, title: 'scalar' }, null],
  [{ glazeprops: { title: 'object' }, title: 'scalar' }, 'object'],
]

for (const [data, expected] of structured) {
  test(`structured prop fallback matches JS for ${JSON.stringify(data)}`, async () => {
    assert.equal(await renderStructured(data), display(expected))
  })
}
