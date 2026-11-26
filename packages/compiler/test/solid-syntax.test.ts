import assert from 'node:assert/strict'
import test from 'node:test'
import { compileComponent } from '../src/index.ts'

// Solid 2 syntax that has no WXML equivalent must fail loudly instead of
// compiling into an attribute or child the view layer silently ignores.

test('supports a ref callback array', () => {
  const result = compileComponent(`
    export default function Page(props) {
      const first = (node) => {}
      const second = (node) => {}
      return <view ref={[first, second]} />
    }
  `)
  assert.match(result.wxml, /id="glaze-r0"/)
  assert.match(result.js, /ctx\.ref\(0, \[first, second\]\)/)
})

test('rejects ref arrays with spreads', () => {
  assert.throws(
    () =>
      compileComponent(`
        export default function Page(props) {
          return <view ref={[...props.refs]} />
        }
      `),
    /ref arrays must contain callbacks without spreads/,
  )
})

test('rejects classList from Solid 1', () => {
  assert.throws(
    () =>
      compileComponent(`
        export default function Page() {
          return <view classList={{ active: true }} />
        }
      `),
    /classList is not supported/,
  )
})

test('rejects JSX namespaced attributes', () => {
  for (const source of [
    '<view on:click={() => {}} />',
    '<view oncapture:click={() => {}} />',
    '<view attr:title="a" />',
    '<view bool:disabled={true} />',
    '<view use:foo={bar} />',
  ]) {
    assert.throws(
      () =>
        compileComponent(`
          export default function Page() {
            return ${source}
          }
        `),
      /JSX namespaced attribute .* is not supported/,
    )
  }
})

test('rejects style arrays', () => {
  assert.throws(
    () =>
      compileComponent(`
        export default function Page() {
          return <view style={['color: red', { fontSize: '12px' }]} />
        }
      `),
    /style arrays are not supported/,
  )
})

test('rejects function children', () => {
  assert.throws(
    () =>
      compileComponent(`
        export default function Page(props) {
          return <view>{() => props.children}</view>
        }
      `),
    /Function children are not supported/,
  )
})

test('rejects Reveal with a reason', () => {
  assert.throws(
    () =>
      compileComponent(`
        import { Reveal } from 'solid-js'
        export default function Page() {
          return <Reveal><text>a</text></Reveal>
        }
      `),
    /<Reveal> is not supported/,
  )
})

test('rejects the children() helper', () => {
  assert.throws(
    () =>
      compileComponent(`
        import { children } from 'solid-js'
        export default function Card(props) {
          const resolved = children(() => props.children)
          return <view>{resolved()}</view>
        }
      `),
    /children\(\) helper is not supported/,
  )
})

test('inlines a local stateless component when inlining is enabled', () => {
  const result = compileComponent(
    `
      function Row(props) {
        return <text>{props.title}</text>
      }
      export default function Page() {
        return <Row title="a" />
      }
    `,
    { inline: true },
  )
  assert.doesNotMatch(result.wxml, /<row/)
  assert.match(result.wxml, /<text>\{\{b0\}\}<\/text>/)
  assert.match(result.js, /get title\(\)/)
})

test('inlines a local stateful component outside a loop', () => {
  const result = compileComponent(
    `
      import { createSignal } from 'solid-js'
      function Row(props) {
        const [count] = createSignal(0)
        return <text>{props.title}{count()}</text>
      }
      export default function Page() {
        return <Row title="a" />
      }
    `,
    { inline: true },
  )
  assert.doesNotMatch(result.wxml, /<row/)
  assert.match(result.js, /createSignal\(0\)/)
})

test('inlines a local pure component inside a loop', () => {
  const result = compileComponent(
    `
      function Row(props) {
        return <text>{props.title}</text>
      }
      export default function Page(props) {
        return <For each={props.items}>{item => <Row title={item.title} />}</For>
      }
    `,
    { inline: true },
  )
  assert.doesNotMatch(result.wxml, /<row/)
  assert.match(result.wxml, /wx:for=/)
})

test('keeps a local stateful component as a boundary inside a loop', () => {
  assert.throws(
    () =>
      compileComponent(
        `
          import { createSignal } from 'solid-js'
          function Row(props) {
            const [count] = createSignal(0)
            return <text>{count()}</text>
          }
          export default function Page(props) {
            return <For each={props.items}>{item => <Row />}</For>
          }
        `,
        { inline: true },
      ),
    /Local component <Row> is not supported/,
  )
})

test('rejects a local component that closes over module state', () => {
  assert.throws(
    () =>
      compileComponent(
        `
          const prefix = 'x'
          function Row(props) {
            return <text>{prefix}{props.title}</text>
          }
          export default function Page() {
            return <Row title="a" />
          }
        `,
        { inline: true },
      ),
    /Local component <Row> is not supported/,
  )
})

test('rejects local components with a reason', () => {
  assert.throws(
    () =>
      compileComponent(`
        function Row(props) {
          return <text>{props.title}</text>
        }
        export default function Page() {
          return <Row title="a" />
        }
      `),
    /Local component <Row> is not supported/,
  )
})

test('rejects Dynamic and Portal from web-only imports', () => {
  assert.throws(
    () =>
      compileComponent(`
        import { Dynamic } from '@solidjs/web'
        export default function Page(props) {
          return <Dynamic component={props.tag} />
        }
      `),
    /<Dynamic> is not supported/,
  )
  assert.throws(
    () =>
      compileComponent(`
        import { Portal } from '@solidjs/web'
        export default function Page() {
          return <Portal mount={null}><text>a</text></Portal>
        }
      `),
    /<Portal> is not supported/,
  )
})
