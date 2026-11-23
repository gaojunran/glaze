import assert from 'node:assert/strict'
import test from 'node:test'
import { compileComponent } from '../src/index.ts'

// Edge cases that are independent from compile.test.ts. Each case is a separate
// test so a regression only names the behaviour it broke.

test('preserves spaces in single-line JSX text', () => {
  const result = compileComponent(`
    export default function Page() {
      return <text>  hello  </text>
    }
  `)
  assert.equal(result.wxml, '<text>  hello  </text>')
  assert.equal(result.bindingCount, 0)
})

test('collapses multiline JSX text into one line', () => {
  const result = compileComponent(`
    export default function Page() {
      return (
        <text>
          alpha
          beta
        </text>
      )
    }
  `)
  assert.equal(result.wxml, '<text>alpha beta</text>')
})

test('decodes a &nbsp; entity to a non-breaking space', () => {
  const result = compileComponent(`
    export default function Page() {
      return <text>&nbsp;</text>
    }
  `)
  assert.ok(result.wxml.includes('\u00a0'))
  assert.doesNotMatch(result.wxml, /&nbsp;/)
})

test('escapes an ampersand in a literal &nbsp; string child', () => {
  const result = compileComponent(`
    export default function Page() {
      return <text>{'&nbsp;'}</text>
    }
  `)
  assert.ok(result.wxml.includes('<text>&amp;nbsp;</text>'))
})

test('escapes literal braces in JSX text', () => {
  const result = compileComponent(`
    export default function Page() {
      return <text>a {'{'} b</text>
    }
  `)
  assert.ok(result.wxml.includes('a &#123; b'))
})

test('emits adjacent expression children without separators', () => {
  const result = compileComponent(`
    export default function Page(props) {
      return <text>{props.a}{props.b}</text>
    }
  `)
  assert.ok(result.wxml.includes('{{a}}{{b}}'))
  assert.equal(result.bindingCount, 0)
})

test('keeps the space between an expression and following text', () => {
  const result = compileComponent(`
    export default function Page(props) {
      return <text>{props.a} world</text>
    }
  `)
  assert.ok(result.wxml.includes('{{a}} world'))
})

test('drops whitespace-only JSX children', () => {
  const result = compileComponent(`
    export default function Page() {
      return <view>   </view>
    }
  `)
  assert.equal(result.wxml, '<view />')
})

test('keeps double-quoted string literals inside an attribute expression', () => {
  const result = compileComponent(`
    export default function Page(props) {
      return <view title={props.a === "x" ? "yes" : "no"} />
    }
  `)
  assert.match(result.wxml, /title="\{\{a === 'x' \? 'yes' : 'no'\}\}"/)
  assert.doesNotMatch(result.js, /ctx\.bind/)
})

test('passes an apostrophe in a static attribute through', () => {
  const result = compileComponent(`
    export default function Page() {
      return <view title="it's ok" />
    }
  `)
  assert.equal(result.wxml, `<view title="it's ok" />`)
})

test('passes backslashes in a static attribute through', () => {
  const result = compileComponent(`
    export default function Page() {
      return <view title={"a\\\\b"} />
    }
  `)
  assert.match(result.wxml, /title="a\\b"/)
})

test('compiles a template literal attribute outside a loop', () => {
  const result = compileComponent(`
    export default function Page(props) {
      return <view class={\`btn \${props.name}\`} />
    }
  `)
  assert.match(result.wxml, /class="\{\{b0\}\}"/)
  assert.ok(result.js.includes('`btn ${props.name}`'))
})

test('compiles a regex literal in an attribute expression', () => {
  const result = compileComponent(`
    export default function Page(props) {
      return <view title={props.name.replace(/a"b/g, '')} />
    }
  `)
  assert.match(result.wxml, /title="\{\{b0\}\}"/)
  assert.ok(result.js.includes('/a"b/g'))
})

test('binds optional chaining in a text child', () => {
  const result = compileComponent(`
    export default function Page(props) {
      return <text>{props.user?.name}</text>
    }
  `)
  assert.equal(result.wxml, '<text>{{b0}}</text>')
  assert.ok(result.js.includes('props.user?.name'))
})

test('wraps nullish coalescing text through textValue', () => {
  const result = compileComponent(`
    export default function Page(props) {
      return <text>{props.name ?? 'anon'}</text>
    }
  `)
  assert.ok(result.js.includes("ctx.bind(0, () => (textValue(props.name ?? 'anon')))"))
  assert.match(result.js, /import \{ defineGlazeComponent, textValue \}/)
})

test('emits true for a boolean shorthand attribute', () => {
  const result = compileComponent(`
    export default function Page() {
      return <view hidden />
    }
  `)
  assert.equal(result.wxml, '<view hidden="{{b0}}" />')
  assert.ok(result.js.includes('ctx.bind(0, () => (true))'))
})

