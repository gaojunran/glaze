# Glaze language reference

This is the JSX and expression subset the Glaze compiler accepts. If a shape is
not listed here, assume it is rejected; do not invent a fallback.

## Imports

Use `solid-js` for components, primitives and control flow:

```tsx
import {
  createSignal,
  createMemo,
  createStore,
  createEffect,
  For,
  Show,
  Switch,
  Match,
  Repeat,
  Loading,
  Errored,
} from 'solid-js'
```

Do not import `render`/`hydrate` from `@solidjs/web`, do not use
`solid-js/store`, and do not use React hooks. Glaze has no DOM renderer.

## Component shape

```tsx
import { createSignal, For, Show } from 'solid-js'

type Row = { id: number; title: string; done: boolean }
type PageProps = { title: string }

export default function Page(props: PageProps) {
  const [rows, setRows] = createSignal<Row[]>([])
  const [filter, setFilter] = createSignal('all')

  const visible = () => rows().filter((row) => filter() === 'all' || !row.done)

  return (
    <view class="page">
      <text class="title">{props.title}</text>
      <button onClick={() => setFilter(filter() === 'all' ? 'open' : 'all')}>
        toggle
      </button>
      <Show when={visible().length > 0} fallback={<text>empty</text>}>
        <For each={visible()} keyed={(row) => row.id}>
          {(row) => <text>{row().title}</text>}
        </For>
      </Show>
    </view>
  )
}
```

- Exactly one default export is the component.
- Setup statements before the final `return` are preserved.
- Module-level `export const` / `export function` are kept in the generated
  module. Module-level runtime state is still a bad idea: an inlined component
  shares its parent's module and owner.
- Named helper functions are fine if they are pure or operate on explicit
  arguments.

## Native tags and text

Use mini-program tags (`view`, `text`, `button`, `image`, `input`, `textarea`,
`scroll-view`, `swiper`, `picker`, `slot`). HTML tags are not mapped.

```tsx
<view class="row">
  <text>Hello</text>
  <text>{props.title}</text>
  <image src={logo} />
</view>
```

- Text whitespace is collapsed like JSX. Avoid formatting that puts meaningful
  spaces only in indentation.
- Boolean expression children are converted to empty text by the runtime;
  WXML would otherwise show `"true"` / `"false"`.
- `{null}`, `{undefined}`, `{''}` render nothing.
- Raw JSX as a value (`const x = <view />` passed around) is rejected. Put JSX
  directly in the tree, or pass children.

## Expressions

Signals are functions: `{count()}`, `{user().name}`. Props are property reads:
`{props.title}`, `{props.user.name}`.

Simple prop-only expressions are projected into WXML without a binding:
property access, nested property access, literals, `+ - * / %`, comparisons,
`&&`, `||`, unary `! + -`, and ternaries. Examples:

```tsx
<text>{props.title}</text>                 // {{title}}
<text>{props.count + 1}</text>             // {{count + 1}}
<text>{props.done ? 'done' : 'todo'}</text>
<view hidden={!props.visible} />
```

These fall back to a normal `bN` binding (still supported, just less direct):
calls, optional access (`props.user?.name`), `??`, computed access
(`props[key]`), object/array literals, template literals, and expressions mixed
with local signals.

Inside `<For>` / `<Show>` callbacks, only loop variables exist in WXML. The
compiler hoists loop-independent subexpressions and rejects:

- function calls that depend on the loop value (`format(item().title)`);
- template literals that depend on the loop value;
- raw JSX values;
- `ref`, context providers and async boundaries inside a loop.

## Conditions

```tsx
<Show when={open()}>
  <text>open</text>
</Show>

<Show when={open()} fallback={<text>closed</text>}>
  <text>open</text>
</Show>

<Show when={user()} keyed>
  {(value) => <text>{value.name}</text>}
</Show>

<Show when={user()}>
  {(accessor) => <text>{accessor().name}</text>}
</Show>
```

