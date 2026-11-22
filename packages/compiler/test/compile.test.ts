import assert from 'node:assert/strict'
import test from 'node:test'
import { compileComponent } from '../src/index.ts'

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
  assert.match(result.js, /ctx\.event\(0, \(event\) => \(\(\) => setCount/)
})

test('rejects an unsupported nested component', () => {
  assert.throws(
    () =>
      compileComponent(`
        export default function Bad() {
          return <view><Counter /></view>
        }
      `),
    /Component <Counter> must be imported/,
  )
})

test('compiles props and an imported component', () => {
  const result = compileComponent(`
    import TodoItem from './TodoItem'

    export default function List(props) {
      return (
        <view>
          <TodoItem title={props.title} done={true} />
        </view>
      )
    }
  `)

  assert.deepEqual(result.props, ['title'])
  assert.deepEqual(result.components, [{ name: 'TodoItem', source: './TodoItem' }])
  assert.match(result.wxml, /<todo-item title="\{\{b0\}\}" done="\{\{b1\}\}" \/>/)
  assert.match(result.js, /properties: \["title"\]/)
  assert.match(result.js, /setup\(ctx, props\)/)
})

test('compiles events inside For with index lookup', () => {
  const result = compileComponent(`
    import { createSignal, For } from 'solid-js'

    export default function List() {
      const [count, setCount] = createSignal(0)
      const items = [{ id: 1 }, { id: 2 }]
      return (
        <For each={items} key="id">
          {(item, index) => (
            <button onClick={() => setCount(item.id)}>{item.id}</button>
          )}
        </For>
      )
    }
  `)

  assert.match(result.wxml, /data-glaze-index="\{\{index\}\}"/)
  assert.match(result.js, /const index = Number\(event\.currentTarget\.dataset\.glazeIndex\)/)
  assert.match(result.js, /const item = \(items\)\[index\]/)
  assert.match(result.js, /return \(\(\) => setCount\(item\.id\)\)\(event\)/)
})

test('inlines relative imports recursively', () => {
  const badge = `
    export default function Badge(props) {
      return <text class="badge">{props.label}</text>
    }
  `
  const nested = `
    import Badge from './Badge'
    export default function Nested(props) {
      return <view><text>{props.title}</text><Badge label="inner" /></view>
    }
  `
  const result = compileComponent(
    `
      import Nested from './Nested'
      export default function Page() {
        return <Nested title="outer" />
      }
    `,
    {
      inline: true,
      sourceFile: '/src/Page.tsx',
      resolveComponent: (name, specifier, fromFile) => {
        if (name === 'Nested' && fromFile === '/src/Page.tsx') {
          return { source: nested, file: '/src/Nested.tsx' }
        }
        if (name === 'Badge' && fromFile === '/src/Nested.tsx') {
          return { source: badge, file: '/src/Badge.tsx' }
        }
        return null
      },
    },
  )
  assert.match(result.wxml, /class="badge"/)
  assert.match(result.wxml, /\{\{b0\}\}/)
  assert.deepEqual(
    result.inlineComponents.map((item) => item.file).sort(),
    ['/src/Badge.tsx', '/src/Nested.tsx'],
  )
})