test('inlines a numeric zero attribute instead of binding it', () => {
  const result = compileComponent(`
    export default function Page() {
      return <view data-count={0} />
    }
  `)
  assert.equal(result.wxml, '<view data-count="0" />')
  assert.equal(result.bindingCount, 0)
})

test('maps the className prop to class', () => {
  const result = compileComponent(`
    export default function Page() {
      return <view className="a b" />
    }
  `)
  assert.equal(result.wxml, '<view class="a b" />')
})

test('kebab-cases camelCase native attributes', () => {
  const result = compileComponent(`
    export default function Page() {
      return <view hoverClass="tapped" pointerEvents="none" />
    }
  `)
  assert.equal(result.wxml, '<view hover-class="tapped" pointer-events="none" />')
})

test('supports an extended native scroll event', () => {
  const result = compileComponent(`
    export default function Page() {
      return <scroll-view onScrollToLower={() => loadMore()} />
    }
  `)
  assert.equal(result.wxml, '<scroll-view bindscrolltolower="e0" />')
  assert.equal(result.handlerCount, 1)
})

test('keeps class object key order at the top level', () => {
  const result = compileComponent(`
    export default function Page(props) {
      return <view class={{ beta: props.b, alpha: props.a, gamma: true, delta: false }} />
    }
  `)
  assert.match(result.wxml, /class="\{\{b0\}\}"/)
  assert.match(
    result.js,
    /className\(\{\s*beta: props\.b,\s*alpha: props\.a,\s*gamma: true,\s*delta: false\s*\}\)/,
  )
})

test('emits empty expressions for false and null class array entries in a loop', () => {
  const result = compileComponent(`
    export default function Page() {
      return (
        <For each={[1]}>
          {(x) => <view class={['btn', false, null, x > 0 && 'on']} />}
        </For>
      )
    }
  `)
  assert.ok(result.wxml.includes(`class="btn {{false || ''}} {{null || ''}} {{x > 0 ? 'on' : ''}}"`))
})

test('inlines numeric class array entries in a loop', () => {
  const result = compileComponent(`
    export default function Page() {
      return <For each={[1]}>{() => <view class={['a', 1]} />}</For>
    }
  `)
  assert.ok(result.wxml.includes('class="a 1"'))
})

test('drops false and null keys from a loop class object', () => {
  const result = compileComponent(`
    export default function Page() {
      return (
        <For each={[1]}>
          {(x) => <view class={{ active: x > 0, off: false, nil: null }} />}
        </For>
      )
    }
  `)
  assert.ok(result.wxml.includes(`{{x > 0 ? 'active' : ''}}`))
  assert.doesNotMatch(result.wxml, /off|nil/)
})

test('emits a static CSS custom property', () => {
  const result = compileComponent(`
    export default function Page() {
      return <view style={{ '--main-color': 'red' }} />
    }
  `)
  assert.equal(result.wxml, '<view style="--main-color: red" />')
})

test('emits a dynamic CSS custom property in a loop', () => {
  const result = compileComponent(`
    export default function Page() {
      return (
        <For each={[1]}>
          {(x) => <view style={{ '--main-color': x > 0 ? 'red' : 'blue' }} />}
        </For>
      )
    }
  `)
  assert.ok(result.wxml.includes(`--main-color:{{x > 0 ? 'red' : 'blue'}}`))
})

test('kebab-cases loop style keys and inlines numbers', () => {
  const result = compileComponent(`
    export default function Page() {
      return (
        <For each={[1]}>
          {(x) => <view style={{ marginTop: 4, opacity: x ? 1 : 0 }} />}
        </For>
      )
    }
  `)
  assert.ok(result.wxml.includes('style="margin-top:4;opacity:{{x ? 1 : 0}}"'))
})

test('filters boolean and null loop style values', () => {
  const result = compileComponent(`
    export default function Page() {
      return (
        <For each={[1]}>
          {() => <view style={{ color: true, width: false, height: null }} />}
        </For>
      )
    }
  `)
  assert.ok(result.wxml.includes('style="color:true"'))
  assert.doesNotMatch(result.wxml, /width|height/)
})

test('falls back to styleName when a style value is null', () => {
  const result = compileComponent(`
    export default function Page() {
      return <view style={{ color: null, width: 0 }} />
    }
  `)
  assert.match(result.wxml, /style="\{\{b0\}\}"/)
  assert.match(result.js, /styleName\(\{\s*color: null,\s*width: 0\s*\}\)/)
})

test('inlines a literal *this loop key', () => {
  const result = compileComponent(`
    export default function Page(props) {
      return <For each={props.items} key="*this">{(item) => <text>{item}</text>}</For>
    }
  `)
  assert.match(result.wxml, /wx:key="\*this"/)
  assert.ok(result.js.includes('listBindings: {}'))
})

