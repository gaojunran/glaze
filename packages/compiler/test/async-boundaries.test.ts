import assert from 'node:assert/strict'
import test from 'node:test'
import { compileComponent } from '../src/index.ts'

test('compiles Loading on into a runtime dependency trigger', () => {
  const result = compileComponent(`
    import { Loading } from 'solid-js'
    export default function Page(props) {
      return (
        <Loading fallback={<text>wait</text>} on={props.route}>
          <text>{props.title}</text>
        </Loading>
      )
    }
  `)
  assert.match(result.js, /ctx\.loadingOn\(0, \(\) => \(props\.route\)\)/)
  assert.match(result.js, /propSignals: \["route"\]/)
  assert.ok(!result.wxml.includes('on='))
})

test('rejects Loading on inside a loop like any other boundary', () => {
  assert.throws(
    () =>
      compileComponent(`
        import { For, Loading } from 'solid-js'
        export default function Page(props) {
          return (
            <For each={props.items}>
              {item => <Loading fallback={<text>wait</text>} on={props.route}>{item}</Loading>}
            </For>
          )
        }
      `),
    /inside a loop/,
  )
})

test('keeps an async row component as a per-row boundary inside a loop', () => {
  const child = `
    import { Loading } from 'solid-js'
    export default function AsyncRow(props) {
      return (
        <Loading fallback={<text>wait</text>}>
          <text>{props.item}</text>
        </Loading>
      )
    }
  `
  const result = compileComponent(
    `
      import AsyncRow from './AsyncRow'
      export default function Page(props) {
        return <For each={props.items}>{item => <AsyncRow item={item} />}</For>
      }
    `,
    {
      sourceFile: '/project/src/Page.tsx',
      resolveComponent: () => ({ source: child, file: '/project/src/AsyncRow.tsx' }),
    },
  )
  assert.match(result.wxml, /<async-row [^>]*wx:for=/)
  assert.doesNotMatch(result.wxml, /wait/)
  assert.match(result.wxml, /item="\{\{item\}\}"/)
})

test('keeps previous Loading content and renders a pending indicator', () => {
  const result = compileComponent(`
    import { Loading } from 'solid-js'
    export default function Page() {
      return (
        <Loading fallback={<text>wait</text>} pending={<text class="spinner">pending</text>}>
          <text>ready</text>
        </Loading>
      )
    }
  `)
  assert.match(result.wxml, /wx:if="\{\{b0 && !b1\}\}"><text>wait/)
  assert.match(result.wxml, /wx:if="\{\{b0 && b1\}\}"><text class="spinner">pending/)
  assert.match(result.wxml, /wx:if="\{\{!b0 \|\| b1\}\}"><text>ready/)
  assert.match(result.js, /ctx\.bind\(1, \(\) => \(ctx\.hasValue\(0\)\)\)/)
})

test('keepPrevious false restores the blocking Loading fallback', () => {
  const result = compileComponent(`
    import { Loading } from 'solid-js'
    export default function Page() {
      return (
        <Loading fallback={<text>wait</text>} keepPrevious={false}>
          <text>ready</text>
        </Loading>
      )
    }
  `)
  assert.match(result.wxml, /wx:if="\{\{b0\}\}"><text>wait/)
  assert.doesNotMatch(result.wxml, /pending/)
  assert.doesNotMatch(result.js, /hasValue/)
})

test('rejects pending when keepPrevious is false', () => {
  assert.throws(
    () =>
      compileComponent(`
        import { Loading } from 'solid-js'
        export default function Page() {
          return <Loading fallback={<text>wait</text>} keepPrevious={false} pending={<text>p</text>}>x</Loading>
        }
      `),
    /pending requires keepPrevious/,
  )
})

test('rejects Errored on', () => {
  assert.throws(
    () =>
      compileComponent(`
        import { Errored } from 'solid-js'
        export default function Page() {
          return <Errored on={1} fallback={<text>bad</text>}>x</Errored>
        }
      `),
    /does not support the "on" prop/,
  )
})

test('compiles an Errored reset callback into a setup helper', () => {
  const result = compileComponent(`
    import { Errored } from 'solid-js'
    export default function Page() {
      return (
        <Errored fallback={(error, reset) => <button onClick={reset}>{error.message}</button>}>
          <text>ok</text>
        </Errored>
      )
    }
  `)
  assert.match(result.js, /const __glazeReset0 = \(\) => ctx\.reset\(0\)/)
  assert.match(result.js, /__glazeReset0/)
  assert.match(result.js, /\(ctx\.errorArray\(0\)\)\[/)
  assert.doesNotMatch(result.js, /\bb0\[/)
  assert.match(result.wxml, /bindtap="e0"/)
})

test('rejects an Errored fallback with more than two parameters', () => {
  assert.throws(
    () =>
      compileComponent(`
        import { Errored } from 'solid-js'
        export default function Page() {
          return <Errored fallback={(error, reset, extra) => <text>x</text>}>y</Errored>
        }
      `),
    /at most an error accessor and a reset function/,
  )
})