test('inlines a stateless imported component outside For', () => {
  const header = `
    export default function Header(props) {
      return <text class="title">{props.title}</text>
    }
  `
  const result = compileComponent(
    `
      import Header from './Header'

      export default function Page() {
        return <view><Header title="Hello" /></view>
      }
    `,
    {
      inline: true,
      resolveComponent: (name) => (name === 'Header' ? header : null),
    },
  )

  assert.doesNotMatch(result.wxml, /<header/)
  assert.match(result.wxml, /<text class="title">\{\{b0\}\}<\/text>/)
  assert.match(result.js, /const props = \{/)
  assert.match(result.js, /get title\(\) \{ return \("Hello"\); \}/)
  assert.deepEqual(result.inlineComponents, [{ name: 'Header', source: './Header' }])
})

test('inlines a stateful imported component and merges solid-js imports', () => {
  const child = `
    import { createSignal } from 'solid-js'

    export default function Child() {
      const [n, setN] = createSignal(1)
      return <button onClick={() => setN((value) => value + 1)}>{n()}</button>
    }
  `
  const result = compileComponent(
    `
      import { createSignal } from 'solid-js'
      import Child from './Child'

      export default function Page() {
        const [count] = createSignal(0)
        return <view><Child /><text>{count()}</text></view>
      }
    `,
    {
      inline: true,
      resolveComponent: (name) => (name === 'Child' ? child : null),
    },
  )

  assert.doesNotMatch(result.wxml, /<child/)
  assert.match(result.wxml, /<button bindtap="e0">\{\{b0\}\}<\/button>/)
  const solidImports = result.js.match(/from ['\"]solid-js['\"]/g) ?? []
  assert.equal(solidImports.length, 1)
  assert.match(result.js, /const \[n, setN\] = createSignal\(1\)/)
  assert.match(result.js, /ctx\.event\(0, \(event\) => \(\(\) => setN/)
})

test('emits bind, catch, mut-bind and capture event variants', () => {
  const result = compileComponent(`
    export default function Page() {
      return (
        <view
          onClick={() => {}}
          onClickCatch={() => {}}
          onClickMutBind={() => {}}
          onClickCapture={() => {}}
          onClickCaptureCatch={() => {}}
          onClickCaptureMutBind={() => {}}
        >tap</view>
      )
    }
  `)

  assert.match(result.wxml, /bindtap="e0"/)
  assert.match(result.wxml, /catchtap="e1"/)
  assert.match(result.wxml, /mut-bind:tap="e2"/)
  assert.match(result.wxml, /capture-bind:tap="e3"/)
  assert.match(result.wxml, /capture-catch:tap="e4"/)
  assert.match(result.wxml, /capture-mut-bind:tap="e5"/)
})

test('emits event binding variants on component boundaries', () => {
  const child = `
    export default function Child(props) {
      return <view><slot />{props.onToggle?.()}</view>
    }
  `
  const result = compileComponent(
    `
      import Child from './Child'

      export default function Page() {
        return (
          <Child
            onToggle={() => {}}
            onToggleCatch={() => {}}
            onToggleCapture={() => {}}
            onToggleCaptureCatch={() => {}}
            onToggleMutBind={() => {}}
            onToggleCaptureMutBind={() => {}}
          >
            <text>child</text>
          </Child>
        )
      }
    `,
    {
      inline: true,
      resolveComponent: (name) => (name === 'Child' ? child : null),
    },
  )

  assert.match(result.wxml, /bind:toggle="e0"/)
  assert.match(result.wxml, /catch:toggle="e1"/)
  assert.match(result.wxml, /capture-bind:toggle="e2"/)
  assert.match(result.wxml, /capture-catch:toggle="e3"/)
  assert.match(result.wxml, /mut-bind:toggle="e4"/)
  assert.match(result.wxml, /capture-mut-bind:toggle="e5"/)
})

test('inlines a pure component inside For', () => {
  const item = `
    export default function Item(props) {
      return <text>{props.title}</text>
    }
  `
  const result = compileComponent(
    `
      import Item from './Item'

      export default function Page() {
        const items = [{ title: 'a' }]
        return (
          <For each={items} key="title">
            {(entry) => <Item title={entry.title} />}
          </For>
        )
      }
    `,
    {
      inline: true,
      resolveComponent: (name) => (name === 'Item' ? item : null),
    },
  )

  assert.match(result.wxml, /<block wx:for="\{\{b0\}\}"[^>]*><text>\{\{entry\.title\}\}<\/text><\/block>/)
  assert.deepEqual(result.components, [])
  assert.deepEqual(result.inlineComponents, [{ name: 'Item', source: './Item' }])
})

test('inlines a pure component with an event inside For', () => {
  const row = `
    export default function Row(props) {
      return (
        <view>
          <text>{props.title}</text>
          <button onClick={() => props.onPick(props.title)}>pick</button>
        </view>
      )
    }
  `
  const result = compileComponent(
    `
      import Row from './Row'

      export default function Page() {
        const items = [{ title: 'a' }]
        return (
          <For each={items} key="title">
            {(entry) => <Row title={entry.title} onPick={(value) => console.log(value)} />}
          </For>
        )
      }
    `,
    {
      inline: true,
      resolveComponent: (name) => (name === 'Row' ? row : null),
    },
  )

  assert.doesNotMatch(result.wxml, /<row/)
  assert.match(result.wxml, /bindtap="e0"/)
  assert.match(result.js, /const entry = \(items\)\[__glazeIndex\]/)
  assert.match(result.js, /entry\.title/)
  assert.deepEqual(result.components, [])
  assert.deepEqual(result.inlineComponents, [{ name: 'Row', source: './Row' }])
})

test('inlines default children through a pure component inside For', () => {
  const card = `
    export default function Card(props) {
      return <view class="card">{props.children}</view>
    }
  `
  const result = compileComponent(
    `
      import Card from './Card'

      export default function Page() {
        const items = [{ title: 'a' }]
        return (
          <For each={items} key="title">
            {(entry) => <Card><text>{entry.title}</text></Card>}
          </For>
        )
      }
    `,
    {
      inline: true,
      resolveComponent: (name) => (name === 'Card' ? card : null),
    },
  )

  assert.doesNotMatch(result.wxml, /<card/)
  assert.match(result.wxml, /<text>\{\{entry\.title\}\}<\/text>/)
  assert.deepEqual(result.components, [])
  assert.deepEqual(result.inlineComponents, [{ name: 'Card', source: './Card' }])
})

test('keeps a stateful component boundary inside For', () => {
  const item = `
    import { createSignal } from 'solid-js'

    export default function Item(props) {
      const [count] = createSignal(0)
      return <text>{count()}{props.title}</text>
    }
  `
  const result = compileComponent(
    `
      import Item from './Item'

      export default function Page() {
        const items = [{ title: 'a' }]
        return (
          <For each={items} key="title">
            {(entry) => <Item title={entry.title} />}
          </For>
        )
      }
    `,
    {
      inline: true,
      resolveComponent: (name) => (name === 'Item' ? item : null),
    },
  )

  assert.match(result.wxml, /<item title="\{\{entry\.title\}\}" \/>/)
  assert.deepEqual(result.components, [{ name: 'Item', source: './Item' }])
  assert.deepEqual(result.inlineComponents, [])
})

test('inlines default children through props.children', () => {
  const card = `
    export default function Card(props) {
      return <view class="card"><text class="card-title">{props.title}</text>{props.children}</view>
    }
  `
  const result = compileComponent(
    `
      import Card from './Card'

      export default function Page() {
        const [count] = createSignal(0)
        return (
          <Card title="Todos">
            <text class="count">{count()}</text>
          </Card>
        )
      }
    `,
    {
      inline: true,
      resolveComponent: (name) => (name === 'Card' ? card : null),
    },
  )

  assert.doesNotMatch(result.wxml, /<card/)
  assert.match(result.wxml, /<view class="card">/)
  assert.match(result.wxml, /<text class="count">\{\{b0\}\}<\/text>/)
  assert.match(result.js, /get title\(\) \{ return \("Todos"\); \}/)
  assert.match(result.js, /ctx.bind\(0, \(\) => \(count\(\)\)\)/)
})

test('rejects an inlined component that drops props.children', () => {
  const card = `
    export default function Card(props) {
      return <view class="card">{props.title}</view>
    }
  `
  assert.throws(
    () =>
      compileComponent(
        `
          import Card from './Card'
          export default function Page() {
            return <Card title="x"><text>child</text></Card>
          }
        `,
        {
          inline: true,
          resolveComponent: (name) => (name === 'Card' ? card : null),
        },
      ),
    /does not render props.children/,
  )
})

test('compiles component events and boundary children', () => {
  const panel = `
    export default function Panel(props) {
      return <view class="panel">{props.children}</view>
    }
  `
  const result = compileComponent(
    `
      import Panel from './Panel'

      export default function Page() {
        return (
          <Panel onToggle={() => {}}>
            <text>body</text>
          </Panel>
        )
      }
    `,
    {
      inline: false,
      resolveComponent: (name) => (name === 'Panel' ? panel : null),
    },
  )

  assert.match(result.wxml, /<panel bind:toggle="e0"><text>body<\/text><\/panel>/)
  assert.deepEqual(result.components, [{ name: 'Panel', source: './Panel' }])
  assert.deepEqual(result.eventProps, {})
})

test('keeps a named-slot component as a boundary', () => {
  const card = `
    export default function SlotCard() {
      return <view><slot name="header" /><slot /></view>
    }
  `
  const result = compileComponent(
    `
      import SlotCard from './SlotCard'

      export default function Page() {
        return (
          <SlotCard>
            <text slot="header">header</text>
            <text>body</text>
          </SlotCard>
        )
      }
    `,
    {
      inline: true,
      resolveComponent: (name) => (name === 'SlotCard' ? card : null),
    },
  )

  assert.match(result.wxml, /<slot-card><text slot="header">header<\/text><text>body<\/text><\/slot-card>/)
  assert.deepEqual(result.namedSlots, [])
})

test('records named slots on the child component', () => {
  const card = `
    export default function SlotCard() {
      return <view><slot name="header" /><slot /></view>
    }
  `
  const result = compileComponent(card, {
    inline: false,
    resolveComponent: () => null,
  })
  assert.deepEqual(result.namedSlots, ['header'])
  assert.equal(result.usesSlot, true)
  assert.match(result.wxml, /<slot name="header" \/>/)
  assert.match(result.wxml, /<slot \/>/)
})

test('compiles ref to a generated id and runtime query', () => {
  const result = compileComponent(`
    export default function Page() {
      return <view ref={(node) => console.log(node)}>x</view>
    }
  `)
  assert.match(result.wxml, /<view id="glaze-r0">x<\/view>/)
  assert.match(result.js, /ctx.ref\(0, node => console.log\(node\)\)/)
  assert.equal(result.refCount, 1)
})

test('rejects ref together with id', () => {
  assert.throws(
    () =>
      compileComponent(`
        export default function Page() {
          return <view id="x" ref={() => {}}>x</view>
        }
      `),
    /cannot also set id/,
  )
})

test('compiles a context provider around an inlined consumer', () => {
  const label = `
    import { useContext } from 'solid-js'
    export default function Label(props) {
      const theme = useContext(props.theme)
      return <text class="theme">{theme}</text>
    }
  `
  const result = compileComponent(
    `
      import { createContext } from 'solid-js'
      import Label from './Label'

      export default function Page() {
        const Theme = createContext('light')
        return (
          <Theme.Provider value="dark">
            <Label theme={Theme} />
          </Theme.Provider>
        )
      }
    `,
    {
      inline: true,
      resolveComponent: (name) => (name === 'Label' ? label : null),
    },
  )

  assert.match(result.wxml, /<text class="theme">\{\{b0\}\}<\/text>/)
  assert.match(result.js, /withProvider\(Theme, \("dark"\), \(\) => \{/)
  assert.match(result.js, /const theme = useContext\(props\.theme\)/)
})

test('separates event props from properties', () => {
  const result = compileComponent(`
    export default function Item(props) {
      return <text onClick={() => props.onToggle?.()}>{props.title}</text>
    }
  `)
  assert.deepEqual(result.props, ['title'])
  assert.deepEqual(result.eventProps, { onToggle: 'toggle' })
  assert.match(result.js, /eventProps: \{"onToggle":"toggle"\}/)
  assert.match(result.js, /props\.onToggle\?\.\(\)/)
})

test('compiles Switch and Match to if/elif/else', () => {
  const result = compileComponent(`
    export default function Page() {
      const state = 'idle'
      return (
        <Switch fallback={<text class="other">other</text>}>
          <Match when={state === 'idle'}><text class="idle">idle</text></Match>
          <Match when={state === 'busy'}><text class="busy">busy</text></Match>
        </Switch>
      )
    }
  `)
  assert.match(result.wxml, /<text class="idle" wx:if="\{\{b0\}\}">idle<\/text>/)
  assert.match(result.wxml, /<text class="busy" wx:elif="\{\{b1\}\}">busy<\/text>/)
  assert.match(result.wxml, /<text class="other" wx:else>other<\/text>/)
})

test('rejects Match outside Switch', () => {
  assert.throws(
    () =>
      compileComponent(`
        export default function Page() {
          return <Match when={true}>x</Match>
        }
      `),
    /must be a direct child of <Switch>/,
  )
})

test('compiles class objects and dynamic styles', () => {
  const result = compileComponent(`
    export default function Page(props) {
      return (
        <view
          class={{ base: true, active: props.active, hidden: false }}
          style={{ color: props.color, fontSize: '12px' }}
        >
          x
        </view>
      )
    }
  `)
  assert.match(result.wxml, /class="\{\{b0\}\}" style="\{\{b1\}\}"/)
  assert.match(result.js, /import \{ defineGlazeComponent, className, styleName \}/)
  assert.match(result.js, /className\(\{/)
  assert.match(result.js, /styleName\(\{/)
})

test('inlines class arrays and style objects inside For', () => {
  const result = compileComponent(`
    export default function Page() {
      return (
        <For each={[1]} key="*this">
          {(item) => (
            <view
              class={['btn', item > 0 && 'on', item ? 'yes' : 'no']}
              style={{ color: item ? 'red' : 'blue' }}
            >
              x
            </view>
          )}
        </For>
      )
    }
  `)
  assert.match(result.wxml, /class="btn \{\{item > 0 \? 'on' : ''\}\} \{\{item \? 'yes' : 'no'\}\}"/)
  assert.match(result.wxml, /style="color:\{\{item \? 'red' : 'blue'\}\}"/)
})

test('compiles For fallback and Repeat', () => {
  const forResult = compileComponent(`
    export default function Page(props) {
      return (
        <For each={props.items} key="id" fallback={<text>empty</text>}>
          {(item) => <text>{item.title}</text>}
        </For>
      )
    }
  `)
  assert.match(forResult.wxml, /<block wx:if="\{\{b1\}\}">/)
  assert.match(forResult.wxml, /<text wx:else>empty<\/text>/)
  assert.match(forResult.js, /ctx.bind\(1, \(\) => \(\(props\.items \|\| \[\]\)\.length > 0\)\)/)

  const repeatResult = compileComponent(`
    export default function Page(props) {
      return (
        <Repeat count={props.count} from={1} fallback={<text>none</text>}>
          {(index) => <text>{index}</text>}
        </Repeat>
      )
    }
  `)
  assert.match(repeatResult.wxml, /wx:for-item="index"/)
  assert.match(repeatResult.wxml, /<text wx:else>none<\/text>/)
  assert.match(repeatResult.js, /Array\.from\(\{ length: \(props\.count\) \}/)
})

test('compiles keyed For modes', () => {
  const unkeyed = compileComponent(`
    export default function Page(props) {
      return (
        <For each={props.items} keyed={false}>
          {(item) => <text>{item().title}</text>}
        </For>
      )
    }
  `)
  assert.doesNotMatch(unkeyed.wxml, /wx:key=/)
  assert.match(unkeyed.wxml, /\{\{item\.title\}\}/)

  const unkeyedEvent = compileComponent(`
    export default function Page(props) {
      return (
        <For each={props.items} keyed={false}>
          {(item) => <text onClick={() => pick(item().id)}>{item().title}</text>}
        </For>
      )
    }
  `)
  assert.match(unkeyedEvent.js, /pick\(item\.id\)/)
  assert.doesNotMatch(unkeyedEvent.js, /item\(\)/)

  const keyedFn = compileComponent(`
    export default function Page(props) {
      return (
        <For each={props.items} keyed={(item) => item.id}>
          {(item) => <text>{item().title}</text>}
        </For>
      )
    }
  `)
  assert.match(keyedFn.wxml, /wx:key="id"/)
  assert.match(keyedFn.wxml, /\{\{item\.title\}\}/)
})

test('compiles Show function children', () => {
  const keyed = compileComponent(`
    export default function Page(props) {
      return (
        <Show when={props.user} keyed fallback={<text>none</text>}>
          {(user) => <text>{user.name}</text>}
        </Show>
      )
    }
  `)
  assert.match(keyed.wxml, /<block wx:if="\{\{b0\}\}">/)
  assert.match(keyed.wxml, /wx:for-item="user"/)
  assert.match(keyed.wxml, /\{\{user\.name\}\}/)
  assert.match(keyed.wxml, /<text wx:else>none<\/text>/)

  const accessor = compileComponent(`
    export default function Page(props) {
      return (
        <Show when={props.user}>
          {(user) => <text>{user().name}</text>}
        </Show>
      )
    }
  `)
  assert.match(accessor.wxml, /\{\{b0\.name\}\}/)
})

test('hoists outer expressions inside For', () => {
  const result = compileComponent(`
    import { For } from 'solid-js'
    export default function Page(props) {
      return (
        <For each={props.items} keyed={(item) => item.id}>
          {(item) => <text>{props.prefix}{format(props.suffix)}</text>}
        </For>
      )
    }
  `)
  assert.match(result.wxml, /<text>\{\{b1\}\}\{\{b2\}\}<\/text>/)
  assert.match(result.js, /ctx\.bind\(1, \(\) => \(props\.prefix\)\)/)
  assert.match(result.js, /ctx\.bind\(2, \(\) => \(format\(props\.suffix\)\)\)/)
})

test('rejects calls that depend on a loop item', () => {
  assert.throws(
    () =>
      compileComponent(`
        export default function Page(props) {
          return (
            <For each={props.items} keyed={(item) => item.id}>
              {(item) => <text>{format(item().title)}</text>}
            </For>
          )
        }
      `),
    /must not depend on loop values/,
  )
})

test('supports local const declarations in For callbacks', () => {
  const result = compileComponent(`
    export default function Page(props) {
      return (
        <For each={props.items} keyed={(item) => item.id}>
          {(item) => {
            const label = item().done ? 'done' : 'todo'
            const id = item().id
            return <button onClick={() => pick(id)}>{label}</button>
          }}
        </For>
      )
    }
  `)
  assert.match(result.wxml, /\{\{item\.done \? 'done' : 'todo'\}\}/)
  assert.match(result.js, /pick\(item\.id\)/)
})

test('compiles keyed Match callbacks', () => {
  const result = compileComponent(`
    export default function Page(props) {
      return (
        <Switch fallback={<text>none</text>}>
          <Match when={props.user} keyed>
            {(user) => <text>{user.name}</text>}
          </Match>
          <Match when={props.other}>
            {(value) => <text>{value().label}</text>}
          </Match>
        </Switch>
      )
    }
  `)
  assert.match(result.wxml, /<block wx:if="\{\{b0\}\}">/)
  assert.match(result.wxml, /wx:for-item="user"/)
  assert.match(result.wxml, /wx:elif="\{\{b2\}\}"/)
  assert.match(result.wxml, /\{\{b2\.label\}\}/)
})

test('maps camelCase component props to lowercase WXML properties', () => {
  const result = compileComponent(
    `
      import Child from './Child'
      export default function Page() {
        return <Child userName="Ada" />
      }
    `,
    { inline: false },
  )
  assert.match(result.wxml, /<child username="Ada" \/>/)
  const child = compileComponent(`
    export default function Child(props) {
      return <text>{props.userName}</text>
    }
  `)
  assert.deepEqual(child.propertyNames, ['username'])
  assert.deepEqual(child.propMap, { userName: 'username' })
  assert.match(child.js, /properties: \["username"\]/)
  assert.match(child.js, /propMap: \{"userName":"username"\}/)
})

test('stops recursive inlining at the component boundary', () => {
  const source = `
    import Node from './Node'
    export default function NodeView(props) {
      return <view><text>{props.label}</text><Node label="inner" /></view>
    }
  `
  const result = compileComponent(source, {
    inline: true,
    sourceFile: '/src/Node.tsx',
    resolveComponent: (name) =>
      name === 'Node' ? { source, file: '/src/Node.tsx' } : null,
  })
  assert.match(result.wxml, /<node label="inner" \/>/)
  assert.deepEqual(result.components.map((item) => item.name), ['Node'])
})

test('compiles destructured For and Show parameters', () => {
  const result = compileComponent(`
    export default function Page(props) {
      return (
        <For each={props.items} key="id">
          {({ id, title: label }) => (
            <text onClick={() => pick(id)}>{id}-{label}</text>
          )}
        </For>
      )
    }
  `)
  assert.match(result.wxml, /\{\{__glazeItem\.id\}\}-\{\{__glazeItem\.title\}\}/)
  assert.match(result.js, /pick\(__glazeItem\.id\)/)

  const nested = compileComponent(`
    export default function Page(props) {
      return (
        <Show when={props.user} keyed>
          {({ profile: { name } }) => <text>{name}</text>}
        </Show>
      )
    }
  `)
  assert.match(nested.wxml, /\{\{__glazeValue\.profile\.name\}\}/)
})

test('rejects destructuring an accessor item', () => {
  assert.throws(
    () =>
      compileComponent(`
        export default function Page(props) {
          return <For each={props.items} keyed={false}>{({ id }) => <text>{id}</text>}</For>
        }
      `),
    /Destructuring a <For> item requires keyed=true/,
  )
})

test('compiles Show and Repeat inside For through WXS helpers', () => {
  const result = compileComponent(`
    export default function Page(props) {
      return (
        <For each={props.rows} keyed={(row) => row.id}>
          {(row) => (
            <view>
              <Show when={row().user} keyed>
                {(user) => <text>{user.name}</text>}
              </Show>
              <Repeat count={row().count} from={1}>
                {(index) => <text>{index}</text>}
              </Repeat>
            </view>
          )}
        </For>
      )
    }
  `)
  assert.match(result.wxml, /<wxs module="glazeRange">/)
  assert.match(result.wxml, /glazeRange\.single\(row\.user\)/)
  assert.match(result.wxml, /glazeRange\.range\(row\.count, 1\)/)
  assert.match(result.wxml, /wx:for-item="__glazeRepeat1"/)
})

test('passes hyphenated native attributes through unchanged', () => {
  const result = compileComponent(`
    export default function Page() {
      return <view hover-class="tapped" data-id="main">x</view>
    }
  `)
  assert.match(result.wxml, /<view hover-class="tapped" data-id="main">x<\/view>/)
})

test('expands static spread attributes', () => {
  const result = compileComponent(`
    export default function Page(props) {
      return <view {...{ class: 'box', id: 'main' }}>{props.title}</view>
    }
  `)
  assert.match(result.wxml, /<view class="box" id="main">/)
})

test('rejects dynamic spread attributes', () => {
  assert.throws(
    () =>
      compileComponent(`
        export default function Page(props) {
          return <view {...props}>x</view>
        }
      `),
    /Only object literals can be spread/,
  )
})

test('rejects destructured props', () => {
  assert.throws(
    () =>
      compileComponent(`
        export default function Bad({ title }) {
          return <text>{title}</text>
        }
      `),
    /Destructuring props is not reactive/,
  )
})

test('keeps wx:if on nested control flow and inline components', () => {
  const result = compileComponent(
    `
      import Card from './Card'
      export default function Page(props) {
        return (
          <Show when={props.outer}>
            <Show when={props.inner}><text>both</text></Show>
            <Card title="x" />
          </Show>
        )
      }
    `,
    {
      inline: true,
      resolveComponent: () => `
        export default function Card(props) {
          return <view><text>{props.title}</text></view>
        }
      `,
    },
  )
  assert.match(result.wxml, /<block wx:if="\{\{b0\}\}">/)
  assert.match(result.wxml, /<text wx:if="\{\{b1\}\}">both<\/text>/)
  assert.match(result.wxml, /<block wx:if="\{\{b0\}\}">.*<view><text>\{\{b2\}\}<\/text><\/view>/)
})

test('guards conditional and fallback bindings against nullish values', () => {
  const result = compileComponent(`
    export default function Page(props) {
      return (
        <view>
          <Show when={props.user} fallback={<text>{props.empty.value}</text>}>
            <text>{props.user.name}</text>
          </Show>
          <For each={props.items} fallback={<text>{props.items[0].title}</text>}>
            {(item) => <text>{item.title}</text>}
          </For>
        </view>
      )
    }
  `)
  assert.match(result.js, /\(\(props\.user\)\) \? \(props\.user\.name\) : undefined/)
  assert.match(result.js, /\(\(!\(props\.user\)\)\) \? \(props\.empty\.value\) : undefined/)
  assert.match(result.js, /\(\(\(props\.items \|\| \[\]\)\.length === 0\)\) \? \(props\.items\[0\]\.title\) : undefined/)
})

test('rejects raw JSX values in expressions and props', () => {
  assert.throws(
    () =>
      compileComponent(`
        export default function Page(props) {
          return <view>{props.items.map((item) => <text>{item}</text>)}</view>
        }
      `),
    /JSX values are not supported/,
  )
  assert.throws(
    () =>
      compileComponent(`
        export default function Page(props) {
          return <view title={<text>a</text>} />
        }
      `),
    /JSX values are not supported/,
  )
})

test('supports numeric component props without stringifying them', () => {
  const result = compileComponent(
    `
      import Child from './Child'
      export default function Page() {
        return <Child count={3} />
      }
    `,
    { inline: false },
  )
  assert.match(result.wxml, /count="\{\{3\}\}"/)
})

test('adds loop index markers to component events', () => {
  const result = compileComponent(
    `
      import Item from './Item'
      export default function Page(props) {
        return (
          <For each={props.items} keyed={(item) => item.id}>
            {(item) => <Item onToggle={() => pick(item().id)} />}
          </For>
        )
      }
    `,
    { inline: false },
  )
  assert.match(result.wxml, /bind:toggle="e0" data-glaze-index="\{\{__glazeIndex\}\}"/)
  assert.match(result.js, /dataset\.glazeIndex/)
  assert.match(result.js, /const item = \(props\.items\)\[__glazeIndex\]/)
})

test('rejects multiple children on For and Repeat', () => {
  assert.throws(
    () =>
      compileComponent(`
        export default function Page(props) {
          return <For each={props.items}>{(item) => <text>{item}</text>}{(item) => <b>{item}</b>}</For>
        }
      `),
    /exactly one arrow-function child/,
  )
  assert.throws(
    () =>
      compileComponent(`
        export default function Page() {
          return <Repeat count={2}>{() => <text>a</text>}{() => <text>b</text>}</Repeat>
        }
      `),
    /exactly one arrow-function child/,
  )
})

test('uses distinct default indexes for nested For loops', () => {
  const result = compileComponent(`
    export default function Page(props) {
      return (
        <For each={props.rows}>
          {(row) => <For each={row.cells}>{(cell) => <text>{cell}</text>}</For>}
        </For>
      )
    }
  `)
  assert.match(result.wxml, /wx:for-index="__glazeIndex"/)
  assert.match(result.wxml, /wx:for-index="__glazeIndex1"/)
})

test('omits wx:key by default instead of stringifying object items', () => {
  const result = compileComponent(`
    export default function Page(props) {
      return <For each={props.items}>{(item) => <text>{item.title}</text>}</For>
    }
  `)
  assert.doesNotMatch(result.wxml, /wx:key="\*this"/)
})

test('offsets Repeat index inside For event handlers', () => {
  const result = compileComponent(`
    export default function Page(props) {
      return (
        <For each={props.rows}>
          {(row) => (
            <Repeat count={2} from={10}>
              {(n) => <button onClick={() => pick(n)}>{n}</button>}
            </Repeat>
          )}
        </For>
      )
    }
  `)
  assert.match(result.js, /const __glazeRepeat1 = __glazeIndex1 \+ \(10\);/)
  assert.match(result.js, /pick\(__glazeRepeat1\)/)
})

test('rejects refs and providers inside loop or branch scopes', () => {
  assert.throws(
    () =>
      compileComponent(`
        export default function Page(props) {
          return <For each={props.items}>{(item) => <view ref={(node) => pick(node)} />}</For>
        }
      `),
    /ref inside/,
  )
  assert.throws(
    () =>
      compileComponent(`
        export default function Page(props) {
          const Theme = createContext('light')
          return <For each={props.items}>{(item) => <Theme value="dark"><text>x</text></Theme>}</For>
        }
      `),
    /not supported inside/,
  )
})

test('rejects unknown native events and innerHTML', () => {
  assert.throws(
    () =>
      compileComponent(`
        export default function Page() {
          return <view onHover={() => {}} />
        }
      `),
    /Unsupported event/,
  )
  assert.throws(
    () =>
      compileComponent(`
        export default function Page() {
          return <view innerHTML="<b>x</b>" />
        }
      `),
    /innerHTML/,
  )
})

test('keeps named export declarations in the generated module', () => {
  const result = compileComponent(`
    export const format = (value) => String(value).toUpperCase()
    export function helper(value) {
      return value
    }
    export default function Page(props) {
      return <text>{format(props.name)}</text>
    }
  `)
  assert.match(result.js, /const format =/)
  assert.match(result.js, /function helper/)
  assert.doesNotMatch(result.js, /export const format/)
})

test('supports Solid 2 context providers and rejects loop providers', () => {
  const result = compileComponent(`
    export default function Page() {
      const Theme = createContext('light')
      return <Theme value="dark"><text>{useContext(Theme)}</text></Theme>
    }
  `)
  assert.match(result.js, /withProvider\(Theme, \("dark"\)/)
  assert.match(result.js, /ctx\.bind\(0, \(\) => \(useContext\(Theme\)\)\)/)
})

test('preserves text whitespace without WXML brace collisions', () => {
  const result = compileComponent(`
    export default function Page(props) {
      return <text>Hello {props.name}!</text>
    }
  `)
  assert.match(result.wxml, /Hello \{\{b0\}\}!/)

  const literal = compileComponent(`
    export default function Page() {
      return <text>use {'{{ value }}'} here</text>
    }
  `)
  assert.match(literal.wxml, /&#123;&#123; value &#125;&#125;/)
})

test('normalizes static style objects to kebab-case', () => {
  const result = compileComponent(`
    export default function Page() {
      return <view style={{ backgroundColor: 'red', width: 10 }} />
    }
  `)
  assert.match(result.wxml, /style="background-color: red; width: 10"/)
})

test('supports a Switch fallback without any Match', () => {
  const result = compileComponent(`
    export default function Page() {
      return <Switch fallback={<text>none</text>}></Switch>
    }
  `)
  assert.match(result.wxml, /<text>none<\/text>/)
})

test('renders non-keyed Show callbacks without remounting loops', () => {
  const result = compileComponent(`
    export default function Page(props) {
      return (
        <Show when={props.user}>
          {(user) => <text>{user().name}</text>}
        </Show>
      )
    }
  `)
  assert.doesNotMatch(result.wxml, /wx:for/)
  assert.match(result.wxml, /<block wx:if="\{\{b0\}\}"><text>\{\{b0\.name\}\}<\/text><\/block>/)
})

test('rejects props that collide with generated data keys', () => {
  assert.throws(
    () =>
      compileComponent(`
        export default function Child(props) {
          return <text>{props.b0}</text>
        }
      `),
    /compiler data keys/,
  )
})

test('resolves outer Show accessors inside nested For scopes', () => {
  const result = compileComponent(`
    export default function Page(props) {
      return (
        <For each={props.rows}>
          {(row) => (
            <Show when={row.user}>
              {(user) => (
                <For each={user().items}>
                  {(item) => <button onClick={() => pick(item, user().name)}>{item}</button>}
                </For>
              )}
            </Show>
          )}
        </For>
      )
    }
  `)
  assert.match(result.wxml, /wx:for="\{\{row\.user\.items\}\}"/)
  assert.match(result.js, /const __glazeValue1 = \(row\.user\);/)
  assert.match(result.js, /pick\(item, __glazeValue1\.name\)/)
})

test('supports class and style objects on component tags', () => {
  const result = compileComponent(
    `
      import Child from './Child'
      export default function Page(props) {
        return <Child class={{ active: props.active }} style={{ marginTop: 4 }} />
      }
    `,
    { inline: false },
  )
  assert.match(result.wxml, /class="\{\{b0\}\}"/)
  assert.match(result.wxml, /style="margin-top: 4"/)
  assert.match(result.js, /className\(\{[\s\S]*active: props\.active[\s\S]*\}\)/)
})

test('emits an optional binding group size', () => {
  const defaultResult = compileComponent(source)
  assert.doesNotMatch(defaultResult.js, /bindingGroupSize/)

  const grouped = compileComponent(source, { bindingGroupSize: 1 })
  assert.match(grouped.js, /bindingGroupSize: 1,/)
})

test('passes imported context through a component boundary', () => {
  const parent = compileComponent(
    `
      import { Theme } from './Theme'
      import Child from './Child'
      export default function Page() {
        return <Theme.Provider value="dark"><Child /></Theme.Provider>
      }
    `,
    { sourceFile: '/app/Page.tsx' },
  )
  assert.match(parent.wxml, /<child glazecontext="\{\{b0\}\}" \/>/)
  assert.match(parent.js, /withProvider\(Theme, \("dark"\)/)

  const child = compileComponent(
    `
      import { useContext } from 'solid-js'
      import { Theme } from './Theme'
      export default function Child() {
        const theme = useContext(Theme)
        return <text>{theme}</text>
      }
    `,
    { sourceFile: '/app/Child.tsx' },
  )
  assert.deepEqual(child.propertyNames, ['glazecontext'])
  assert.equal(child.boundaryContexts.length, 1)
  assert.match(child.js, /withBoundaryContexts\(\[\{ context: Theme, key: "\/app\/Theme#Theme" \}\]/)
  assert.match(child.js, /boundaryContexts: \[\{"name":"Theme","key":"\/app\/Theme#Theme"\}\]/)
})

test('rejects a local context that would cross a component boundary', () => {
  assert.throws(
    () =>
      compileComponent(
        `
          import { createContext } from 'solid-js'
          import Child from './Child'
          const Theme = createContext('light')
          export default function Page() {
            return <Theme.Provider value="dark"><Child /></Theme.Provider>
          }
        `,
        { sourceFile: '/app/Page.tsx' },
      ),
    /cannot cross a component boundary/,
  )
})

test('compiles Loading and Errored boundaries', () => {
  const result = compileComponent(`
    import { Loading, Errored } from 'solid-js'
    export default function Page() {
      return (
        <view>
          <Loading fallback={<text>loading</text>}><text>ready</text></Loading>
          <Errored fallback={<text>failed</text>}><text>value</text></Errored>
        </view>
      )
    }
  `)
  assert.match(result.wxml, /wx:if="\{\{b0\}\}"><text>loading<\/text><\/block><block wx:else><text>ready/)
  assert.match(result.wxml, /wx:if="\{\{b1\}\}"><text>failed<\/text><\/block><block wx:else><text>value/)
  assert.match(result.js, /ctx\.bind\(0, \(\) => \(ctx\.loading\(0\)\)\)/)
  assert.match(result.js, /ctx\.bind\(1, \(\) => \(ctx\.errored\(1\)\)\)/)
  assert.match(result.js, /errorBoundary: true/)
  assert.match(
    result.js,
    /asyncStatus: \[\{\"index\":0,\"kind\":\"loading\",\"boundary\":0\},\{\"index\":1,\"kind\":\"error\",\"boundary\":1\}\]/,
  )
})

test('assigns separate ids to nested Loading boundaries', () => {
  const result = compileComponent(`
    import { Loading } from 'solid-js'
    export default function Page() {
      return (
        <Loading fallback={<text>outer</text>}>
          <Loading fallback={<text>inner</text>}>
            <text>{later()}</text>
          </Loading>
        </Loading>
      )
    }
  `)
  assert.match(result.wxml, /wx:if="\{\{b0\}\}"><text>outer<\/text><\/block><block wx:else><block wx:if="\{\{b1\}\}"><text>inner/)
  assert.match(result.js, /ctx\.bind\(0, \(\) => \(ctx\.loading\(0\)\)\)/)
  assert.match(result.js, /ctx\.bind\(1, \(\) => \(ctx\.loading\(1\)\), 0\)/)
  assert.match(result.js, /ctx\.bind\(2, \(\) => \(later\(\)\), 1\)/)
})

test('marks relative resource literals for build-time asset rewriting', () => {
  const relative = compileComponent(`
    export default function Page() {
      return <view><image src="./assets/logo.png" poster="https://cdn.example/poster.png" /></view>
    }
  `)
  assert.equal(relative.assets.length, 1)
  assert.equal(relative.assets[0].specifier, './assets/logo.png')
  assert.match(relative.wxml, /src="__GLAZE_ASSET_0__"/)
  assert.match(relative.wxml, /poster="https:\/\/cdn\.example\/poster\.png"/)

  const dynamic = compileComponent(`
    export default function Page(props) {
      return <view><image src={props.src} /></view>
    }
  `)
  assert.equal(dynamic.assets.length, 0)
  assert.match(dynamic.wxml, /src="\{\{b0\}\}"/)
})

test('compiles an Errored function fallback with an error accessor', () => {
  const result = compileComponent(`
    import { Errored } from 'solid-js'
    export default function Page() {
      return (
        <Errored fallback={(error) => <text class="error">{error().message}</text>}>
          <text>{broken()}</text>
        </Errored>
      )
    }
  `)
  assert.match(result.wxml, /wx:if="\{\{b1\}\}"/)
  assert.match(result.wxml, /wx:for="\{\{b0\}\}"/)
  assert.match(result.wxml, /wx:for-item="error"/)
  assert.match(result.wxml, /\{\{error\.message\}\}/)
  assert.match(result.js, /ctx\.bind\(0, \(\) => \(ctx\.errorArray\(0\)\)\)/)
  assert.match(result.js, /ctx\.bind\(2, \(\) => \(broken\(\)\), 0\)/)
})
