# Compiler architecture

Status: working spike, 2026-11-21.

## Direction

Glaze compiles Solid JSX to mini-program WXML at build time and runs only the
reactive logic at runtime. There is no runtime virtual tree and no generic
recursive template.

```
Counter.tsx
  └── @glaze/compiler
        ├── Counter.wxml        static structure + binding paths
        └── Counter.tsx         Solid setup + ctx.bind / ctx.event calls
              └── esbuild       bundles solid-js + @glaze/runtime
                    └── components/glaze-counter/index.js
```

The runtime only forwards binding values:

```
signal write
  └── createEffect(compute, apply)
        └── setData({ b0: value })
              └── WXML binding update
```

## Why not external components

The original plan used glass-easel `externalComponent` plus a custom
`templateEngine`. That API is view-layer only; a user `Component()` runs in the
appservice and its config is serialized, so the engine object is lost. The
component mounts, but the engine never runs. See
[findings-external-component.md](findings-external-component.md).

## Compiler

`@glaze/compiler` parses the default-exported component function with Babel,
keeps the setup statements before `return`, and compiles the returned JSX into
WXML.

First-wave support:

| Syntax | Compiles to |
| --- | --- |
| native element | same tag |
| static text / attribute | static WXML |
| `{expression}` text or attribute | `{{bN}}` + a binding |
| `onClick` / `onTap` / `onInput` / ... | `bindtap` / `bindinput` + `eN` |
| `<Show when={...}>` | `wx:if` |
| `<Show fallback={...}>` | `wx:if` + `wx:else` |
| `<Switch>` + `<Match when={...}>` | `wx:if` / `wx:elif` / `wx:else` |
| `<Switch fallback={...}>` | final `wx:else` |
| `<For each={...} key="id">` | `wx:for` + `wx:key` |
| item/index expressions inside `For` | inline `{{item.x}}` |
| `class` object / array | `className(...)` binding, or inline WXML segments inside `For` |
| `style` object | `styleName(...)` binding, or inline WXML segments inside `For` |
| imported component `<TodoItem title={...} />` | `<todo-item title="{{...}}" />` + `usingComponents` |
| stateless component outside `For` | inlined into the parent's WXML and setup |
| `props.name` in the child | a mini-program property + a child signal |

Anything outside this subset is a compile error. Silent fallback would hide the
cases where the mini-program path diverges from Solid.

`class` arrays/objects outside a `For` go through `className(...)` from
`@glaze/runtime/mini`; `style` objects go through `styleName(...)`. Inside a
`For`, the compiler emits equivalent WXML segments (`{{item ? 'active' : ''}}`)
so the view layer can evaluate them without a per-row binding. Dynamic class or
style keys are rejected.

### Props and components

A component function may take one `props` parameter:

```tsx
type TodoItemProps = { title: string; done: boolean }

export default function TodoItem(props: TodoItemProps) {
  return <text class={props.done ? 'done' : ''}>{props.title}</text>
}
```

The compiler collects `props.title` / `props.done` as the child's property
list. The parent is compiled to a tag and the build script writes
`usingComponents`:

```xml
<todo-item title="{{todo.title}}" done="{{todo.done}}" />
```

At runtime the child declares those names as mini-program `properties`, creates
one Solid signal per prop, and exposes a getter-only `props` object. Property
observers update the signals; the normal binding effects then update the child's
own WXML. Prop names must be lowercase. Event props (`onToggle`, `onChange`, ...)
are compiled as mini-program custom events instead of properties; see below.

`glaze build` compiles every `.tsx` under `src/`, resolves relative component
imports, and emits each reached component plus its `usingComponents` map. Local
component imports are removed from the generated parent module because the
child is rendered by WXML, not by the parent's JS. Components that are always
inlined are not emitted.

### Static component inlining

A component imported from a relative file is inlined when all of these hold:

- it is not inside a `For` (no loop scope);
- its own imports come only from `solid-js`;
- it has no module-level runtime statements (type aliases are fine);
- if it has children, it renders `props.children` exactly once (default slot);
- it does not contain `<slot>` elements (those need a real component boundary).

The child's setup runs in a block inside the parent's Solid root, and its props
become getters over the parent's expressions:

```js
{
  const props = {
    get title() { return ("Glaze + Solid"); },
  };
  ctx.bind(0, () => (props.title));
}
```

Children are compiled in the parent's scope before the child block:

```tsx
<Card title="Todos">
  <button onClick={toggle}>toggle first</button>
</Card>
```

becomes a `view.card` with the button's WXML inside, and the button's handler
stays in the parent's handler table. A child that has children but does not
render `props.children` is a compile error, so children cannot be dropped
silently.

Consequences:

- props are ordinary Solid getters, so no property bridge and no extra
  mini-program component;
- the child shares the parent's owner, so `onCleanup` and context stay
  continuous;
- the child's WXML is emitted inside the parent's WXML, so the parent's WXSS
  scope applies;
