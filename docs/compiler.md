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
  └── createEffect(compute, apply)   // scalar bindings in batches of 8
        └── microtask flush
              └── DataGroup.setChanges([path, value /* or splice */, ...])
                    └── applyDataUpdates()
                          └── WXML binding update
```

The runtime builds `DataChange` path arrays from the start; it does not parse the
`b3[0].done` strings again. See `docs/optimizations.md` for the queue and the
`replaceDataOnPath` / `spliceArrayDataOnPath` fallback.

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
| `onClickCatch` / `onClickCapture` / `onClickMutBind` / ... | `catchtap` / `capture-bind:tap` / `mut-bind:tap` + `eN` |
| `<Show when={...}>` | `wx:if` |
| `<Show fallback={...}>` | `wx:if` + `wx:else` |
| `<Show keyed>{(value) => ...}</Show>` | one-item `wx:for` under a `wx:if` |
| `<Show>{(value) => ...}</Show>` | `wx:if` over a value binding; accessor calls are rewritten to the bound value |
| `<Switch>` + `<Match when={...}>` | `wx:if` / `wx:elif` / `wx:else` |
| `<Match when={...} keyed>{(value) => ...}</Match>` | one-item `wx:for` under `wx:if` / `wx:elif` |
| `<Match when={...}>{(value) => ...}</Match>` | `wx:if` / `wx:elif` over a value binding |
| `<Match when={...}>{(value) => ...}</Match>` | same, with the accessor call rewritten |
| `<Switch fallback={...}>` | final `wx:else` |
| `<For each={...} keyed={(item) => item.id} fallback={...}>` | `wx:if` + `wx:for` + `wx:else` |
| `<For keyed={false}>` | `wx:for` without `wx:key`; item is an accessor |
| `<For keyed={(item) => item.id}>` | `wx:key="id"`; item and index are accessors |
| `<Repeat count={...} from={...} fallback={...}>` | generated index array + `wx:for` |
| item/index expressions inside `For` | inline `{{item.x}}` |
| outer `props` / signal expressions inside `For` | hoisted to a parent `bN` binding |
| `const` locals in a `For` / `Show` / `Match` callback | inlined at each use |
| destructured `For` / `Show` callback parameter | aliased to `__glazeItem.x` / `__glazeValue.x` |
| `class` object / array | `className(...)` binding, or inline WXML segments inside `For` |
| `{...{ class: 'x', id: 'y' }}` | flattened static attributes |
| `style` object | `styleName(...)` binding, or inline WXML segments inside `For` |
| imported component `<TodoItem title={...} />` | `<todo-item title="{{...}}" />` + `usingComponents` |
| stateless component outside `For` | inlined into the parent's WXML and setup |
| pure component inside `For` / `Show` / `Match` | inlined into the loop template with props substituted per row |
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

At runtime the child declares those names as mini-program `properties`. Prop
names may be camelCase: the compiler lowercases the WXML property name
(`userName` -> `username`, `user-name` in WXML source is normalized by the
mini-program runtime), emits `propMap: { userName: "username" }`, and the runtime
Proxy resolves `props.userName` through that map. Event props (`onToggle`,
`onChange`, ...) are compiled as mini-program custom events instead of
properties; see below.

### Prop projection and selective prop signals

The compiler projects an expression that only reads props directly into WXML,
without a `bN` binding and without a child effect:

```tsx
<text>{props.title}</text>
<view title={props.title} data-id={props.id} />
```

becomes:

```xml
<text>{{title}}</text>
<view title="{{title}}" data-id="{{id}}" />
```

The first wave accepts property access, string/number/boolean/null literals,
`+ - * / %`, comparisons, `&&`, `||`, unary `! + -`, ternaries, and nested
property access (`props.user.name`). Anything else stays on the normal binding
path: calls, optional access (`props.user?.name`), `??`, computed access,
objects/arrays, template literals, and expressions mixed with local state.
A prop whose lowercased name collides with a local declaration also stays on the
binding path.

Projection is only done outside a loop. Expressions inside `<For>`/`<Show>`
continue to use the existing inline/hoist path; a pure child inside a loop is
handled by component inlining instead.

Because WXML reads the property directly, a parent prop update no longer needs
the child's Solid signal or binding effect. The runtime still creates a signal
and a property observer only for props that generated JavaScript actually reads.
Prop reads are recorded at the point where generated JavaScript is built, not by
scanning the final JavaScript as a string. Every code-generation entry point
registers the AST expression it emits:

- setup statements before `return`;
- `ctx.addBinding`;
- `ctx.addEvent`;
- `ctx.addRef`;
- `ctx.addBindingCode` when the code wraps a user expression
  (`className(...)`, `styleName(...)`, `textValue(...)`, loop conditions);
- inline-child prop getters (a parent expression mapped into a child prop);
- context-provider values;
- inline-child setup statements.

Inline child prop getters matter even though the child is inlined: the getter is
generated in the parent module, and it can read a parent prop. A provider value
is also emitted in the parent module, so `value={props.current}` needs the same
treatment.

The compiler emits `propSignals: []` when every prop is WXML-only, or a list of
the property names that are read by JS. When all props are read it omits the
field and the runtime keeps the old behavior. Registration is deliberately
conservative: a bare `props` reference, `props[key]`, destructuring, or an
unrecognized alias marks every prop as needing a signal. A false positive costs
one unused signal; a false negative would make a generated JS read see
`undefined`. Any new code-generation path must call `notePropReads` with the AST
it emits. As a final fail-closed check, the compiler still audits the generated
code fragments: if an unregistered `props` reference remains, every prop keeps a
signal. That costs only the optimization, never correctness.

### Props are inputs, not state

Solid's component props are getter-only in a module build: assigning a declared
prop field throws a `TypeError`. Glaze enforces the same rule instead of silently
swallowing the write. A direct write such as `props.count = 1`, `props.count++`
or `delete props.count` is a compile error:

```text
"props" is read-only; assign to a local signal or store instead of mutating a prop
```

The runtime `props` Proxy also throws on `set`, `deleteProperty` and
`defineProperty`, because aliases (`const p = props`) and indirect calls
(`Object.assign(props, ...)`) cannot be rejected reliably at compile time.
Mutating a nested object held by a prop (`props.user.name = ...`) is still
allowed, matching Solid, but it is not reactive; replace the prop object instead
of mutating it when the parent must observe the change.

The compiler emits `propSignals: []` when every prop is WXML-only, or a list of
the property names that are read by JS. When all props are read it omits the
field and the runtime keeps the old behavior. The scan is deliberately
conservative: a bare `props` reference, `props[key]`, destructuring, or an
unrecognized alias marks every prop as needing a signal. A false positive costs
one unused signal; a false negative would make a generated JS read see
`undefined`.

Two related scoping rules:

- An inline child has its own `props` parameter. Projection is disabled inside
  that child while its props parameter is in scope, otherwise a child
  `props.title` whose name matches a parent prop would read the parent property
  instead of the child's prop getter.
- Event handlers and ref callbacks are marked conservatively today because the
  runtime `props` Proxy reads prop signals. They are invoked on demand, so a
  future optimization could read the platform property directly for them; that
  would remove them from `propSignals` without changing the property path.

A prop read only by WXML is still a normal mini-program property, so the child
template updates when the parent writes the property. This is the same path a
native child component uses. A prop read by JS still gets a signal; its observer
updates the signal and the normal binding effects run.

`glaze build` compiles every `.tsx` under `src/`, resolves relative component
imports, and emits each reached component plus its `usingComponents` map. Local
component imports are removed from the generated parent module because the
child is rendered by WXML, not by the parent's JS. Components that are always
inlined are not emitted.

### Static component inlining

A component imported from a relative file is inlined when all of these hold:

- outside a loop it only needs the conditions below; inside a `For`/`Show`/
  `Match` it must also be a **pure projection of its props** (no setup
  statements and no state, lifecycle, context or ref usage);
- it does not resolve back into the component currently being inlined (a
  recursion guard records the file on the inline stack; a self-reference falls
  back to a component boundary);
- its own imports are `solid-js` or relative component imports that are
  themselves inlinable; helper-module imports still block inlining;
- it has no module-level runtime statements (type aliases are fine);
- if it has children, it renders `props.children` exactly once (default slot);
- it does not contain `<slot>` elements (those need a real component boundary).

Inside a loop, a pure child is inlined directly into the loop template instead
of creating a component block. Each `props.name` use is replaced by the parent
attribute expression, so WXML sees loop values directly:

```tsx
<For each={items()} keyed={(item) => item.id}>
  {(item) => <Row title={item().title} done={item().done} />}
