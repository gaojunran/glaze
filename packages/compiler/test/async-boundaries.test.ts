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