- `keyed` callback receives the value; non-keyed receives an accessor.
- Conditions are guarded so `{user().name}` does not run before `user()` is set.
- Do not use `open() && <text>...</text>` as a general UI pattern. Use `Show`.

```tsx
<Switch fallback={<text>other</text>}>
  <Match when={status() === 'idle'}>
    <text>idle</text>
  </Match>
  <Match when={status() === 'busy'} keyed>
    {(value) => <text>{value}</text>}
  </Match>
</Switch>
```

## Lists

```tsx
<For each={todos()} keyed={(todo) => todo.id}>
  {(todo) => <text>{todo().title}</text>}
</For>
```

Modes:

| Form | Item | Index | Key |
| --- | --- | --- | --- |
| `keyed` / default | value | accessor | none unless `key` is set |
| `keyed={false}` | accessor | number | none (intentional) |
| `keyed={(item) => item.id}` | accessor | accessor | one field |

- For object lists, always use `keyed={(item) => item.id}` (or another stable
  single field). A keyless object list has no `wx:key` and is a performance
  trap.
- `keyed` functions must return one field; nested keys (`item.meta.id`) are
  rejected.
- The item and index callback names must be distinct in nested loops.
- Callback local declarations must be `const` before one `return`:
  ```tsx
  <For each={rows()} keyed={(row) => row.id}>
    {(row) => {
      const title = row().title
      return <text>{title}</text>
    }}
  </For>
  ```
  `let`, destructured locals, statements after `return`, and blocks without a
  single JSX return are rejected. Destructuring the callback parameter is
  supported and is aliased.

```tsx
<For each={todos()} fallback={<text>empty</text>}>
  {(todo) => <text>{todo}</text>}
</For>
```

`<Repeat count={n} from={start}>` creates an index range; the callback receives
a number index. Use `<For>` for data and `<Repeat>` for generated ranges.

## JSX attributes

- Static string/number attributes become XML attributes.
- Boolean attributes are supported; use `hidden={!props.visible}` or
  `disabled={props.disabled}`.
- `data-*` and `aria-*` are forwarded; `data-glaze-index*` is reserved for loop
  index restoration and must not be set by user code.
- An element with `ref` cannot also set `id`.
- `innerHTML` and `textContent` are compile errors; render children instead.
- JSX spread only accepts a static object literal:
  ```tsx
  <view {...{ class: 'row', id: 'x' }} />
  ```
  Spreading `props` or a runtime object is rejected because attributes must be
  known at compile time.
- `class` accepts a string, array or object. `style` accepts a string or a
  static/dynamic object using camelCase keys.

## Native events

Use the JSX prop names below. Native event names are kebab/lowercase platform
events after compilation; do not write `bindtap`.

| JSX | WXML |
| --- | --- |
| `onClick` | `bindtap` |
| `onClickCatch` | `catchtap` |
| `onClickCapture` | `capture-bind:tap` |
| `onClickCaptureCatch` | `capture-catch:tap` |
| `onClickMutBind` | `mut-bind:tap` |
| `onInput` | `bindinput` |
| `onChange` | `bindchange` |

The map covers the common native events (`tap`, `input`, `change`, `confirm`,
`focus`, `blur`, `submit`, `reset`, `longpress`, touch, scroll, media, picker,
map and animation events). Unknown native events are compile errors.

## Unsupported JSX

Do not write:

```tsx
{items.map((item) => <text>{item.title}</text>)}   // use <For>
const C = open() ? A : B                           // use <Show>/<Switch>
<Dynamic component={C} />                          // no dynamic components
<Portal>...</Portal>                               // no Portal
<Transition>...</Transition>                       // no Transition
<div>{...}</div>                                   // use <view>
<text innerHTML={html} />                          // no innerHTML
```

Render props, HOCs, arbitrary `.map()` JSX, dynamic JSX spread and a full
DOM-like ref are explicit non-goals. If a requirement seems to need one, reshape
it into a known component tree and ask before adding a new abstraction.