- the child's `.wxss` is appended to the parent's stylesheet at build time.

Ineligible components are compiled as a mini-program component, exactly as
before. This is a per-usage decision, not a per-file flag.

### Component events

An event prop on a component boundary is compiled to a custom event binding:

```tsx
<TodoItem title={todo.title} done={todo.done} onToggle={() => toggle(todo.id)} />
```

```xml
<todo-item title="{{todo.title}}" done="{{todo.done}}" bind:toggle="e3" />
```

The child declares the event in its generated config:

```js
eventProps: { onToggle: "toggle" }
```

At runtime `props.onToggle(...)` calls `triggerEvent("toggle", detail)`, and the
parent handler receives `event.detail` (one argument; multiple arguments arrive
as an array). Inlined components skip this bridge: the event prop is a normal
getter over the parent's function, so it is called directly.

### Slots

Three cases are supported:

1. **Default slot on an inlined component.** The child renders
   `{props.children}`; the parent's children are compiled in the parent scope and
   substituted at that expression. The child must render it exactly once.
2. **Default slot on a component boundary.** The child writes `<slot />`; the
   parent's children become the element's children in WXML.
3. **Named slots on a component boundary.** The child writes
   `<slot name="header" />`; the parent marks children with `slot="header"`.
   The builder sets `"options": { "multipleSlots": true }` on that component.

A component whose source contains `<slot>` is never inlined, because a native
slot must live in its own component tree. Named slots on an inlined component
are not supported; use a component boundary for that case.

### Context

`<Theme.Provider value={...}>` is compiled for **inlined** descendants:

```tsx
const Theme = createContext('light')

<Theme.Provider value="dark">
  <ThemeLabel theme={Theme} />
</Theme.Provider>
```

The compiler creates a provider block and emits:

```js
withProvider(Theme, ("dark"), () => {
  {
    const props = { get theme() { return (Theme); } };
    const theme = useContext(props.theme);
    ...
  }
})
```

`withProvider` calls the Solid provider directly and drains its memo, so the
context is active while the compiled child blocks run. This only works for
inlined descendants: a child rendered as a separate mini-program component has
its own Solid root and does not inherit the provider.

### Refs

`ref` on a native element generates a stable id and a node query:

```tsx
<view ref={(node) => setWidth(node?.width ?? 0)}>
  <text>{width()}</text>
</view>
```

```xml
<view id="glaze-r0">
```

After `attached`, the runtime runs
`createSelectorQuery().select("#glaze-r0").boundingClientRect(...)` and calls the
callback with `{ id, ...rect }` or `null`. This is a measurement facade, not a DOM
node: it has no `focus`, `scrollIntoView`, or child traversal. An element with
`ref` cannot also set `id`.

### Nested loops

Nested `For` elements must use distinct item and index names:

```tsx
<For each={grid()} key="id">
  {(row, rowIndex) => (
    <For each={row.cells} key="id">
      {(cell, cellIndex) => <button onClick={...}>{cell.id}</button>}
    </For>
  )}
</For>
```

Each level writes its own marker (`data-glaze-index`, `data-glaze-index1`, ...),
and the generated handler reconstructs every enclosing item before calling the
user handler.

### Lists, events and batching

A `For` binding is recorded with its key:

```js
listBindings: { 2: "id" }
```

When the source array changes, the runtime compares the previous and next
arrays by key. If the length and key order are unchanged, it emits only changed
fields:

```js
setData({ "b2[0].done": false })
```

When the key structure changes, the runtime does not send the whole array. It
uses glass-easel's component primitive:

```js
this.groupUpdates(() => {
  this.spliceArrayDataOnPath(["b2"], index, deleteCount, inserts)
})
```

`spliceArrayDataOnPath` is a `glass-easel` `Component` method (not the standard
mini-program `setData` API). It records a splice `DataChange`; `groupUpdates`
applies it once. The compiler's binding array is therefore still the source of
truth, but the data bridge receives an insert/delete operation instead of a new
array.

The runtime picks the smallest prefix/suffix change:

- append: insert at the end;
- insert in the middle: one insert splice;
- remove a contiguous range: one delete splice;
- reorder or replace a middle range: one splice that deletes the old middle and
  inserts the new middle.

Same-length updates with unchanged key order still use field paths, e.g.
`setData({ "b2[0].done": false })`. If `spliceArrayDataOnPath` is unavailable
(e.g. a non-glass-easel runtime), the runtime falls back to
`setData({ b2: nextArray })`.

Events inside a loop get an index marker:

```xml
<button class="remove" bindtap="e3" data-glaze-index="{{index}}">x</button>
```

The generated handler resolves the loop item from the same source expression
before calling the user handler:

```js
ctx.event(3, (event) => {
  const index = Number(event.currentTarget.dataset.glazeIndex)
  const todo = todos()[index]
  return (() => setTodos(...))(event)
})
```

Nested loops use one marker per level; the handler walks the whole scope chain.

