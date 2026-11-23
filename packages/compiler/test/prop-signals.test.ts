import assert from 'node:assert/strict'
import test from 'node:test'
import { compileComponent } from '../src/index.ts'

// `propSignals` is omitted when every declared property needs a signal: the
// runtime treats an absent field as "all properties". Parse both forms so the
// tests compare the real signal set, not the wire encoding.
const signalNames = (result: ReturnType<typeof compileComponent>) => {
  const match = /propSignals: (\[[^\]]*\])/.exec(result.js)
  return match ? (JSON.parse(match[1]) as string[]) : [...result.propertyNames]
}

const sorted = (names: string[]) => [...names].sort()

test('projects prop-only arithmetic without a signal', () => {
  const result = compileComponent(`
    export default function Page(props) {
      return <view data-other={props.other}><text>{props.title + props.count}</text></view>
    }
  `)
  assert.equal(result.bindingCount, 0)
  assert.match(result.wxml, /\{\{title \+ count\}\}/)
  assert.deepEqual(signalNames(result), [])
})

test('signals a prop read inside an event handler', () => {
  const result = compileComponent(`
    export default function Page(props) {
      return (
        <view data-other={props.other}>
          <button onClick={() => save(props.title)}>save</button>
        </view>
      )
    }
  `)
  assert.deepEqual(signalNames(result), ['title'])
})

test('signals an event handler defined in setup', () => {
  const result = compileComponent(`
    export default function Page(props) {
      const save = () => saveTitle(props.title)
      return (
        <view data-other={props.other}>
          <button onClick={save}>save</button>
        </view>
      )
    }
  `)
  assert.deepEqual(signalNames(result), ['title'])
})

test('keeps a signal when WXML and an event both read the same prop', () => {
  const result = compileComponent(`
    export default function Page(props) {
      return (
        <view data-other={props.other}>
          <text>{props.title}</text>
          <button onClick={() => save(props.title)}>save</button>
        </view>
      )
    }
  `)
  assert.match(result.wxml, /<text>\{\{title\}\}<\/text>/)
  assert.deepEqual(signalNames(result), ['title'])
})

test('falls back to a binding when an expression mixes in local state', () => {
  const result = compileComponent(`
    export default function Page(props) {
      const n = 1
      return <view data-other={props.other}><text>{props.title + n}</text></view>
    }
  `)
  assert.equal(result.bindingCount, 1)
  assert.deepEqual(signalNames(result), ['title'])
})

test('projects nested property access', () => {
  const result = compileComponent(`
    export default function Page(props) {
      return <view data-other={props.other}><text>{props.user.name}</text></view>
    }
  `)
  assert.equal(result.bindingCount, 0)
  assert.match(result.wxml, /\{\{user\.name\}\}/)
  assert.deepEqual(signalNames(result), [])
})

test('keeps optional chaining on the binding path', () => {
  const result = compileComponent(`
    export default function Page(props) {
      return <view data-other={props.other}><text>{props.user?.name}</text></view>
    }
  `)
  assert.equal(result.bindingCount, 1)
  assert.deepEqual(signalNames(result), ['user'])
})

test('falls back to every prop for computed access', () => {
  const result = compileComponent(`
    export default function Page(props) {
      const key = 'title'
      return <view data-other={props.other}><text>{props[key]}</text></view>
    }
  `)
  assert.deepEqual(signalNames(result), [...result.propertyNames])
})

test('falls back to every prop for a bare props alias', () => {
  const result = compileComponent(`
    export default function Page(props) {
      const snapshot = props
      return <view data-other={props.other}><text>{snapshot.title}</text></view>
    }
  `)
  assert.deepEqual(signalNames(result), [...result.propertyNames])
})

test('signals props read by class and style helpers', () => {
  const result = compileComponent(`
    export default function Page(props) {
      return (
        <view
          data-other={props.other}
          class={{ on: props.on }}
          style={{ color: props.color }}
        />
      )
    }
  `)
  assert.deepEqual(sorted(signalNames(result)), ['color', 'on'])
})

test('projects For sources and Show conditions', () => {
  const result = compileComponent(`
    import { For, Show } from 'solid-js'
    export default function Page(props) {
      return (
        <view data-other={props.other}>
          <Show when={props.open}>
            <For each={props.items}>{item => <text>{item}</text>}</For>
          </Show>
        </view>
      )
    }
  `)
  assert.deepEqual(signalNames(result), [])
})

test('signals outer props referenced inside a For body', () => {
  const result = compileComponent(`
    import { For } from 'solid-js'
    export default function Page(props) {
      return (
        <view data-other={props.other}>
          <For each={props.items}>{item => <text>{props.prefix + item}</text>}</For>
        </view>
      )
    }
  `)
  assert.deepEqual(signalNames(result), ['prefix'])
})