</For>
```

becomes

```xml
<block wx:for="{{b0}}" wx:for-item="item" wx:for-index="__glazeIndex" wx:key="id">
  <view class="row">
    <text>{{item.title}}</text>
    <text class="{{item.done ? 'done' : ''}}">{{item.done ? 'done' : 'todo'}}</text>
  </view>
</block>
```

There is no child component instance, props property bridge, child Solid root
or child `setData`. Event props are substituted too, so the parent handler runs
with the loop index reconstructed from `data-glaze-index`; the example's
`RemoveButton` row action is a pure component inside `For` and is covered by
the simulator e2e.

The eligibility check is deliberately narrow: the child must return JSX as its
only statement and may not call `createSignal`, `createMemo`, `createEffect`,
`createStore`, `onMount`, `onCleanup`, `onSettled`, `useContext` or any other
state/lifecycle helper; it may not contain `ref` or `<slot>`. A stateful child
keeps the component boundary. Parent `class`/`style` attributes on a component
that is inlined are not forwarded to the child root.

Outside a loop, the child's setup runs in a block inside the parent's Solid
root, and its props become getters over the parent's expressions:

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

Relative component imports inside an inlined child resolve from that child's
file, not from the parent. The compiler records the resolved file on each
inlined component and the builder appends each of those `.wxss` files to the
parent stylesheet.

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

Event props accept the same binding suffixes as native events:

| JSX prop | Component WXML |
| --- | --- |
| `onToggle` | `bind:toggle` |
| `onToggleCatch` | `catch:toggle` |
| `onToggleMutBind` | `mut-bind:toggle` |
| `onToggleCapture` | `capture-bind:toggle` |
| `onToggleCaptureCatch` | `capture-catch:toggle` |
| `onToggleCaptureMutBind` | `capture-mut-bind:toggle` |

The suffix is stripped from the event name: `onToggleCatch` maps to the
`toggle` event. Custom events are triggered with `bubbles: true` and
`capturePhase: true`, so `catch` and `capture` bindings work inside the same
component tree. `composed` is intentionally false: a child event does not cross
the component's shadow boundary and retrigger a same-named event prop of its
parent. This behavior differs from the mini-program default (non-bubbling
custom events); it is a Glaze-level contract for DOM-like event props.

### Native event bindings

Native elements accept all six glass-easel binding kinds through a suffix:

| JSX prop | WXML |
| --- | --- |
| `onClick` | `bindtap` |
| `onClickCatch` | `catchtap` |
| `onClickMutBind` | `mut-bind:tap` |
| `onClickCapture` | `capture-bind:tap` |
| `onClickCaptureCatch` | `capture-catch:tap` |
| `onClickCaptureMutBind` | `capture-mut-bind:tap` |

The suffix is parsed before the event-name lookup, so `onClickCaptureCatch`
resolves to `tap` with the `capture-catch` kind. Besides `onClick`, `onTap`,
`onInput`, `onChange`, `onConfirm`, `onFocus`, `onBlur`, `onSubmit`, `onReset`,
`onLongPress`/`onLongTap` and the touch events, the map covers scroll
(`onScroll`, `onScrollToLower`, `onScrollToUpper`), media (`onLoad`,
`onError`, `onTimeUpdate`, `onEnded`, `onPlay`, `onPause`, `onProgress`),
picker (`onColumnChange`, `onLineChange`, `onRegionChange`), map
(`onMarkertap`, `onCalloutTap`, `onLabelTap`, `onControlTap`), animation
(`onAnimationStart`, `onAnimationIteration`, `onAnimationEnd`) and
`onTransitionEnd`. The simulator e2e taps nested
elements and verifies that `catch` suppresses the outer `bind`, `capture` runs
before the target handler, and `mut-bind` suppresses the outer `mut-bind`. A
component boundary probe verifies `catch:ping` and `capture-bind:ping` through
the runtime's custom-event options.

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
context is active while the compiled child blocks run.

An imported context can also cross a component boundary. The parent passes one
`glazecontext` property that maps the context key to its value; the child emits
`withBoundaryContexts(...)` around its setup and re-enters only the providers it
actually reads with `useContext`:

```tsx
// theme.ts
export const Theme = createContext('light')

