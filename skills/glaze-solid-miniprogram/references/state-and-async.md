# State, lists and async

Glaze uses Solid 2 reactivity. There is no component re-render function and no
virtual DOM; a signal write schedules the generated binding effects.

## Signals and memos

```tsx
import { createMemo, createSignal } from 'solid-js'

const [count, setCount] = createSignal(0)
const [name, setName] = createSignal('Ada')
const doubled = createMemo(() => count() * 2)

<text>{name()}: {doubled()}</text>
<button onClick={() => setCount((value) => value + 1)}>plus</button>
```

- Read by calling: `count()`.
- Use the updater form in bursts. `setCount(count() + 1)` reads the old value in
  a burst of taps and can only increment once.
- Do not write to a signal inside a memo/effect computation. Write from event
  handlers or other explicit actions.
- Use `createMemo` for derived values and for async derivations; it is the
  primitive that `<Loading>` understands.

## Lifecycle

```tsx
import { onCleanup, onSettled } from 'solid-js'

onSettled(() => {
  // runs after the component has mounted
  return () => {
    // optional cleanup; or use onCleanup
  }
})
```

- Prefer `onSettled` in Solid 2; do not use React `useEffect`.
- `createEffect(compute, apply)` takes a tracking compute and an apply function;
  do not put writes in the compute.
- Keep timers/listeners paired with `onCleanup` so a detached component does
  not keep them alive.

## Page, app and component lifecycle

```tsx
import { createEffect } from 'solid-js'
import {
  onBeforeDetach,
  onComponentError,
  onComponentMoved,
  onPageEvent,
  useAppVisible,
  usePageEvent,
  usePageSize,
  usePageVisible,
} from '@glaze/runtime'

const pageVisible = usePageVisible()
const pageSize = usePageSize()
const appVisible = useAppVisible()
const scroll = usePageEvent('scroll')

createEffect(() => {
  if (!pageVisible() || !appVisible()) pauseTimers()
})
createEffect(() => {
  const size = pageSize()
  if (size) layout(size.windowWidth, size.windowHeight)
})
createEffect(() => {
  const event = scroll()
  if (event) trackScroll(event.scrollTop)
})
onPageEvent('shareAppMessage', () => ({ title: 'Glaze page' }))
onComponentError((error) => reportToTelemetry(error))
onComponentMoved(() => relayout())
onBeforeDetach(() => saveDraft())
```

- Add `@glaze/runtime` to the project dependencies when importing these
  hooks; it is the same runtime the build shares at run time.
- Call these hooks during component setup, not later in an event handler or
  effect; later calls throw.
- `usePageVisible()` starts `true` and follows page show/hide.
- `usePageSize()` is the latest resize size, seeded from `wx.getWindowInfo()`;
  it can be `null` on an unsupported base library.
- `useAppVisible()` follows `wx.onAppShow` / `wx.onAppHide`; it starts `true`.
- `usePageEvent(name)` reads the latest page event. Names: `scroll`,
  `shareAppMessage`, `shareTimeline`, `addToFavorites`, `tabItemTap`,
  `saveExitState`, `pullDownRefresh`, `reachBottom`, `routeDone`. The generated
  page wrapper forwards these; do not add `Page.onPageScroll` yourself.
- `onPageEvent(name, handler)` returns an unsubscribe function. Return a value
  for share/favorite/save hooks; it is forwarded to the platform. Page events
  reach the page root; pass values to child components via props or context
  (`routeDone` reaches every component through `pageLifetimes`).
- `onComponentError` receives lifecycle, event and binding failures; binding
  failures still also use `Loading`/`Errored`. The returned function
  unsubscribes.
- `onComponentMoved` runs on a node-tree move; `onBeforeDetach` runs before the
  root is disposed (useful for synchronous draft saves).

## Stores

```tsx
import { createStore } from 'solid-js'

const [state, setState] = createStore({
  user: { name: 'Ada', address: { city: 'London' } },
  rows: [{ id: 1, title: 'one', done: false }],
})

setState((prev) => ({ ...prev, user: { ...prev.user, name: 'Grace' } }))
```

- Import `createStore` from `solid-js`; `solid-js/store` does not exist in this
  target.