test('destructures an array loop item into indexed access', () => {
  const result = compileComponent(`
    export default function Page(props) {
      return (
        <For each={props.items} key="id">
          {([first, second]) => <text>{first}-{second}</text>}
        </For>
      )
    }
  `)
  assert.ok(result.wxml.includes('{{__glazeItem[0]}}-{{__glazeItem[1]}}'))
  assert.ok(result.js.includes('listBindings: {}'))
})

test('destructures nested loop fields with a rename', () => {
  const result = compileComponent(`
    export default function Page(props) {
      return (
        <For each={props.items} key="id">
          {({ user: { name: label } }) => <text>{label}</text>}
        </For>
      )
    }
  `)
  assert.ok(result.wxml.includes('{{__glazeItem.user.name}}'))
})

test('keeps an explicit loop index parameter in the template', () => {
  const result = compileComponent(`
    export default function Page(props) {
      return (
        <For each={props.items}>
          {(item, index) => <text>{index}:{item.name}</text>}
        </For>
      )
    }
  `)
  assert.ok(result.wxml.includes('wx:for-index="index"'))
  assert.ok(result.wxml.includes('{{index}}:{{item.name}}'))
})

test('compiles Switch inside For without allocating loop bindings', () => {
  const result = compileComponent(`
    export default function Page(props) {
      return (
        <For each={props.items}>
          {(item) => (
            <Switch fallback={<text>?</text>}>
              <Match when={item.done}><text>done</text></Match>
            </Switch>
          )}
        </For>
      )
    }
  `)
  assert.ok(result.wxml.includes('<text wx:if="{{item.done}}">done</text><text wx:else>?</text>'))
  assert.equal(result.bindingCount, 0)
})

test('infers a loop key from a block-bodied keyed function', () => {
  const result = compileComponent(`
    export default function Page(props) {
      return (
        <For each={props.items} keyed={(item) => { return item.id }}>
          {(item) => <text>{item().name}</text>}
        </For>
      )
    }
  `)
  assert.match(result.wxml, /wx:key="id"/)
  assert.ok(result.wxml.includes('{{item.name}}'))
})

test('applies a negative Repeat start offset', () => {
  const result = compileComponent(`
    export default function Page() {
      return <Repeat count={3} from={-1}>{(i) => <text>{i}</text>}</Repeat>
    }
  `)
  assert.ok(result.js.includes('index + (-1)'))
})

test('uses the WXS range helper for Repeat inside For', () => {
  const result = compileComponent(`
    export default function Page(props) {
      return (
        <For each={props.a}>
          {(row) => <Repeat count={row.n}>{(i) => <text>{i}</text>}</Repeat>}
        </For>
      )
    }
  `)
  assert.ok(result.wxml.includes('<wxs module="glazeRange">'))
  assert.ok(result.wxml.includes('glazeRange.range(row.n, 0)'))
  assert.ok(result.wxml.includes('wx:for-item="__glazeRepeat1"'))
  assert.ok(result.wxml.includes('wx:for-index="__glazeIndex1"'))
})

test('keeps distinct explicit item and index names in nested loops', () => {
  const result = compileComponent(`
    export default function Page(props) {
      return (
        <For each={props.rows}>
          {(row, ri) => (
            <For each={row.cells}>
              {(cell, ci) => <text>{ri}:{ci}:{cell}</text>}
            </For>
          )}
        </For>
      )
    }
  `)
  assert.ok(result.wxml.includes('wx:for-item="row" wx:for-index="ri"'))
  assert.ok(result.wxml.includes('wx:for-item="cell" wx:for-index="ci"'))
  assert.ok(result.wxml.includes('{{ri}}:{{ci}}:{{cell}}'))
})

test('guards an empty literal For list with its length', () => {
  const result = compileComponent(`
    export default function Page() {
      return <For each={[]} fallback={<text>none</text>}>{(x) => <text>{x}</text>}</For>
    }
  `)
  assert.ok(result.wxml.includes('<block wx:if="{{b1}}">'))
  assert.ok(result.wxml.includes('<text wx:else>none</text>'))
  assert.ok(result.js.includes('ctx.bind(1, () => (([] || []).length > 0))'))
})

test('rejects a multi-field For key', () => {
  assert.throws(
    () =>
      compileComponent(`
        export default function Page(props) {
          return <For each={props.a} key="a.b">{(x) => <text>{x}</text>}</For>
        }
      `),
    /is not a single field key/,
  )
})

test('rejects a keyed function that returns an expression', () => {
  assert.throws(
    () =>
      compileComponent(`
        export default function Page(props) {
          return <For each={props.a} keyed={(item) => item.id + 1}>{(x) => <text>x</text>}</For>
        }
      `),
    /keyed function must return a single field/,
  )
})

test('rejects For without an each expression', () => {
  assert.throws(
    () =>
      compileComponent(`
        export default function Page() {
          return <For>{(item) => <text>x</text>}</For>
        }
      `),
    /<For> requires an each expression/,
  )
})

