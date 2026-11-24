import assert from 'node:assert/strict'
import test from 'node:test'
import { compileComponent, hasMultipleProps, isGroupableProp } from '../src/index.ts'

const child = `
  import { createSignal } from 'solid-js'
  export default function Child(props) {
    const [ready] = createSignal(true)
    return <view><text>{props.title}</text><text>{props.done}</text><text>{ready() ? 'yes' : 'no'}</text></view>
  }
`

const structuredChild = (options = {}) =>
  compileComponent(child, { sourceFile: '/project/src/Child.tsx', structuredProps: true, ...options })

test('projects a structured prop through the compact property with a scalar fallback', () => {
  const result = structuredChild()
  assert.match(
    result.wxml,
    /glazeprops && glazeprops\.title !== undefined \? glazeprops\.title : title/,
  )
  assert.match(result.wxml, /glazeprops && glazeprops\.done !== undefined \? glazeprops\.done : done/)
  assert.equal(result.structuredProps, true)
  assert.match(result.js, /structuredProps: true/)
  // WXML reads only; no JS binding or prop signal is needed for these props.
  assert.deepEqual(result.propSignals, [])
})

test('lowers common scalar props into one structured property', () => {
  const result = compileComponent(
    `
      import Child from './Child'
      export default function Page(props) {
        return <Child title={props.title} done={props.done} count={1} label="row" />
      }
    `,
    {
      sourceFile: '/project/src/Page.tsx',
      resolveComponent: () => ({
        source: child,
        file: '/project/src/Child.tsx',
        structuredProps: true,
      }),
    },
  )
  assert.match(
    result.wxml,
    /glazeprops="\{\{(?: )?\{title: title, done: done, count: 1, label: 'row'\}(?: )?\}\}"/,
  )
  assert.doesNotMatch(result.wxml, /\btitle="/)
  assert.doesNotMatch(result.wxml, /\bdone="/)
  assert.doesNotMatch(result.wxml, /\bcount="/)
  assert.doesNotMatch(result.wxml, /\blabel="/)
})

test('keeps a legacy component interface when the child is not structured', () => {
  const result = compileComponent(
    `
      import Child from './Child'
      export default function Page(props) {
        return <Child title={props.title} done={props.done} />
      }
    `,
    {
      sourceFile: '/project/src/Page.tsx',
      resolveComponent: () => ({ source: child, file: '/project/src/Child.tsx' }),
    },
  )
  assert.doesNotMatch(result.wxml, /glazeprops/)
  assert.match(result.wxml, /\btitle="{{title}}"/)
  assert.match(result.wxml, /\bdone="{{done}}"/)
})

test('leaves a single scalar prop in its native form', () => {
  const result = compileComponent(
    `
      import Child from './Child'
      export default function Page(props) {
        return <Child title={props.title} />
      }
    `,
    {
      sourceFile: '/project/src/Page.tsx',
      resolveComponent: () => ({
        source: child,
        file: '/project/src/Child.tsx',
        structuredProps: true,
      }),
    },
  )
  assert.doesNotMatch(result.wxml, /glazeprops/)
  assert.match(result.wxml, /\btitle="{{title}}"/)
})

test('keeps events, host attributes and context outside the structured object', () => {
  const result = compileComponent(
    `
      import Child from './Child'
      export default function Page(props) {
        return (
          <Child
            title={props.title}
            done={props.done}
            class={{ active: props.active }}
            id="card"
            data-role="row"
            onPick={() => pick(props.title)}
          />
        )
      }
    `,
    {
      sourceFile: '/project/src/Page.tsx',
      resolveComponent: () => ({
        source: child,
        file: '/project/src/Child.tsx',
        structuredProps: true,
      }),
    },
  )
  assert.match(result.wxml, /glazeprops="\{\{ \{title: title, done: done\} \}\}"/)
  assert.match(result.wxml, /class="\{\{/)
  assert.match(result.wxml, /id="card"/)
  assert.match(result.wxml, /data-role="row"/)
  assert.match(result.wxml, /bind:pick="e0"/)
})

test('falls back to the native property when the compact field is missing', () => {
  const result = compileComponent(
    `
      export default function Child(props) {
        return <view><text>{props.title}</text><text>{props.extra}</text></view>
      }
    `,
    { structuredProps: true },
  )
  assert.match(
    result.wxml,
    /glazeprops && glazeprops\.title !== undefined \? glazeprops\.title : title/,
  )
})

test('keeps nested prop access as one conditional instead of a parenthesized member', () => {
  const result = compileComponent(
    `
      export default function Child(props) {
        return <view><text>{props.user.name}</text><text>{props.other}</text></view>
      }
    `,
    { structuredProps: true },
  )
  assert.match(
    result.wxml,
    /glazeprops && glazeprops\.user !== undefined \? glazeprops\.user\.name : user\.name/,
  )
  assert.doesNotMatch(result.wxml, /\)\.name/)
})

test('does not mark a one-prop component itself as structured', () => {
  const result = compileComponent(
    `
      export default function Child(props) {
        return <view><text>{props.title}</text></view>
      }
    `,
    { structuredProps: true },
  )
  assert.equal(result.structuredProps, false)
  assert.doesNotMatch(result.wxml, /glazeprops/)
  assert.doesNotMatch(result.js, /structuredProps/)
})

test('does not count host attributes toward the structured decision', () => {
  const result = compileComponent(
    `
      export default function Child(props) {
        return <view id={props.id}><text>{props.title}</text></view>
      }
    `,
    { structuredProps: true },
  )
  assert.equal(result.structuredProps, false)
  assert.doesNotMatch(result.wxml, /glazeprops/)
})

test('counts only props that the parent can group', () => {
  assert.equal(
    hasMultipleProps(`
      export default function Child(props) {
        return <view id={props.id}><text>{props.title}</text></view>
      }
    `),
    false,
  )
  assert.equal(
    hasMultipleProps(`
      export default function Child(props) {
        return <view><text>{props.title}</text><text>{props.done}</text></view>
      }
    `),
    true,
  )
  assert.equal(
    hasMultipleProps(`
      export default function Child(props) {
        return <view>{props.children}<text>{props.title}</text></view>
      }
    `),
    false,
  )
})

test('rejects loop variables that shadow the compact property', () => {
  for (const source of [
    `
      export default function C() {
        return <For each={[]}>{(glazeprops) => <text>{glazeprops}</text>}</For>
      }
    `,
    `
      export default function C() {
        return <For each={[]}>{(item, glazeprops) => <text>{item}</text>}</For>
      }
    `,
    `
      export default function C() {
        return <Show when={true}>{(glazeprops) => <text>{glazeprops}</text>}</Show>
      }
    `,
  ]) {
    assert.throws(() => compileComponent(source), /may not use "glazeprops"/)
  }
})

test('rejects the reserved compact property name', () => {
  assert.throws(
    () =>
      compileComponent(`
        export default function Child(props) {
          return <view>{props.glazeprops}</view>
        }
      `),
    /reserved compiler property "glazeprops"/,
  )
  assert.throws(
    () =>
      compileComponent(`
        export default function Child(props) {
          return <view>{props.glazeProps}</view>
        }
      `),
    /reserved compiler property "glazeprops"/,
  )
  assert.throws(
    () =>
      compileComponent(
        `
          import Child from './Child'
          export default function Page(props) {
            return <Child glazeprops={1} title={props.title} />
          }
        `,
        {
          sourceFile: '/project/src/Page.tsx',
          resolveComponent: () => ({ source: child, file: '/project/src/Child.tsx' }),
        },
      ),
    /reserved for compiled component props/,
  )
  assert.throws(
    () =>
      compileComponent(
        `
          import Child from './Child'
          export default function Page(props) {
            return <Child glazecontext={1} title={props.title} />
          }
        `,
        {
          sourceFile: '/project/src/Page.tsx',
          resolveComponent: () => ({ source: child, file: '/project/src/Child.tsx' }),
        },
      ),
    /reserved for compiled context props/,
  )
})

test('one groupable prop plus host attributes and an event is not structured', () => {
  const source = `
    export default function Child(props) {
      return (
        <view id={props.id} onClick={props.onPick}>
          <text>{props.title}</text>
        </view>
      )
    }
  `
  assert.equal(hasMultipleProps(source), false)
  const child = compileComponent(source, { structuredProps: true })
  assert.equal(child.structuredProps, false)
  assert.doesNotMatch(child.wxml, /glazeprops/)

  const parent = compileComponent(
    `
      import Child from './Child'
      export default function Page() {
        return (
          <Child
            title="row"
            id="card"
            class={{ active: true }}
            style={{ color: 'red' }}
            onPick={() => {}}
          />
        )
      }
    `,
    {
      sourceFile: '/project/src/Page.tsx',
      resolveComponent: () => ({
        source,
        file: '/project/src/Child.tsx',
        structuredProps: true,
      }),
    },
  )
  assert.doesNotMatch(parent.wxml, /glazeprops/)
  assert.match(parent.wxml, /\btitle="row"/)
  assert.match(parent.wxml, /\bid="card"/)
})

test('two groupable props mark the component structured', () => {
  const source = `
    export default function Child(props) {
      return <view><text>{props.title}</text><text>{props.done}</text></view>
    }
  `
  assert.equal(hasMultipleProps(source), true)
  assert.equal(compileComponent(source, { structuredProps: true }).structuredProps, true)
})

test('zero groupable props never mark a component structured', () => {
  const source = `
    export default function Child(props) {
      return <view id={props.id}>{props.children}</view>
    }
  `
  assert.equal(hasMultipleProps(source), false)
  const result = compileComponent(source, { structuredProps: true })
  assert.equal(result.structuredProps, false)
  assert.doesNotMatch(result.wxml, /glazeprops/)
})

test('the marker and parent grouping share one groupable predicate', () => {
  for (const name of [
    'class',
    'style',
    'id',
    'slot',
    'key',
    'children',
    'onPick',
    'constructor',
    '__proto__',
    'toString',
  ]) {
    assert.equal(isGroupableProp(name), false, `${name} must not be groupable`)
  }
  for (const name of ['title', 'done', 'dataRole']) {
    assert.equal(isGroupableProp(name), true, `${name} must be groupable`)
  }
})

test('prototype-named props never read through the compact object', () => {
  const source = `
    export default function Child(props) {
      return (
        <view>
          <text>{props.title}</text>
          <text>{props.done}</text>
          <text>{props.constructor}</text>
        </view>
      )
    }
  `
  const result = compileComponent(source, { structuredProps: true })
  assert.equal(result.structuredProps, true)
  assert.match(
    result.wxml,
    /glazeprops && glazeprops\.title !== undefined \? glazeprops\.title : title/,
  )
  assert.doesNotMatch(result.wxml, /glazeprops\.constructor/)
  assert.match(result.wxml, /constructor/)

  const parent = compileComponent(
    `
      import Child from './Child'
      export default function Page(props) {
        return (
          <Child title={props.title} done={props.done} constructor={props.constructor} />
        )
      }
    `,
    {
      sourceFile: '/project/src/Page.tsx',
      resolveComponent: () => ({ source, file: '/project/src/Child.tsx', structuredProps: true }),
    },
  )
  assert.match(
    parent.wxml,
    /glazeprops="\{\{(?: )?\{title: title, done: done\}(?: )?\}\}"/,
  )
  assert.match(parent.wxml, /\bconstructor="\{\{(?: )?constructor(?: )?\}\}"/)
})

test('rejects glazecontext as a declared prop as well as an attribute', () => {
  assert.throws(
    () =>
      compileComponent(`
        export default function Child(props) {
          return <view>{props.glazecontext}</view>
        }
      `),
    /reserved compiler property "glazecontext"/,
  )
  assert.throws(
    () =>
      compileComponent(`
        export default function Child(props) {
          return <view>{props.glazeContext}</view>
        }
      `),
    /reserved compiler property "glazecontext"/,
  )
})