test('signals props read by a For source expression that is not projectable', () => {
  const result = compileComponent(`
    import { For } from 'solid-js'
    export default function Page(props) {
      return (
        <view data-other={props.other}>
          <For each={props.items.filter(Boolean)}>{item => <text>{item}</text>}</For>
        </view>
      )
    }
  `)
  assert.deepEqual(signalNames(result), ['items'])
})

test('signals props read by a Show condition inside a For body', () => {
  const result = compileComponent(`
    import { For, Show } from 'solid-js'
    export default function Page(props) {
      return (
        <view data-other={props.other}>
          <For each={props.items}>
            {item => <Show when={props.open}><text>{item}</text></Show>}
          </For>
        </view>
      )
    }
  `)
  assert.deepEqual(signalNames(result), ['open'])
})

test('signals Repeat count and from', () => {
  const result = compileComponent(`
    import { Repeat } from 'solid-js'
    export default function Page(props) {
      return (
        <view data-other={props.other}>
          <Repeat count={props.count} from={props.start}>{i => <text>{i}</text>}</Repeat>
        </view>
      )
    }
  `)
  assert.deepEqual(sorted(signalNames(result)), ['count', 'start'])
})

test('signals props read inside a ref callback', () => {
  const result = compileComponent(`
    export default function Page(props) {
      return <view data-other={props.other} ref={(el) => log(props.title, el)} />
    }
  `)
  assert.deepEqual(signalNames(result), ['title'])
})

test('signals props hidden behind a template literal', () => {
  const result = compileComponent(`
    export default function Page(props) {
      return <view data-other={props.other}><text>{\`\${props.title}\`}</text></view>
    }
  `)
  assert.deepEqual(signalNames(result), ['title'])
})

test('signals props hidden inside an object literal', () => {
  const result = compileComponent(`
    export default function Page(props) {
      return <view data-other={props.other}><text>{JSON.stringify({ title: props.title })}</text></view>
    }
  `)
  assert.deepEqual(signalNames(result), ['title'])
})

test('signals props read by a conditional that also uses local state', () => {
  const result = compileComponent(`
    export default function Page(props) {
      const n = 1
      return <view data-other={props.other}><text>{props.on ? props.title : n}</text></view>
    }
  `)
  assert.deepEqual(sorted(signalNames(result)), ['on', 'title'])
})

test('emits lowercase property names in propSignals', () => {
  const result = compileComponent(`
    export default function Page(props) {
      return (
        <view data-other={props.other}>
          <button onClick={() => save(props.userName)}>save</button>
        </view>
      )
    }
  `)
  assert.deepEqual(signalNames(result), ['username'])
})

test('projects a prop passed directly to a child component', () => {
  const result = compileComponent(
    `
      import Child from './Child'
      export default function Page(props) {
        return <view data-other={props.other}><Child label={props.title} /></view>
      }
    `,
    {
      resolveComponent: () => `
        export default function Child(props) {
          return <text>{props.label}</text>
        }
      `,
    },
  )
  assert.deepEqual(signalNames(result), [])
})

test('projects static spread attributes', () => {
  const result = compileComponent(`
    export default function Page(props) {
      return <view {...{ title: props.title }} data-other={props.other} />
    }
  `)
  assert.deepEqual(signalNames(result), [])
})

test('signals props read by a createMemo in setup', () => {
  const result = compileComponent(`
    import { createMemo } from 'solid-js'
    export default function Page(props) {
      const title = createMemo(() => props.title)
      return <view data-other={props.other}><text>{title()}</text></view>
    }
  `)
  assert.deepEqual(signalNames(result), ['title'])
})

test('signals props read inside onMount', () => {
  const result = compileComponent(`
    import { onMount } from 'solid-js'
    export default function Page(props) {
      onMount(() => log(props.title))
      return <view data-other={props.other} />
    }
  `)
  assert.deepEqual(signalNames(result), ['title'])
})

test('signals class and style helpers inside a For body', () => {
  const result = compileComponent(`
    import { For } from 'solid-js'
    export default function Page(props) {
      return (
        <view data-other={props.other}>
          <For each={props.items}>
            {item => <text class={{ on: props.on }} style={{ color: props.color }}>{item}</text>}
          </For>
        </view>
      )
    }
  `)
  assert.deepEqual(sorted(signalNames(result)), ['color', 'on'])
})

test('signals props read by an event handler inside a For body', () => {
  const result = compileComponent(`
    import { For } from 'solid-js'
    export default function Page(props) {
      return (
        <view data-other={props.other}>
          <For each={props.items}>
            {item => <button onClick={() => save(props.title)}>{item}</button>}
          </For>
        </view>
      )
    }
  `)
  assert.deepEqual(signalNames(result), ['title'])
})
