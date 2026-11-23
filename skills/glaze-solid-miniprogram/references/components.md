# Components, props, events, slots, context and refs

## Components are imported from relative files

```tsx
import TodoItem from './TodoItem'

<TodoItem title={todo().title} done={todo().done} onToggle={() => toggle(todo().id)} />
```

- Local components must come from a relative source file; the builder adds
  `usingComponents` and emits only components reachable from a page.
- A component that is **pure** (returns JSX only; no state, lifecycle, context,
  ref or slot) may be inlined into the parent WXML. Inlining removes an extra
  mini-program component and its props/data bridge. Do not rely on a component
  always having its own shadow root, style isolation or component instance.
- A component with state/lifecycle/context/ref/slot keeps a real component
  boundary. That boundary has its own Solid root, props/data bridge and
  `index.wxss`.
- A component that is inlined loses its own style isolation: its WXML and WXSS
  land in the parent scope. Use a component boundary or a static page when
  isolation is required.
- `class`/`style` on an inlined component are not forwarded to its root. Put
  them on an element inside the component, or make it a real boundary when host
  class matters.

## Props

```tsx
type TodoItemProps = {
  title: string
  done: boolean
  onToggle?: () => void
}

export default function TodoItem(props: TodoItemProps) {
  return <text class={{ done: props.done }}>{props.title}</text>
}
```

- Read `props.x`; never destructure or mutate props at the top level.
- `omit(props, 'title', 'done')` is supported for a rest object.
- Prop names may be camelCase. The compiler lowercases the WXML property name
  (`userName` -> `username`) and the runtime maps it back.
- A prop used only by WXML is a normal mini-program property and updates without
  a child Solid signal. A prop read by generated JS gets a signal. This is an
  implementation detail; write normal `props.x` code.
- Props are read-only. Direct writes (`props.count = 1`, `props.count++`,
  `delete props.count`) are compile errors. Nested mutation is technically
  allowed but is not reactive; replace the object.
- A prop whose lowercase name would be `b0`, `b1`, ... is rejected because it
  collides with generated binding data.

## Component events

```tsx
// Parent
<TodoItem onToggle={() => toggle(todo().id)} />

// Child
type Props = { onToggle?: () => void }
<text onClick={() => props.onToggle?.()}>{props.title}</text>
```

- An event prop is any `onSomething` prop. It compiles to a custom event
  `something`, not a property.
- The child calls `props.onToggle(value)`. The parent handler receives
  `event.detail` as one argument; multiple arguments arrive as an array.
- Event props accept the same suffixes as native events: `onToggleCatch`,
  `onToggleCapture`, `onToggleCaptureCatch`, `onToggleMutBind`,
  `onToggleCaptureMutBind`.
- A component event name must not collide with a native event of the same base
  name (`onTap`/`onChange`). Rename it (`onPick`).
- Custom events bubble and are available in the capture phase by design;
  `composed` is false, so a child event does not retrigger a same-named event on
  its parent boundary.

## Slots and children

Default slot on a component boundary:

```tsx
// SlotCard.tsx
export default function SlotCard() {
  return <view class="card"><slot /></view>
}

// Parent
<SlotCard><text>body</text></SlotCard>
```

Default children through `props.children` are supported on an inlined
component:

```tsx
type CardProps = { title: string; children?: unknown }

export default function Card(props: CardProps) {
  return <view><text>{props.title}</text>{props.children}</view>
}
```

- A child that receives children must render `props.children` exactly once.
- Named slots require a real component boundary:
  ```tsx
  <slot name="header" />
  ```
  Parent children use `slot="header"`.
- A component containing `<slot>` is never inlined; named slots on an inlined
  component are not supported.

## Context

Define the context in a module, not inside the page that consumes it:

```tsx
// theme.ts
import { createContext } from 'solid-js'

export const Theme = createContext('light')
export const Palette = createContext({ color: 'light', background: 'white' })
```

```tsx
// Page.tsx
import { createSignal } from 'solid-js'
import { Palette, Theme } from './theme'
import Child from './Child'

const [color, setColor] = createSignal('light')

<Theme.Provider value="cross-file">
  <Palette.Provider value={{ get color() { return color() }, background: 'white' }}>
    <Child />
  </Palette.Provider>
</Theme.Provider>
```

```tsx
// Child.tsx
import { useContext } from 'solid-js'
import { Palette, Theme } from './theme'

const theme = useContext(Theme)
const palette = useContext(Palette)
<text>{theme} / {palette.color}</text>
```

Rules:

- A same-file `createContext` can cross a component boundary. Its key is the
  source file plus the local name, so the child module reconstructs the provider
  and receives the value through `glazecontext`. Import it from a shared module
  when several components need the same context object.
- Object and primitive context values both go through a reader, so later
  provider updates are visible without remounting the child tree.
- Destructuring a context read snapshots its current fields:
  `const { color } = useContext(Palette)` will not track later changes. Assign it
  to a variable and read `palette.color` in the reactive expression.
- Provider values cross the mini-program property bridge, so they must be
  JSON-like; functions and class instances do not survive.
- Solid 2 supports both `<Theme.Provider value={...}>` and `<Theme value={...}>`.
  Providers inside a loop are compile errors; there is no per-row provider scope.
- Inline descendants can consume context through the normal provider path;
  separate component boundaries use a `glazecontext` property and re-enter the
  provider on `ready`.

## Refs

```tsx
<view ref={(node) => setWidth(node?.width ?? 0)}>
  <text>{width()}</text>
</view>
```

- The compiler generates a stable id and calls the callback after `attached`.
  The callback receives a node handle with the initial rect fields
  (`width`, `height`, `top`, ...), or `null` if the node is missing.
- Handle methods:
  - `getBoundingClientRect()` — re-measure;
  - `querySelector(selector)` / `querySelectorAll(selector)` — descendants
    scoped to this element;
  - `focus()` / `blur()`;
  - `getAttribute(name)` / `setAttribute(name, value)`;
  - `scrollIntoView({ duration, offset })`.
- This is a measurement/query facade, not a DOM node. There is no
  `appendChild`, `innerHTML`, style mutation or direct child manipulation.
- `focus`/`blur`/attribute methods need `NodesRef.node()` from the base library;
  otherwise they return `false` (or `undefined` for `getAttribute`).
- `scrollIntoView` tries the node method first and falls back to
  `wx.pageScrollTo`; nested `scroll-view` scrolling is not guaranteed.
- An element with `ref` cannot also set `id`.
- `ref` inside `For`, `Show`, `Match` (including fallbacks) is a compile error;
  move it outside the loop/branch.