// Child.tsx
const theme = useContext(Theme)
return <text>{theme}</text>

// Page.tsx
<Theme.Provider value="cross-file">
  <Child />
</Theme.Provider>
```

The value travels through the mini-program property bridge, so it must be
JSON-like. A context declared with `createContext` in the **same file** cannot
cross a boundary (the child module has no way to reconstruct the same object);
import it from a module instead. The value is read once when the child becomes
ready, not re-evaluated as a reactive expression. Components that consume a
boundary context defer their setup to `ready`, because the parent's first
`setData` may land after the child is created.

### Async boundaries

Solid 2 `Loading` and `Errored` compile inside a component, including nested boundaries:

```tsx
<Loading fallback={<text>loading</text>}>
  <text>{later()}</text>
</Loading>
<Errored fallback={(error) => <text>{error().message}</text>}>
  <text>{broken()}</text>
</Errored>
```

Each boundary gets an id. Bindings inside it are emitted with that id, and
`<Loading>` becomes a `wx:if` binding on `ctx.loading(id)`; `<Errored>` becomes
`ctx.errored(id)`. A binding is governed by its **nearest** enclosing boundary,
so an inner pending binding shows the inner fallback without hiding the outer
content. A failed binding is skipped instead of writing `undefined`, so it
cannot clear another binding's error. The fallback and the boundary's own
condition belong to the outer boundary.

Bindings in a component with async boundaries are wrapped in one Solid memo
each. The memo is the single evaluation node the data effect reads; a
`NotReadyError` propagates as pending, while a real error is stored as a value
and rethrown by the data effect so the existing skip-and-log behavior survives.
Initial values still call the raw binding before the memo is created, so a
first-attempt failure can recover.

First-pending state is captured by the runtime's binding error channel. After
content has landed, `isPending` reports a refetch and restores the fallback.
The compiler emits `asyncStatus: [{ index, kind, boundary }]`; those condition
bindings are projected directly from the status signals rather than through an
effect that a pending read in the same component could hold. Pending state is
per boundary and per binding; errors are keyed by `NotReadyError.source` when
present. Error objects are normalized to `{ name, message }` before crossing the
WXML data bridge; `error()` in an `Errored` fallback reads that normalized
value. The fallback is rendered through a single-element `wx:for`, so `error()`
is rewritten to the WXML loop item and the dependency graph itself stays in JS.

Boundaries inside a loop are rejected because their condition would need a
per-row binding. `on` dependencies and reset are not implemented; an `Errored`
fallback function may take only the error accessor.

Remaining async work, deliberately left for a later pass:

- No Solid boundary tree and no boundary-output projection. First pending and
  real errors are captured by the runtime; only refetch pending uses Solid
  `isPending`.
- `Errored` reset, `Loading on`, error-value reset, and boundary parent/child
  status aggregation are not implemented.
- `asyncStatus` condition bindings are projected directly with a microtask.
  This keeps them out of a held effect, but it has not been checked on a real
  device for visible intermediate frames.
- Async refetch behavior is covered by a runtime unit test, not by a real-device
  smoke test. minidev only proves the generated output loads and settles.

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

After `attached`, the runtime measures `#glaze-r0` and calls the callback with a
node handle that also carries the initial rect fields (`width`, `height`,
`top`, ...) or `null`. The handle exposes:

- `getBoundingClientRect()` — re-measure the element;
- `querySelector(selector)` / `querySelectorAll(selector)` — query descendants
  scoped to this element;
- `scrollIntoView({ duration, offset })` — page-scroll the element into view.

It is still a measurement facade, not a DOM node: `focus`, `blur`, attribute
mutation, and direct child manipulation are not available. An element with
`ref` cannot also set `id`.

### Nested loops

Nested `For` elements must use distinct item and index names:

```tsx
<For each={grid()} keyed={(row) => row.id}>
  {(row, rowIndex) => (
    <For each={row.cells} keyed={(cell) => cell.id}>
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
{ path: ["b2", 0, "done"], value: false }
```

When the key structure changes, the runtime does not send the whole array. It
uses glass-easel's component primitive:

```js
{ path: ["b2"], splice: { index, del: deleteCount, inserts } }
```

The splice entry is glass-easel's `DataChange` tuple, not the standard
mini-program `setData` shape. The flush appends replace and splice entries to one
`DataGroup` queue and applies it once. The compiler's binding array is therefore
still the source of truth, but the data bridge receives an insert/delete
operation instead of a new array.

The runtime picks the smallest prefix/suffix change:

- append: insert at the end;
- insert in the middle: one insert splice;
- remove a contiguous range: one delete splice;
- reorder or replace a middle range: one splice that deletes the old middle and
  inserts the new middle.

