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
| `<For each={...} key="id">` | `wx:for` + `wx:key` |
| item/index expressions inside `For` | inline `{{item.x}}` |
| imported component `<TodoItem title={...} />` | `<todo-item title="{{...}}" />` + `usingComponents` |
| `props.name` in the child | a mini-program property + a child signal |

Anything outside this subset is a compile error. Silent fallback would hide the
cases where the mini-program path diverges from Solid.

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
own WXML. Prop names must be lowercase; children/slots and component events are
not supported yet.

The build script compiles every `.tsx` under `src/`, resolves relative component
imports, and emits each component plus its `usingComponents` map. Local
component imports are removed from the generated parent module because the
child is rendered by WXML, not by the parent's JS.

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

Structural changes (insert, remove, reorder, changed key, added/removed field)
fall back to `setData({ b2: nextArray })`. Reorder is therefore native
`wx:for` work, not a per-item patch.

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

One loop level is supported for event item lookup; nested-loop event lookup is
not part of this wave.

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

Build the example:

```bash
node packages/compiler/src/build-example.mjs
```

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

Result: `counter.test.js` passes (title, count, tap updates, `Show`, `For`,
and a `TodoItem` child receiving and updating props; it also removes a row
through a `For` event).

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

1. **Component children and slots** are rejected. A component must be
   self-closing in this wave.
2. **Component events** are rejected. Only native DOM-like events are wired.
3. **List patches** only apply when key order and length are unchanged; reorder
   and structural changes send the whole array.
4. **Nested-loop event lookup** is not supported; only the innermost loop index
   is wired.
5. **Unsupported JSX** (`.map`, dynamic components, render props, `Portal`,
   `Transition`) is a compile error.
6. **Build integration** is a standalone script; a Vite plugin and per-component
   discovery are next.
7. **Svelte** has no compiler yet.
