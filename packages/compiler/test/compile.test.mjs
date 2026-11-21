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
  assert.match(result.js, /ctx.event\(0, \(\) => setN/)
})

test('keeps a component boundary inside For', () => {
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
  assert.match(accessor.wxml, /\{\{user\.name\}\}/)
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