test('rejects nested For reusing the item name', () => {
  assert.throws(
    () =>
      compileComponent(`
        export default function Page(props) {
          return (
            <For each={props.a}>
              {(item) => <For each={props.b}>{(item) => <text>x</text>}</For>}
            </For>
          )
        }
      `),
    /must use distinct item and index names/,
  )
})

test('rejects rest elements in a destructured loop item', () => {
  assert.throws(
    () =>
      compileComponent(`
        export default function Page(props) {
          return (
            <For each={props.a} key="id">
              {({ a, ...rest }) => <text>{a}</text>}
            </For>
          )
        }
      `),
    /Rest elements in destructured/,
  )
})

test('rejects a let declaration inside a For callback', () => {
  assert.throws(
    () =>
      compileComponent(`
        export default function Page(props) {
          return (
            <For each={props.a}>
              {(item) => {
                let x = 1
                return <text>{x}</text>
              }}
            </For>
          )
        }
      `),
    /local variables must use const/,
  )
})

test('rejects a method call that depends on a loop item', () => {
  assert.throws(
    () =>
      compileComponent(`
        export default function Page(props) {
          return <For each={props.a}>{(item) => <text>{item.name.toUpperCase()}</text>}</For>
        }
      `),
    /must not depend on loop values/,
  )
})

test('rejects a template literal inside a loop attribute', () => {
  assert.throws(
    () =>
      compileComponent(`
        export default function Page(props) {
          return <For each={props.a}>{(item) => <view title={\`x\${item.id}\`} />}</For>
        }
      `),
    /Template literals inside/,
  )
})

test('binds a string literal Show condition', () => {
  const result = compileComponent(`
    export default function Page() {
      return <Show when="hello"><text>x</text></Show>
    }
  `)
  assert.match(result.wxml, /wx:if="\{\{b0\}\}"/)
  assert.ok(result.js.includes('ctx.bind(0, () => ("hello"))'))
})

test('wraps multiple Show children and keeps the fallback', () => {
  const result = compileComponent(`
    export default function Page(props) {
      return (
        <Show when={props.a} fallback={<text>no</text>}>
          <text>a</text>
          <text>b</text>
        </Show>
      )
    }
  `)
  assert.ok(result.wxml.includes('<block wx:if="{{a}}"><text>a</text><text>b</text></block><text wx:else>no</text>'))
})

test('guards the Show body binding against a falsy condition', () => {
  const result = compileComponent(`
    export default function Page(props) {
      return <Show when={props.a}><text>{props.b}</text></Show>
    }
  `)
  assert.ok(result.wxml.includes('<text wx:if="{{a}}">{{b}}</text>'))
  assert.doesNotMatch(result.js, /ctx\.bind/)
})

test('guards the Show fallback binding against a truthy condition', () => {
  const result = compileComponent(`
    export default function Page(props) {
      return <Show when={props.a} fallback={<text>{props.fallback}</text>}><text>x</text></Show>
    }
  `)
  assert.ok(result.wxml.includes('<text wx:if="{{a}}">x</text><text wx:else>{{fallback}}</text>'))
  assert.doesNotMatch(result.js, /ctx\.bind/)
})

test('renders a non-keyed Show function child with a fallback', () => {
  const result = compileComponent(`
    export default function Page(props) {
      return (
        <Show when={props.user} fallback={<text>no</text>}>
          {(user) => <text>{user().name}</text>}
        </Show>
      )
    }
  `)
  assert.ok(result.wxml.includes('<block wx:if="{{b0}}"><text>{{b0.name}}</text></block><text wx:else>no</text>'))
})

test('compiles For nested inside Show', () => {
  const result = compileComponent(`
    export default function Page(props) {
      return (
        <Show when={props.open}>
          <For each={props.items}>{(x) => <text>{x}</text>}</For>
        </Show>
      )
    }
  `)
  assert.ok(result.wxml.includes('<block wx:if="{{open}}"><block wx:for="{{items}}"'))
  assert.doesNotMatch(result.js, /ctx\.bind/)
})

test('compiles Show nested inside For', () => {
  const result = compileComponent(`
    export default function Page(props) {
      return (
        <For each={props.rows}>
          {(row) => <Show when={row.on}><text>{row.title}</text></Show>}
        </For>
      )
    }
  `)
  assert.ok(result.wxml.includes('<text wx:if="{{row.on}}">{{row.title}}</text>'))
})

test('adds negated earlier Match guards to later bindings', () => {
  const result = compileComponent(`
    export default function Page(props) {
      return (
        <Switch fallback={<text>f</text>}>
          <Match when={props.a}><text>{props.x}</text></Match>
          <Match when={props.b}><text>{props.y}</text></Match>
        </Switch>
      )
    }
  `)
  assert.match(result.wxml, /wx:if="\{\{a\}\}"/)
  assert.match(result.wxml, /wx:elif="\{\{b\}\}"/)
  assert.doesNotMatch(result.js, /ctx\.bind/)
})