- Replace the changed object/array shape. A store path is read reactively in
  JSX (`state.user.name`), but a signal binding still needs a derived read when
  the whole value is used as a unit.
- `omit(props, ...)` is supported on the props Proxy; `splitProps` does not
  exist in Solid 2.

## Lists and updates

```tsx
<For each={todos()} keyed={(todo) => todo.id}>
  {(todo) => (
    <view class="row">
      <text>{todo().title}</text>
      <text>{todo().done ? 'done' : 'todo'}</text>
    </view>
  )}
</For>
```

- Use a stable `keyed` function for object lists. The runtime then sends field
  paths for unchanged key order (`b0[0].done`) and a single splice for
  insert/delete/middle replacement.
- `keyed={false}` is for primitive/positional rows and emits no `wx:key`.
- Treat list updates as immutable: replace the row object when a field changes.
  The runtime snapshots each row one level deep, so
  `items[0].done = true; setItems([...items])` is detected; mutating a nested
  object still is not.
- A `For` source that changes key order or length becomes a splice; there is no
  LIS move scheduler yet, so a full reverse sends one large middle splice.
- Do not call `.map()` in JSX. Build a derived array with `createMemo` if needed,
  then pass it to `<For>`.
- For a range, use `<Repeat count={n} from={start}>`.
- A `For` fallback is shown when the source is empty:
  ```tsx
  <For each={rows()} fallback={<text>empty</text>}>
    {(row) => <text>{row}</text>}
  </For>
  ```

## Async boundaries

```tsx
import { createMemo, Errored, Loading } from 'solid-js'

const profile = createMemo(async () => {
  const response = await fetchProfile()
  return response.name
})

<Loading fallback={<text>loading</text>}>
  <text>{profile()}</text>
</Loading>
```

- The compiler treats `Loading` and `Errored` as boundaries. Bindings inside a
  boundary are associated with their **nearest** boundary id.
- A pending read from `createMemo(async ...)` (or a memo throwing
  `NotReadyError`) shows the nearest `Loading` fallback. A real error shows the
  nearest `Errored` fallback.
- Nested boundaries are supported: an inner pending read shows the inner
  fallback without replacing the outer content. A boundary inside a loop is
  rejected.
- A failed binding is skipped rather than written as `undefined`, so one failed
  read does not clear another binding's value.
- Error objects crossing into WXML are normalized to `{ name, message }`.
  `error()` in an `Errored` fallback reads that normalized value.

### Loading on

`on` re-arms a loading boundary when a dependency changes:

```tsx
<Loading fallback={<text>loading</text>} on={route()}>
  <text>{profileForRoute()}</text>
</Loading>
```

- The expression is tracked. When it changes, the fallback is shown only if
  something under the boundary is actually pending.
- Glaze has no Solid held-frame behavior: an `on` change with nothing pending
  does not fabricate a spinner.
- Do not put `on` on `Errored`.

### Errored reset

```tsx
<Errored
  fallback={(error, reset) => (
    <view>
      <text>{error().message}</text>
      <button onClick={reset}>retry</button>
    </view>
  )}
>
  <text>{load()}</text>
</Errored>
```

- The fallback may take `(error)` or `(error, reset)`.
- `reset()` clears that boundary's pending/error state and retries the failed
  memo expressions, including an expression that failed on every attempt.
- The error accessor returns the normalized error value. Do not expect the
  original Error instance or stack in WXML.
- `Errored` requires a fallback. `Loading` may omit one, in which case its
  children are simply hidden while pending.

## What not to do for async

```tsx
// Wrong: React-style effect / resource state
const [loading, setLoading] = createSignal(false)
const [error, setError] = createSignal(null)
createEffect(() => { ... })

// Wrong: dynamic component / map result
{items().map((item) => <Row item={item} />)}
```

Use `createMemo` + `Loading`/`Errored`; use `<For>`; keep error/loading UI in
the boundary, not in ad-hoc booleans.

## Runtime timing

- Signal writes are batched per microtask. A single event that updates several
  signals produces one data flush.
- A burst of events that reads `count()` and writes `count() + 1` loses updates;
  use the functional setter.
- Assertions in tests need a tick/flush after a write; UI updates are not
  synchronous with the setter call.