Binding writes are merged in a microtask: several signals updated in one event
produce one `setData` call. The initial values still go through one synchronous
`setData` before the first paint.

### Generated runtime

```
defineGlazeComponent({
  properties: ["done", "title"],
  data: { b0: null, b1: null, b2: null },
  handlerCount: 2,
  setup(ctx, props) {
    // original setup statements
    ctx.bind(0, () => count())
    ctx.bind(1, () => count() > 3)
    ctx.event(0, () => setCount((value) => value + 1))
  },
})
```

`defineGlazeComponent`:

1. creates one Solid root per mini-program component instance in `created`;
2. creates one signal per declared property and a getter-only `props` object;
3. runs `setup`, then evaluates every binding once and `setData`s the initial
   values before the first paint;
4. in `attached`, creates one `createEffect(compute, apply)` per binding and
   sends later values to `setData({ bN: value })`; if a prop changed between
   `created` and `attached`, the first effect run sends the corrected value;
5. disposes the root in `detached`.

## Solid 2 note: burst events

Solid 2 writes are microtask-batched. In a burst of taps, `setCount(count() + 1)`
reads the old value each time and only increments once. Use the functional setter:

```tsx
onClick={() => setCount((value) => value + 1)}
```

This is documented as a user-facing rule for Glaze, not hidden by the runtime.

## Validation

Build the example project:

```bash
pnpm build
```

The builder writes `examples/solid-todo/miniprogram`. See
[build.md](build.md) for the project layout.

Run the real mini-program in the simulator:

```bash
cd ~/Playground/minibuild
target/debug/minidev sim build \
  --project ~/Projects/glaze/examples/solid-todo \
  --out ~/Projects/glaze/.tmp/sim
target/debug/minidev sim serve \
  --dist ~/Projects/glaze/.tmp/sim \
  --browser ~/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell \
  --port 9422
```

Run the benchmark against the native page while the simulator is running:

```bash
NODE_PATH=~/Playground/minibuild/sdk node examples/solid-todo/bench/compare.cjs
```

Run the e2e case:

```bash
target/debug/minidev test \
  --project ~/Projects/glaze/examples/solid-todo \
  --browser ~/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell
```

Result: `counter.test.js` passes. It covers title/count updates, `Show`,
`Switch`/`Match`, keyed `For`, class objects, `TodoItem` props, inline default
slot, boundary default slot, named slot, custom component event, context value,
ref measurement, nested `For` event, append/insert/delete updates, and row
removal.

## Benchmark

`examples/solid-todo` contains two equivalent 1000-row pages:

- `pages/bench/index` — compiled Solid (`glaze-bench`);
- `pages/native/index` — hand-written WXML.

Measured through `minidev-automator` on minidev 0.18.0, base library 3.17.3,
headless Chromium 1248, local Linux. First render is wall time from `reLaunch`
to the 1000th `.row` becoming queryable; update is wall time from tapping
`bump` to the `.tick` text changing; reverse is wall time from tapping
`reverse` until the first row changes from `Item 0` to `Item 999`. Automation
overhead is included, so compare relative numbers only. Absolute update numbers
move with machine load; the two pages were measured in the same session.

| Run | Glaze first render | Native first render | Glaze update | Native update | Glaze reverse | Native reverse |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 3250 ms | 3208 ms | 96 ms | 93 ms | 71 ms | 68 ms |
| 2 | 3205 ms | 3212 ms | 92 ms | 92 ms | 67 ms | 67 ms |
| 3 | 3210 ms | 3196 ms | 93 ms | 93 ms | 65 ms | 68 ms |

Within this harness, first render is within ~1% of native, and scalar update
and keyed reverse are the same within noise. The 1000 rows are rendered by
native `wx:for` in both cases; Solid does not build a virtual tree.

## Known gaps

1. **Inlined components** cannot have relative imports or module-level runtime
   state. They lose their own style isolation because their WXML lands in the
   parent's scope.
2. **Named slots** require a component boundary. An inlined component can only
   use the default `props.children` slot.
3. **Context** only reaches inlined descendants. A separate mini-program
   component does not inherit a provider, and the provider value is read at
   mount rather than re-evaluated as a reactive expression.
4. **Refs** expose a measurement object, not a DOM node. `focus`,
   `scrollIntoView`, and child traversal are not available.
5. **List structure** uses `spliceArrayDataOnPath` for insert, delete, and
   middle replacement. A pure move is expressed as delete+insert over the
   changed middle; there is no LIS move scheduler yet, so a full reverse still
   sends one large middle chunk.
6. **Component event payloads** pass `event.detail` as one argument; multiple
   arguments arrive as an array.
7. **Unsupported JSX** (`.map`, dynamic components, render props, `Portal`,
   `Transition`) is a compile error.
8. **Build integration** is a CLI (`glaze build`); there is no Vite plugin or
   watch mode yet.
9. **Svelte** has no compiler yet.