test('renders a non-keyed Match function child', () => {
  const result = compileComponent(`
    export default function Page(props) {
      return (
        <Switch>
          <Match when={props.user}>{(u) => <text>{u().name}</text>}</Match>
        </Switch>
      )
    }
  `)
  assert.ok(result.wxml.includes('<block wx:if="{{b0}}"><text>{{b0.name}}</text></block>'))
})

test('treats an imported Show as a component reference', () => {
  const result = compileComponent(`
    import Show from './Show'
    export default function Page() {
      return <Show />
    }
  `)
  assert.equal(result.wxml, '<show />')
  assert.deepEqual(result.components, [{ name: 'Show', source: './Show' }])
})

test('treats a locally declared Show as a component reference', () => {
  assert.throws(
    () =>
      compileComponent(`
        export default function Page() {
          function Show() {
            return <text>x</text>
          }
          return <Show />
        }
      `),
    /Component <Show> must be imported/,
  )
})

test('rejects Match without a when expression', () => {
  assert.throws(
    () =>
      compileComponent(`
        export default function Page() {
          return <Switch><Match><text>x</text></Match></Switch>
        }
      `),
    /<Match> requires a when expression/,
  )
})

test('rejects a non-Match child in Switch', () => {
  assert.throws(
    () =>
      compileComponent(`
        export default function Page() {
          return <Switch><text>x</text></Switch>
        }
      `),
    /accepts only <Match> children/,
  )
})

test('rejects Show without a child', () => {
  assert.throws(
    () =>
      compileComponent(`
        export default function Page(props) {
          return <Show when={props.a}></Show>
        }
      `),
    /<Show> requires a child/,
  )
})

test('kebab-cases a PascalCase component tag', () => {
  const result = compileComponent(`
    import TodoItem from './TodoItem'
    export default function Page() {
      return <TodoItem />
    }
  `)
  assert.equal(result.wxml, '<todo-item />')
  assert.deepEqual(result.components, [{ name: 'TodoItem', source: './TodoItem' }])
})

test('deduplicates repeated component references', () => {
  const result = compileComponent(`
    import Child from './Child'
    export default function Page() {
      return <view><Child /><Child /></view>
    }
  `)
  assert.equal(result.wxml, '<view><child /><child /></view>')
  assert.equal(result.components.length, 1)
})

test('expands a static spread into component props', () => {
  const result = compileComponent(`
    import Child from './Child'
    export default function Page() {
      return <Child {...{ title: 'x', count: 2 }} />
    }
  `)
  assert.equal(result.wxml, '<child title="x" count="{{2}}" />')
})

test('passes static data-* and aria-* through to a component host', () => {
  const result = compileComponent(`
    import Child from './Child'
    export default function Page() {
      return <Child data-id="x" aria-label="y" />
    }
  `)
  assert.equal(result.wxml, '<child data-id="x" aria-label="y" />')
  assert.deepEqual(result.props, [])
})

test('binds dynamic data-* attributes on a component', () => {
  const result = compileComponent(`
    import Child from './Child'
    export default function Page(props) {
      return <Child data-id={props.id} aria-label={props.label} />
    }
  `)
  assert.ok(result.wxml.includes('data-id="{{id}}" aria-label="{{label}}"'))
  assert.deepEqual(result.props, ['id', 'label'])
})

test('binds dynamic data-* attributes on a component inside For', () => {
  const result = compileComponent(`
    import Child from './Child'
    export default function Page(props) {
      return (
        <For each={props.items}>
          {(item) => <Child data-id={item.id} aria-label={item.label} />}
        </For>
      )
    }
  `)
  assert.ok(result.wxml.includes('<child data-id="{{item.id}}" aria-label="{{item.label}}" />'))
  assert.equal(result.bindingCount, 0)
})

test('emits a boolean shorthand prop on a component', () => {
  const result = compileComponent(`
    import Child from './Child'
    export default function Page() {
      return <Child disabled />
    }
  `)
  assert.equal(result.wxml, '<child disabled="{{b0}}" />')
  assert.ok(result.js.includes('ctx.bind(0, () => (true))'))
})

test('compiles a class array on a component through className', () => {
  const result = compileComponent(`
    import Child from './Child'
    export default function Page(props) {
      return <Child class={['a', props.b && 'b']} />
    }
  `)
  assert.match(result.wxml, /class="\{\{b0\}\}"/)
  assert.ok(result.js.includes("className(['a', props.b && 'b'])"))
})

test('emits bind and catch suffixes for component events', () => {
  const result = compileComponent(`
    import Child from './Child'
    export default function Page() {
      return <Child onPick={() => pick()} onPickCatch={() => pick()} />
    }
  `)
  assert.equal(result.wxml, '<child bind:pick="e0" catch:pick="e1" />')
  assert.equal(result.handlerCount, 2)
  assert.ok(result.js.includes('(__glazeEvent.detail)'))
})

