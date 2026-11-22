import assert from 'node:assert/strict'
import test from 'node:test'
import { TmplGroup } from 'glass-easel-template-compiler'
import { compileComponent } from '../src/index.ts'

// String assertions can miss invalid WXML structure. Run every generated
// template through the platform's own template compiler instead: it is the same
// parser family glass-easel uses, without booting a browser.
const assertCompiles = (wxml: string) => {
  const group = new TmplGroup()
  try {
    const errors = group.addTmpl('', wxml)
    assert.deepEqual(
      errors,
      [],
      errors.map((error: { toString(): string }) => String(error)).join('\n'),
    )
    assert.ok(group.getTmplGenObjectGroups().length > 0)
  } finally {
    group.free()
  }
}

const cases: Array<[string, string]> = [
  [
    'conditional and quoted expression',
    `import { Show } from 'solid-js'
    export default function Page(props) {
      return <Show when={props.state === 'ready'}><view class="on">ready</view></Show>
    }`,
  ],
  [
    'nested control flow and loop WXS',
    `import { For, Show } from 'solid-js'
    export default function Page(props) {
      return (
        <For each={props.rows} keyed={(row) => row.id}>
          {(row) => (
            <Show when={row().title} fallback={<text>empty</text>}>
              <text>{row().title}</text>
            </Show>
          )}
        </For>
      )
    }`,
  ],
  [
    'class and style objects',
    `export default function Page(props) {
      return <view class={{ on: props.on, off: !props.on }} style={{ color: props.color }} />
    }`,
  ],
  [
    'slots and components',
    `import Card from './Card'
    export default function Page(props) {
      return <Card title={props.title}><text>{props.body}</text><slot name="footer" /></Card>
    }`,
  ],
  [
    'async boundaries',
    `import { Errored, Loading } from 'solid-js'
    export default function Page(props) {
      return (
        <Loading fallback={<text>loading</text>}>
          <Errored fallback={(error) => <text>{error.message}</text>}>
            <text>{props.value}</text>
          </Errored>
        </Loading>
      )
    }`,
  ],
  [
    'hyphenated host attributes',
    `export default function Page() {
      return <view hover-class="tapped" data-id="main" aria-label="main" />
    }`,
  ],
]

for (const [name, source] of cases) {
  test(`generated WXML compiles with glass-easel: ${name}`, () => {
    const result = compileComponent(source)
    assertCompiles(result.wxml)
  })
}

test('generated WXS helper is accepted by the glass-easel template compiler', () => {
  const result = compileComponent(`
    import { For, Repeat } from 'solid-js'
    export default function Page(props) {
      return (
        <For each={props.rows}>
          {(row) => <Repeat count={row.count} from={1}>{() => <text>x</text>}</Repeat>}
        </For>
      )
    }
  `)
  assertCompiles(result.wxml)
})