Same-length updates with unchanged key order still become field changes, now
as `{ path: ["b2", 0, "done"], value: false }` entries in the same flush as
other bindings. The primary flush calls the public
`Component.getDataProxy(component)` and appends these entries to the glass-easel
`DataGroup` queue (`getChanges` / `setChanges` / `applyDataUpdates`), so replace
and splice changes share one template update. If that API is unavailable the
runtime falls back to `groupUpdates` + `replaceDataOnPath` /
`spliceArrayDataOnPath`, and finally to `setData` (`{"b2[0].done": false}` or
`{ b2: nextArray }`).

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
`Repeat` inside `For` adds an index-only scope: the WXS range supplies the index
and the handler reconstructs the callback variable from the loop index.

`<For fallback>` checks `(each || []).length > 0`. `<Repeat>` builds
`Array.from({ length: count }, (_, index) => index + from)` in a binding. Inside
another `For` it uses the inline WXS range helper and offsets event indices by
`from`.

`For` follows Solid 2's `keyed` modes: default (`true`) gives a value item and
an index accessor; `keyed={false}` gives an accessor item and a numeric index;
`keyed={(item) => item.id}` gives accessor item/index and an inferred
`wx:key`. Accessor calls such as `item()` or `index()` are rewritten to the
WXML variable in expressions and event handlers. `keyed` functions must return a
single field; nested keys are rejected.

`Show` function children work at the top level and inside `For`. `keyed` passes
the value; without it the callback receives an accessor (`value()`), matching
Solid. A non-keyed callback renders directly under a `wx:if` and reads the
current value from a binding (or the enclosing row expression), so a truthy
change does not remount the subtree. A keyed callback uses a one-item
`wx:for`; at the top level it binds the array, and inside `For` it calls
`glazeRange.single(value)` from an inline WXS module. `<Match>` function children
use the same split: `keyed` gets the one-item loop, otherwise the branch is a
direct `wx:if` / `wx:elif` value binding.

`Repeat` inside `For` uses the same inline WXS module:
`glazeRange.range(count, from)` returns the index array for the row, and event
handlers reconstruct the callback variable as `index + from`. The WXS module is
emitted once per component that needs it.

### Expressions inside loops