test('records named slots and the default slot', () => {
  const result = compileComponent(`
    export default function Card() {
      return <view><slot name="header" /><slot name="footer" /><slot /></view>
    }
  `)
  assert.equal(result.wxml, '<view><slot name="header" /><slot name="footer" /><slot /></view>')
  assert.deepEqual(result.namedSlots, ['header', 'footer'])
  assert.equal(result.usesSlot, true)
})

test('turns a root props.children read into a slot', () => {
  const result = compileComponent(`
    export default function Card(props) {
      return <view>{props.children}</view>
    }
  `)
  assert.equal(result.wxml, '<view><slot /></view>')
  assert.equal(result.usesSlot, true)
  assert.deepEqual(result.props, ['children'])
})

test('removes a component-only relative import from emitted JS', () => {
  const result = compileComponent(`
    import Child from './Child'
    export default function Page() {
      return <view><Child /></view>
    }
  `)
  assert.doesNotMatch(result.js, /from ['"]\.\/Child['"]/)
  assert.ok(result.js.includes('from "@glaze/runtime/mini"'))
  assert.equal(result.components.length, 1)
})

test('rejects a component name that kebab-cases onto a built-in tag', () => {
  assert.throws(
    () =>
      compileComponent(`
        import Text from './Text'
        export default function Page() {
          return <Text>x</Text>
        }
      `),
    /conflicts with the built-in WXML <text> tag/,
  )
})

test('rejects a component event name that collides with a native event', () => {
  assert.throws(
    () =>
      compileComponent(`
        import Child from './Child'
        export default function Page() {
          return <Child onScroll={() => {}} />
        }
      `),
    /collides with the native "scroll" event/,
  )
})

test('rejects a children prop on a component', () => {
  assert.throws(
    () =>
      compileComponent(`
        import Child from './Child'
        export default function Page() {
          return <Child children={<text>x</text>} />
        }
      `),
    /Pass children to <Child> as JSX children/,
  )
})

test('keeps an unrelated module import in the generated module', () => {
  const result = compileComponent(`
    import { debounce } from 'lodash'
    export default function Page(props) {
      return <text>{debounce(props.x)}</text>
    }
  `)
  assert.match(result.js, /from ['"]lodash['"]/)
  assert.ok(result.js.includes('debounce(props.x)'))
})

test('orders helper imports after the component helper', () => {
  const result = compileComponent(`
    export default function Page(props) {
      return (
        <view>
          <text>{props.a && 'x'}</text>
          <view class={{ a: props.b }} style={{ color: props.c }} />
        </view>
      )
    }
  `)
  assert.ok(
    result.js.includes('import { defineGlazeComponent, className, styleName } from "@glaze/runtime/mini";'),
  )
})

test('sizes the data object to the binding count', () => {
  const result = compileComponent(`
    export default function Page(props) {
      return <view a={props.a} b={props.b} c={props.c} />
    }
  `)
  const match = result.js.match(/data: (\{[^}]*\}),/)
  assert.ok(match)
  const data = JSON.parse(match[1])
  assert.equal(result.bindingCount, 0)
  assert.equal(Object.keys(data).length, 0)
})

test('emits listBindings only for keyed loops', () => {
  const keyed = compileComponent(`
    export default function Page(props) {
      return <For each={props.items} key="id">{(item) => <text>{item.name}</text>}</For>
    }
  `)
  assert.ok(keyed.js.includes('listBindings: {}'))

  const unkeyed = compileComponent(`
    export default function Page(props) {
      return <For each={props.items} keyed={false}>{(item) => <text>{item.name}</text>}</For>
    }
  `)
  assert.ok(unkeyed.js.includes('listBindings: {}'))
  assert.doesNotMatch(unkeyed.wxml, /wx:key=/)
})

test('omits eventProps when the component takes no event props', () => {
  const result = compileComponent(`
    export default function Page(props) {
      return <text>{props.title}</text>
    }
  `)
  assert.doesNotMatch(result.js, /eventProps/)
})

test('rejects computed prop access', () => {
  assert.throws(
    () =>
      compileComponent(`
        export default function Page(props) {
          return <text>{props[props.key]}</text>
        }
      `),
    /Computed prop access is not supported/,
  )
})

test('rejects a computed key in a static spread', () => {
  assert.throws(
    () =>
      compileComponent(`
        export default function Page(props) {
          return <view {...{ [props.key]: 1 }} />
        }
      `),
    /JSX spread object must use static keys/,
  )
})

test('rejects a JSX value in a component prop', () => {
  assert.throws(
    () =>
      compileComponent(`
        import Child from './Child'
        export default function Page() {
          return <Child title={<text>x</text>} />
        }
      `),
    /JSX values are not supported/,
  )
})

test('rejects a JSX event handler', () => {
  assert.throws(
    () =>
      compileComponent(`
        export default function Page() {
          return <view onClick={<text>x</text>} />
        }
      `),
    /cannot be JSX/,
  )
})

test('rejects a component with two parameters', () => {
  assert.throws(
    () =>
      compileComponent(`
        export default function Page(a, b) {
          return <text>x</text>
        }
      `),
    /at most one props parameter/,
  )
})

test('rejects a module without a default component export', () => {
  assert.throws(
    () =>
      compileComponent(`
        export function Page() {
          return <text>x</text>
        }
      `),
    /No default-exported component function/,
  )
})

test('rejects an unimported PascalCase element', () => {
  assert.throws(
    () =>
      compileComponent(`
        export default function Page() {
          return <Portal>x</Portal>
        }
      `),
    /must be imported from a relative file/,
  )
})

test('rejects a Solid API component imported from solid-js', () => {
  assert.throws(
    () =>
      compileComponent(`
        import { Portal } from 'solid-js'
        export default function Page() {
          return <Portal>x</Portal>
        }
      `),
    /must come from a relative file/,
  )
})

test('expands a static spread mixing a class object and static style', () => {
  const result = compileComponent(`
    export default function Page() {
      return <view {...{ class: { active: true }, style: { backgroundColor: 'red', width: 0 } }}>x</view>
    }
  `)
  assert.ok(result.wxml.includes('<view class="{{b0}}" style="background-color: red; width: 0">x</view>'))
  assert.match(result.js, /className\(\{\s*active: true\s*\}\)/)
})

test('records an imported default context with a #default key', () => {
  const result = compileComponent(
    `
      import Theme from './theme'
      import { useContext } from 'solid-js'
      export default function Child() {
        const theme = useContext(Theme)
        return <text>{theme}</text>
      }
    `,
    { sourceFile: '/app/Page.tsx' },
  )
  assert.deepEqual(result.boundaryContexts, [{ name: 'Theme', key: '/app/theme#default' }])
  assert.ok(result.props.includes('glazecontext'))
  assert.ok(result.js.includes('withBoundaryContexts('))
})

test('wraps nested local providers around their own bindings', () => {
  const result = compileComponent(`
    export default function Page() {
      const A = createContext('a')
      const B = createContext('b')
      return (
        <A value="x">
          <B value="y"><text>{useContext(A)}{useContext(B)}</text></B>
        </A>
      )
    }
  `)
  assert.equal((result.js.match(/withProvider\(/g) ?? []).length, 2)
  assert.deepEqual(result.boundaryContexts, [])
})

test('allocates distinct ids for multiple refs', () => {
  const result = compileComponent(`
    export default function Page() {
      return (
        <view>
          <text ref={(node) => first(node)}>a</text>
          <text ref={(node) => second(node)}>b</text>
        </view>
      )
    }
  `)
  assert.ok(result.wxml.includes('id="glaze-r0"'))
  assert.ok(result.wxml.includes('id="glaze-r1"'))
  assert.equal(result.refCount, 2)
  assert.ok(result.js.includes('ctx.ref(0, node => first(node));'))
  assert.ok(result.js.includes('ctx.ref(1, node => second(node));'))
})

test('rejects a dynamic spread on a component', () => {
  assert.throws(
    () =>
      compileComponent(`
        import Child from './Child'
        export default function Page(props) {
          return <Child {...props} />
        }
      `),
    /Only object literals can be spread/,
  )
})

test('rejects props.style across a component boundary', () => {
  assert.throws(
    () =>
      compileComponent(`
        export default function Page(props) {
          return <view style={props.style} />
        }
      `),
    /props\.style is not delivered/,
  )
})

test('rejects props.class across a component boundary', () => {
  assert.throws(
    () =>
      compileComponent(`
        export default function Page(props) {
          return <view class={props.class} />
        }
      `),
    /props\.class is not delivered/,
  )
})

test('projects prop-only expressions into WXML without bindings', () => {
  const result = compileComponent(`
    export default function Page(props) {
      return (
        <view title={props.name} data-id={props.id}>
          <text>{props.name}</text>
          <text>{props.user.name}</text>
          <view a={props.a === 'x' ? 'yes' : 'no'} />
        </view>
      )
    }
  `)
  assert.equal(result.bindingCount, 0)
  assert.equal(result.js.includes('ctx.bind'), false)
  assert.match(result.wxml, /title="\{\{name\}\}"/)
  assert.match(result.wxml, /data-id="\{\{id\}\}"/)
  assert.match(result.wxml, /<text>\{\{name\}\}<\//)
  assert.match(result.wxml, /<text>\{\{user\.name\}\}<\//)
  assert.match(result.wxml, /a="\{\{a === 'x' \? 'yes' : 'no'\}\}"/)
})

test('keeps mixed prop and local-state expressions on the binding path', () => {
  const result = compileComponent(`
    import { createSignal } from 'solid-js'
    export default function Page(props) {
      const [count] = createSignal(0)
      return <text>{props.name + count()}</text>
    }
  `)
  assert.equal(result.bindingCount, 1)
  assert.match(result.wxml, /<text>\{\{b0\}\}<\//)
  assert.ok(result.js.includes('props.name + count()'))
})

test('falls back to a binding when a prop name is shadowed locally', () => {
  const result = compileComponent(`
    export default function Page(props) {
      const title = 'local'
      return <text>{props.title}</text>
    }
  `)
  assert.equal(result.bindingCount, 1)
  assert.match(result.wxml, /<text>\{\{b0\}\}<\//)
})

test('projects a prop-only For source and Show condition', () => {
  const result = compileComponent(`
    export default function Page(props) {
      return (
        <Show when={props.open}>
          <For each={props.items} key="id">{(item) => <text>{item.name}</text>}</For>
        </Show>
      )
    }
  `)
  assert.equal(result.bindingCount, 0)
  assert.ok(result.wxml.includes('wx:if="{{open}}"'))
  assert.ok(result.wxml.includes('wx:for="{{items}}"'))
  assert.ok(result.js.includes('listBindings: {}'))
})

test('keeps optional prop expressions on the binding path', () => {
  const result = compileComponent(`
    export default function Page(props) {
      return <text>{props.user?.name}</text>
    }
  `)
  assert.equal(result.bindingCount, 1)
})

test('projects boolean prop expressions through the WXS value helper', () => {
  const result = compileComponent(`
    export default function Page(props) {
      return <text>{props.done && 'done'}</text>
    }
  `)
  assert.equal(result.bindingCount, 0)
  assert.ok(result.wxml.includes("glazeValue.value(done && 'done')"))
})

test('emits propSignals only for props read by generated JavaScript', () => {
  const direct = compileComponent(`
    export default function Page(props) {
      return <view title={props.title}><text>{props.title}</text></view>
    }
  `)
  assert.match(direct.js, /propSignals: \[\]/)

  const mixed = compileComponent(`
    export default function Page(props) {
      return <view title={props.title}><text>{props.name + String(Date.now())}</text></view>
    }
  `)
  assert.match(mixed.js, /propSignals: \["name"\]/)
})

test('tracks props read by inline child prop getters', () => {
  const result = compileComponent(
    `
      import Child from './Child'
      export default function Parent(props) {
        return <view title={props.other}><Child label={props.title} /></view>
      }
    `,
    {
      inline: true,
      resolveComponent: () => `
        export default function Child(props) {
          return <text>{props.label}</text>
        }
      `,
    },
  )
  assert.match(result.js, /propSignals: \["title"\]/)
})

test('tracks props read by a context provider value', () => {
  const result = compileComponent(`
    import { createContext } from 'solid-js'
    const Theme = createContext('light')
    export default function Page(props) {
      return (
        <view title={props.other}>
          <Theme.Provider value={props.value}><text>x</text></Theme.Provider>
        </view>
      )
    }
  `)
  assert.match(result.js, /propSignals: \["value"\]/)
})

test('does not project an inline child prop onto a same-named parent prop', () => {
  const result = compileComponent(
    `
      import Child from './Child'
      export default function Parent(props) {
        return <view title={props.title}><Child title={props.other} /></view>
      }
    `,
    {
      inline: true,
      resolveComponent: () => `
        export default function Child(props) {
          return <text>{props.title}</text>
        }
      `,
    },
  )
  assert.match(result.wxml, /title="\{\{title\}\}"/)
  assert.doesNotMatch(result.wxml, /<text>\{\{title\}\}<\/text>/)
  assert.match(result.wxml, /<text>\{\{b\d+\}\}<\/text>/)
})

test('rejects direct writes to props', () => {
  const cases = [
    `export default function Page(props) { props.count = 1; return <view /> }`,
    `export default function Page(props) { props.count += 1; return <view /> }`,
    `export default function Page(props) { props.count++; return <view /> }`,
    `export default function Page(props) { delete props.count; return <view /> }`,
    `export default function Page(props) { return <button onClick={() => { props['count'] = 1 }} /> }`,
  ]
  for (const source of cases) {
    assert.throws(() => compileComponent(source), /read-only|Computed prop access/)
  }
})

test('allows mutating a nested object held by a prop', () => {
  const result = compileComponent(`
    export default function Page(props) {
      return <button onClick={() => { props.user.name = 'Grace' }} />
    }
  `)
  assert.ok(result.js.includes("props.user.name = 'Grace'"))
})

test('does not reject a module helper that mutates its own props parameter', () => {
  const result = compileComponent(`
    function helper(props) { props.value = 1 }
    export default function Page() {
      return <view>{helper.toString()}</view>
    }
  `)
  assert.ok(result.js.includes('helper.toString()'))
})
