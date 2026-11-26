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

test('compiles a Reveal without Loading slots as its children', () => {
  const result = compileComponent(`
    import { Reveal } from 'solid-js'
    export default function Page() {
      return <Reveal><text>a</text></Reveal>
    }
  `)
  assert.match(result.js, /ctx\.revealGroup\(\(\) => "sequential", \(\) => false, \[\]\)/)
  assert.match(result.wxml, /<text>a<\/text>/)
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

test('compiles Reveal into one runtime group and gated Loading conditions', () => {
  const result = compileComponent(`
    import { Reveal, Loading } from 'solid-js'
    export default function Page(props) {
      return (
        <Reveal collapsed>
          <Loading fallback={<text>A</text>}><text>{props.a}</text></Loading>
          <Loading fallback={<text>B</text>}><text>{props.b}</text></Loading>
        </Reveal>
      )
    }
  `)
  assert.match(result.js, /ctx\.revealGroup\(\(\) => "sequential", \(\) => true, \[0, 1\]\)/)
  assert.match(result.js, /ctx\.revealGated\(0\)/)
  assert.match(result.js, /ctx\.revealHidden\(1\)/)
  assert.match(result.wxml, /\!b3 && \(b2 \|\| \(b0 && !b1\)\)/)
  assert.match(result.wxml, /\!b3 && !b2 && \(!b0 \|\| b1\)/)
})

test('compiles static and reactive Reveal order and collapsed', () => {
  const result = compileComponent(`
    import { Reveal, Loading } from 'solid-js'
    export default function Page() {
      return (
        <Reveal order="together">
          <Loading fallback={<text>A</text>}><text>A</text></Loading>
        </Reveal>
      )
    }
  `)
  assert.match(result.js, /ctx\.revealGroup\(\(\) => "together", \(\) => false, \[0\]\)/)

  const dynamic = compileComponent(`
    import { Reveal } from 'solid-js'
    export default function Page(props) {
      return <Reveal order={props.order} collapsed={props.collapsed}><text>A</text></Reveal>
    }
  `)
  assert.match(dynamic.js, /ctx\.revealGroup\(\(\) => props\.order, \(\) => props\.collapsed, \[\]\)/)
  assert.throws(
    () =>
      compileComponent(`
        import { Reveal } from 'solid-js'
        export default function Page() {
          return <Reveal order="sideways"><text>A</text></Reveal>
        }
      `),
    /<Reveal> order must be one of: sequential, together, natural/,
  )
})

test('rejects nested Reveal and Reveal inside a loop', () => {
  assert.throws(
    () =>
      compileComponent(`
        import { Reveal } from 'solid-js'
        export default function Page() {
          return <Reveal><Reveal><text>A</text></Reveal></Reveal>
        }
      `),
    /<Reveal> cannot be nested inside another <Reveal>/,
  )
  assert.throws(
    () =>
      compileComponent(`
        import { For, Reveal } from 'solid-js'
        export default function Page(props) {
          return <For each={props.items}>{() => <Reveal><text>A</text></Reveal>}</For>
        }
      `),
    /<Reveal> inside a loop is not supported/,
  )
})

test('Reveal does not treat a Loading in a fallback as a slot', () => {
  const result = compileComponent(`
    import { Loading, Reveal } from 'solid-js'
    export default function Page(props) {
      return (
        <Reveal>
          <Loading fallback={<Loading fallback={<text>inner</text>}><text>{props.a}</text></Loading>}>
            <text>{props.b}</text>
          </Loading>
        </Reveal>
      )
    }
  `)
  assert.match(result.js, /ctx\.revealGroup\(\(\) => "sequential", \(\) => false, \[0\]\)/)
  assert.match(result.js, /ctx\.revealGated\(0\)/)
})

test('rejects a Loading inside a loop under Reveal', () => {
  assert.throws(
    () =>
      compileComponent(`
        import { For, Loading, Reveal } from 'solid-js'
        export default function Page(props) {
          return (
            <Reveal>
              <For each={props.items}>
                {(item) => <Loading fallback={<text>x</text>}><text>{item}</text></Loading>}
              </For>
            </Reveal>
          )
        }
      `),
    /<Loading> inside a loop is not supported/,
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