A `For` / `Show` callback runs in WXML, where only the loop variables exist.
The compiler therefore splits expressions into two groups:

- expressions that do not reference a loop variable (`props.prefix`,
  `format(props.suffix)`, a signal read, a signal call) are hoisted into a
  normal `bN` binding; the WXML expression reads `{{bN}}`;
- expressions that do reference the item/index stay inline as `{{item.x}}` or
  `{{index.x}}`.

Small sub-expressions inside a mixed expression are hoisted independently, so
`{props.prefix}{item().title}` becomes `{{b1}}{{item.title}}` rather than one
per-row expression. Calls are only allowed outside the loop values: a call such
as `format(item().title)` cannot be evaluated per row without a per-row binding
and is a compile error. Compute it before the loop or move it into a component
boundary.

A callback body may contain `const` declarations before its single `return`:
the compiler inlines each local at every use (including event handlers). `let`,
`var`, destructured locals, statements after `return`, and blocks without a
single JSX return are rejected.

Component `props` is a Proxy with `ownKeys`, `has`, and
`getOwnPropertyDescriptor` traps, so Solid 2's `omit` and `merge` can enumerate
it. `splitProps` was removed in Solid 2; use `omit` for the rest object.

Binding writes are merged in a microtask: several signals updated in one event
produce one flush. The flush appends `DataChange` path arrays to
`Component.getDataProxy(component)` and calls `applyDataUpdates()`, so replace
and splice changes share one template update; unchanged scalar bindings are
skipped. When that API is unavailable it falls back to `groupUpdates` +
`replaceDataOnPath` / `spliceArrayDataOnPath`, then to one `setData`. The initial
values still go through one synchronous `setData` before the first paint.

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
4. in `attached`, groups scalar bindings into batches of 8 (list bindings keep
   one effect each), skips scalars equal to their previous value, and appends
   later changes to one `DataGroup` queue (`getDataProxy` + `setChanges` +
   `applyDataUpdates`; falling back to `groupUpdates`/`replaceDataOnPath`, then
   `setData`); if a prop changed between `created` and `attached`, the first
   effect run sends the corrected value;
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
NODE_PATH=~/Playground/minibuild/sdk node examples/solid-todo/bench/compare.cts
```

Run the e2e case:

```bash
target/debug/minidev test \
  --project ~/Projects/glaze/examples/solid-todo \
  --browser ~/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell
```

Result: `counter.test.js` passes. It covers title/count updates, `Show`,
`Switch`/`Match` (including keyed function children), keyed/unkeyed `For`,
outer expressions inside `For`, `const` locals in a `For` callback, `Show`
function children, `For` fallback, `Repeat`, class objects, camelCase props,
`TodoItem` props via `omit`, inline default slot, boundary default slot, named
slot, custom component event, context value, ref measurement, nested `For`
event, append/insert/delete updates, and row removal. The compiler tests also
cover the recursive-inline guard and the rejected item-dependent call.

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

1. **Inlined components** may import other stateless components through
   relative paths, recursively. They still cannot import helper modules or have
   module-level runtime state. They lose their own style isolation because
   their WXML lands in the parent's scope.
2. **Named slots** require a component boundary. An inlined component can only
   use the default `props.children` slot.
3. **Context** reaches a separate component only when the context is imported
   from a module; a same-file `createContext` cannot cross a boundary. The
   provider value is read once when the child becomes ready, not re-evaluated
   as a reactive expression.
4. **Refs** expose a node handle with measurement, descendant queries, and
   `scrollIntoView`, not a DOM node. `focus`, `blur`, and arbitrary mutation are
   not available.
5. **List structure** is a `DataChange` splice for insert, delete, and middle
   replacement (`spliceArrayDataOnPath` in the fallback path). A pure move is
   expressed as delete+insert over the changed middle; there is no LIS move
   scheduler yet, so a full reverse still sends one large middle chunk. The
   previous array is snapshotted shallowly, so an item mutated in place and
   returned in a new array (`items[0].done = true; return [...items]`) is not
   detected; replace the item object instead.
6. **Component event payloads** pass `event.detail` as one argument; multiple
   arguments arrive as an array.
7. **Unsupported JSX** (`.map`, dynamic components, render props, `Portal`,
   `Transition`) is a compile error. JSX spread only accepts an object literal;
   spreading `props` is rejected because attributes must be known at compile
   time. Destructuring supports objects, arrays, nested patterns and aliases;
   rest elements and defaults are rejected.
8. **`For` keyed functions** must return a single field (`(item) => item.id`);
   nested keys are rejected. `keyed={false}` intentionally omits `wx:key`, so
   the simulator prints a performance warning.
9. **Nested control flow** (`Show` callbacks and `Repeat` inside `For`) relies
   on an inline WXS module for per-row arrays. It is not available on platforms
   that disable WXS.
10. **Build integration** has `glaze build`, `glaze watch`, and a Vite build
    bridge. Watch is compile-incremental; there is no mini-program HMR.
11. **Async boundaries** (`Loading` / `Errored`) support nesting, but not inside
    a loop; `Errored` function fallbacks take only an error accessor, and `on`
    dependencies and reset are not implemented.
12. **Svelte** has no compiler yet.


## Boundary fixes from the Solid / glass-easel review

The compiler now rejects or guards the following instead of emitting silently
broken code:

- `wx:if` / `wx:elif` / `wx:else` on a nested `Show`, `Switch`, `For`, `Repeat`,
  `Provider`, fragment, text, or inline component are wrapped in a `<block>`
  instead of being dropped.
- Conditional and fallback bindings are guarded with the branch condition, so
  `{user().name}` inside `<Show when={user()}>` does not read `null` before the
  branch is active. `For fallback`, `Repeat fallback`, `Switch fallback`, and
  non-keyed `Show` / `Match` callbacks use the same guard.
- Raw JSX values in expressions, component props, and dynamic spread are a
  compile error. Use a JSX branch, `children`, or a component boundary.
- Event handlers reconstruct loop values from expressions that exist in JS;
  hoisted `bN` data keys are never referenced from a handler. Nested defaults
  use `__glazeIndex`, `__glazeIndex1`, and so on, so two `<For>`s without an
  index parameter no longer collide.
- Component custom events inside `For` carry `data-glaze-index` markers just
  like native events.
- Numeric component props are emitted as `{{3}}`, not `"3"`; string props stay
  strings.
- `export const` and `export function` declarations are kept in generated
  modules; only the default component export is removed.
- Solid 2 `<Theme value="...">` is recognized as a provider as well as the
  legacy `<Theme.Provider>`. Providers inside `For` / `Show` / `Match` are a
  compile error because there is no per-row provider scope.
- Text whitespace is collapsed per JSX rules instead of a global `trim()`;
  `{` / `}` in literal text are escaped for WXML, and static style objects are
  normalized from camelCase to kebab-case.
- A `ref` inside `For` / `Show` / `Match` is a compile error until per-row node
  queries exist. Unknown native events and `innerHTML` / `textContent` are also
  compile errors.
- A `<For>` without a key emits no `wx:key` rather than `*this`: glass-easel
  stringifies object items to `"[object Object]"`, which is worse than
  position-based reuse. Pass `keyed={(item) => item.id}` for keyed object lists.
- Component props may not lowercase to `b0`, `b1`, ...; the runtime also rejects
  a property that collides with a generated binding key.

Build-side safety (path validation, staging, reachable-only compilation,
helper imports, name collisions, WXSS `@import`, static pages, style isolation,
bundle size) is documented in `docs/build.md`.

### Validation for this wave

Run on 2026-11-23 in the repository workspace:

- `pnpm -r test` — compiler 197 passed, build 120 passed, runtime 90 passed, shared 2 passed.
- `pnpm build` — `9 pages, 20 components`.
- `target/debug/minidev test --project examples/solid-todo --browser
  ~/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell`
  — 9 cases passed, 0 failed (about 43 s). The counter e2e covers nested
  loops, component events, keyed/non-keyed control flow, context, refs and list
  insert/append/delete. The reactive e2e covers a Solid 2 `createStore` with
  nested objects and arrays, `createMemo`, object-signal replacement, keyed
  `For` over a store array, nested row fields and `Show` driven by a nested
  store path. The Tailwind e2e covers escaped WXML classes and computed
  `font-size`/`padding-top` on the real page.

The simulator still prints `wx:key` performance warnings for the intentional
`keyed={false}` and keyless object-list examples; they are warnings, not
rendering failures, and the reasoning is recorded above.

### Expression and attribute hardening

- Inline expressions in loop attributes are emitted with single-quoted string
  literals. Any remaining double quote (inside string content, regex or template
  text) becomes `\u0022`, because WXML attribute values themselves are
  double-quoted.
- Generated event wrappers use `__glazeEvent`, so a loop item or callback
  parameter named `event` cannot produce a duplicate `const event`.
- `data-glaze-index*` is reserved for loop index restoration; a user-provided
  attribute with the same name is a compile error.
- Boolean expression children are wrapped in the runtime `textValue` helper;
  WXML would otherwise render the strings `true` / `false`, while Solid renders
  nothing.
- Template literals that depend on a loop value are rejected with a readable
  error instead of crashing Babel's generator.
- A `ref` inside `Show`, `Switch`, `Match` or their fallbacks is rejected, not
  silently measured once.
- `useContext` is collected from the whole function body, including JSX, so a
  context read in JSX still crosses a component boundary.
- Solid control-flow tags are only treated as built-ins when they are imported
  from `solid-js` (or not imported at all for backward compatibility); a local
  `Show`/`Switch` import is compiled as a normal component.
- JSX text normalization trims indentation on the first and last non-empty
  lines without removing intentional spaces around expressions.

### Component and attribute edge restrictions

These restrictions keep the generated WXML unambiguous; each one is a compile
error or a documented rewrite rather than a silent fallback:

- **Component events vs native events.** A component event prop whose name is
  also a native event prop (`onChange`, `onTap`, `onInput`, `onScrollToLower`,
  ...) is rejected, because a bubbling native event can hit the same handler.
  Rename the custom event, e.g. `onPickChange`.
- **`props.class` / `props.style`.** Reading either member inside a component
  body is rejected. Class and style are not delivered across Glaze component
  boundaries; style the component host or pass an explicit prop.
- **`data-*` / `aria-*` on component tags.** These attributes pass through to
  the component host element and never become props or custom events.
- **Boolean text inside loops.** A booleanish expression child inside `For` /
  `Show` / `Repeat` is rendered through the `glazeValue` WXS helper, which
  returns `''` for `true` / `false`. Root-level bindings keep using the runtime
  `textValue` helper for the same result.
- **Built-in tag names.** A component whose kebab-case name equals a built-in
  WXML tag (`View` → `view`, `Label` → `label`, `ScrollView` →
  `scroll-view`, ...) is rejected; rename the component.
- **`children` prop.** Passing an explicit `children` attribute on a component
  tag is rejected. Pass children as JSX children instead.
- **`ref` with `id`.** Static spread attributes are expanded before the check,
  so `{...{ id: 'x' }}` together with `ref` is rejected with the same duplicate
  id error as an explicit `id`.
- **Local control names.** A local `function Show` / `const Show` declaration
  (and the other control-flow names) is compiled as a component reference, not
  as the Solid built-in. Only an import from `solid-js`, or an unresolved name
  for backward compatibility, selects the built-in.
- **Native attribute names.** CamelCase attributes on native elements are
  converted to kebab-case (`hoverClass` → `hover-class`, `dataSet` →
  `data-set`); already hyphenated names stay unchanged. Component props keep
  their existing lowercase WXML property mapping.
- **`<For key="...">`.** A string key must be a single field name. A dotted or
  indexed path such as `key="row.id"` is rejected; use
  `keyed={(item) => item.id}` for a stable key.
