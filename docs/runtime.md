# Runtime edge behavior

This document records the async-boundary and list-diff fixes in
`packages/runtime/src`. They are behavior fixes on top of the existing runtime;
no new architecture was introduced.

## Direction

`defineGlazeComponent` already tracked pending/errored bindings per async
boundary and diffed keyed lists. Four gaps remained around the edges:

- error logging suppressed whenever a component declared `errorBoundary`;
- a manual `NotReadyError` thrown after a binding had already committed did not
  turn Loading back on;
- shared error sources needed regression coverage rather than another mechanism;
- primitive rows could take the keyed-list diff path.

The fixes stay inside `mini.ts` and `list.ts` and add focused tests in
`test/mini.test.ts`.

## Implementation details

### Error logging follows the actual binding boundary

`reportError(state, index, error)` now checks
`state.bindingBoundaries[index]`. A binding with an async boundary surfaces
failures through the Errored state and stays quiet; a binding without one has no
channel, so it still logs through `reportBindingError`. The per-component
`config.errorBoundary` flag was removed; the per-binding boundary id is now the
only suppression condition. Every call site passes the instance state: the
initial mount pass, the memo-backed boundary effect, and the scalar/list binding
effects.

### Committed bindings become probeable for `isPending`

The per-boundary status effect probes `isPending` only for bindings in
`state.settled`, because a memo that has never produced a value cannot answer
the probe. `settled` used to be set only by `applyBinding`, but the first effect
run returns early for values already sent by mount, so a committed boundary
binding stayed unsettled.

`mount` now sets `state.settled[index] = true` when the initial call returns a
value for a boundary binding. After that, a manual `NotReadyError` flips the
memo's pending state, the status effect re-runs through `isPending`, and Loading
becomes true. The next committed value clears it. Initial pending still goes
through `markAsync`'s error channel.

### Shared error sources

`sourceKey` keeps deduping by `error.source`. Two bindings that report the same
source share one entry in `errorValues`/`errorBindings`; `Errored` and
`errorArray` observe that entry. The boundary value signal is only rewritten
when the normalized name or message changes, so a retry with a new message
updates observers without extra signal churn. The regression test checks one
entry, the latest message after a retry, and prompt completion (no flush loop).

### Detach and re-attach

No runtime change was needed here. `detached` disposes the root and drops event
and ref callbacks; `attached` mounts a fresh root and rebuilds handlers, memos,
status projections and effects. The existing context-component test exercises a
boundary-context component across detach/attach and asserts setup ran twice, the
event handler works again, and a memo-backed binding recomputes.

### Row snapshots and in-place mutation

A list binding used to keep `array.slice()`, which preserves the same row
objects. `items[0].done = true` followed by `setItems([...items])` therefore
compared the mutated row against itself and produced no patch. `snapshotList`
now clones each object row deeply, so a direct field mutation and a nested
field mutation are both visible to `listPatch` and become a field path. Only the
changed top-level field is sent: the path still stops at the row field, and a
nested object value travels whole. Prototype-less data and cycles are handled;
class instances beyond arrays, dates and regular expressions are copied as plain
objects, so replace such a row instead of mutating it.

### List view-model projection

`listFields` metadata from the compiler is applied by `projectList` in
`list.ts`. `applyBinding` projects before `listPatch` / `listOps`, and `mount`
projects before the initial `setData`; `state.previous` and the data copy both
hold a detached projection. The projection only copies the recorded top-level
fields and always keeps the key.

The event path is unchanged: `scope.jsSource` still indexes the original
application array, so a row handler sees fields that are not rendered. If any
row is a primitive, array, class instance, `Date`, `RegExp` or another
non-plain object, `projectList` returns the original array instead. That keeps
the optimization from changing list semantics.

The fine benchmark's initial list payload drops from 10,270,281 bytes to
215,281 bytes; the 5000 rows keep `id`, `title` and `done`, and the unused 2 KB
`extra` field is absent from component data. Minidev's first-render timer is
dominated by WXML node creation, so this does not produce a large wall-clock
change in the simulator; the payload reduction is measured directly on the
generated data object.

### Initial list data must not alias app state

The platform applies `replaceDataOnPath` by mutating the component data object
in place. When the runtime `setData`s generated `bN` keys, glass-easel stores the
array reference directly for those new data fields, so a later field patch such
as `['b0', 0, 'title']` would also mutate the signal's source array. Re-entering
the page then started from data already changed by the previous run.

`mount` now sends a fresh `snapshotList` copy for every list binding. The initial
pass already snapshots the value for diffing, so this is one extra copy per list
binding at mount; update paths are unchanged. The regression test
`initial list data is detached from the source array` mutates the data copy and
asserts the source row is untouched.

The same rule now holds for every list update, not only the initial write.
`materialize` builds a detached payload for `*this` and unkeyed lists too, and
keeps a second snapshot as the diff baseline. See
[`runtime-transport.md`](runtime-transport.md).

### Loading on and Errored reset

`ctx.loadingOn(boundary, read)` creates a runtime effect for the `on`
dependency. After the first run, a change calls `armLoading`, which shows the
fallback only if a binding under that boundary is actually pending. This is the
closest match to the miniature-program frame model: there is no held frame, so
an `on` change with nothing pending does not fabricate a spinner.

`ctx.reset(boundary)` clears the boundary's pending and error maps, writes the
status signals, then bumps a per-boundary reset signal. Every binding memo reads
that signal, so reset retries failed expressions even when their ordinary
dependencies did not change. The `Errored` fallback receives a generated reset
function; the compiler rewrites the fallback parameter to a setup constant that
calls `ctx.reset`.

### Async boundary kinds

A binding stores two boundary ids: the nearest `Loading` and the nearest
`Errored`. Pending uses the loading id; failures and `Errored` values use the
error id. That is what lets an outer `Errored` catch a failure inside an inner
`Loading`, and an outer `Loading` show pending work inside an inner `Errored`,
while same-kind nesting still follows the nearest boundary.

### Context readers

`withProvider` accepts an optional `read` callback and wraps it in a context
reader. `withBoundaryContexts` passes a reader for each context key, so a child
sees later provider values without remounting. The compiler routes every
generated `useContext` through `ctx.context`, which returns the reader (or wraps
a default value in one). Object and primitive context values therefore behave
the same; destructuring still snapshots the current value.

### Primitive list rows

`listOps` returns `null` when either array contains a non-object item, and
`listPatch` already rejected primitive rows. `applyBinding` treats `null` as a
whole-array replacement, which is the only unambiguous result when rows have no
key to align on. `key === '*this'` continues to return `null` from both helpers.
The tests cover `[1, 2] -> [1, 3]` and `[1, 2] -> [2, 1]` at the helper and
runtime levels.

### Runtime state models

The per-instance state is split across three modules used by `mini.ts`:

- `state.ts` owns `core.bindings`, a sparse `BindingList`. Each `BindingState`
  keeps `raw` (the direct read), `read` (the effect source, memo-unwrapped),
  `memo`, `initial` (raw mount value), `previous` (projected baseline),
  `settled`, both boundary ids, `source` and `fallbackSource`. Mount resets
  entries in place with `resetBindingStates` and never compacts the list;
  iterations skip entries whose `raw`/`read` is null.
- `boundary.ts` owns the boundary-keyed pending/consumer/error maps and the
  lazily created loading/errored/error-value/reset signals plus `loadingOn`.
  `markPending`, `markSettled`, `markError`, `clearError` and `resetBoundary`
  replace the former inline map/signal code. `clearBoundaryContent` is the
  remount reset and keeps signal and reset-counter identity.
- `lifecycle.ts` replaces `mounted`/`active`/`everMounted` with
  `unmounted | waiting-context | mounted | attached | detached`.
  `waiting-context` carries `attachedBeforeMount`, because the platform's
  `attached` can run before a deferred root exists. The phase tracks platform
  attachment, not installed effects: `ready` always mounts and attaches, so a
  `mounted` phase can already have effects.

`schedule` still flushes only when the platform is attached (phase `attached`,
or `waiting-context` with `attachedBeforeMount`), matching the old `active`
flag. `applyBinding` ignores a projection for an index with no binding yet;
this only matters for a deferred `attached` event followed by `ready` later in
the same tick, where the projection is rerun after mount and component data is
unchanged.

### Mini-program lifecycle mapping

Glass-easel component lifetimes are the only platform hooks the runtime
subscribes to. The mapping is:

| Platform | Runtime behavior |
| --- | --- |
| `created` | Create `InstanceState`, prop signals and the props proxy. A non-deferred component mounts its Solid root here. |
| `attached` | Deferred context: record `attachedBeforeMount` only. Normal: install effects. After `detached`: rebuild the root, then install effects. |
| `ready` | Deferred context: build the root and install effects once. Already rooted: no-op. After `detached`: ignored, so a late ready cannot revive a detached root. |
| `moved` | Keep the same root and signals, then notify `onComponentMoved` / `ctx.onComponentMoved` handlers. |
| `beforeDetach` | Notify `onBeforeDetach` / `ctx.onBeforeDetach` handlers while the root is still alive. Teardown still happens at `detached`; glass-easel detaches children first, so a parent's `onCleanup` runs after its child components are already detached. |
| `detached` | Dispose the Solid root, clear pending writes, events/refs, error handlers, page handlers, page-channel subscriptions and status projection, and move to the `detached` phase. |
| `error` | Store the error in `state.error` and notify every `ctx.onComponentError` handler. Binding failures now use the same observer in addition to their `Errored` channel. |
| `pageLifetimes` (`show`, `hide`, `resize`, `routeDone`) | Drive `ctx.pageVisible()`, `ctx.pageSize()` and the `routeDone` page event; `pageSize` is seeded from `wx.getWindowInfo()` when available. |

Page-level events that are not component page lifetimes (`onPageScroll`, share
callbacks, `onPullDownRefresh`, `onReachBottom`, `onTabItemTap`,
`onSaveExitState`) are forwarded by the generated page wrapper to the root
component's `__glazePageEvent` method when a compiled source references them.
The wrapper caches the root component once `selectComponent('#app')` succeeds.

### Page context channel

When a page or any component uses `usePageOptions`, `usePageEvent` or
`onPageEvent`, the build marks the page and every boundary on the path to that
component as `pageContext`. The page wrapper then owns a per-instance id and
query and passes them to the root as one object property:

```xml
<glaze-page id="app" glazepage="{{__glazePage}}" />
```

The runtime registers every page-context component under that page id. Page
events are stored in one `PageChannel` per id, so a child component observes
`usePageEvent('scroll')` without receiving a copy of page state and pages in the
navigation stack cannot see each other's events. The id is generated in
`onLoad`, so a component that mounts before it can still subscribe; the read
waits on the `glazepage` property and joins the channel when the id arrives.
Only components on the path to a page hook receive the property; unrelated
boundaries keep the old shape. A page root removes its channel at `detached`.

The channel deliberately does not call `getCurrentPages()`: the top page is
ambiguous while several pages are alive and would route a hidden page's event
to the visible one.

### Page visibility, page events and component errors

Page-level state is exposed through setup-only hooks, so normal TSX
components do not need the generated `ctx` object. The project must declare
`@glaze/runtime` as a dependency when it imports these hooks.

```tsx
import { createEffect } from 'solid-js'
import {
  onAppError,
  onAppHide,
  onAppShow,
  onComponentError,
  onPageEvent,
  onUnhandledRejection,
  useAppVisible,
  useLaunchOptions,
  usePageEvent,
  usePageOptions,
  usePageSize,
  usePageVisible,
} from '@glaze/runtime'

export default function Page() {
  const pageVisible = usePageVisible()
  const pageSize = usePageSize()
  const appVisible = useAppVisible()
  const options = usePageOptions()
  const scroll = usePageEvent('scroll')

  createEffect(() => {
    if (!pageVisible() || !appVisible()) pauseTimers()
  })
  createEffect(() => {
    const size = pageSize()
    if (size) layout(size.windowWidth, size.windowHeight)
  })
  createEffect(() => {
    const page = options()
    if (page) trackPageQuery(page.query)
  })
  createEffect(() => {
    const event = scroll()
    if (event) trackScroll(event.scrollTop)
  })
  onPageEvent('shareAppMessage', () => ({ title: 'Glaze page' }))
  onComponentError((error) => reportToTelemetry(error))

  return <view>...</view>
}
```

Hand-written `defineGlazeComponent` components use the same values as
`ctx.pageVisible()`, `ctx.pageSize()`, `ctx.appVisible()`,
`ctx.pageOptions()`, `ctx.appLaunchOptions()`, `ctx.onAppShow(handler)`,
`ctx.onAppHide(handler)`, `ctx.onAppError(handler)`,
`ctx.onUnhandledRejection(handler)`, `ctx.pageEvent(name)`,
`ctx.onPageEvent(name, handler)`, `ctx.onComponentError(handler)`,
`ctx.onComponentMoved(handler)` and `ctx.onBeforeDetach(handler)`.

- `usePageVisible()` starts `true`, then follows `pageLifetimes.hide` and
  `pageLifetimes.show`.
- `usePageSize()` is the last `pageLifetimes.resize` payload, seeded at
  creation from `wx.getWindowInfo()`; it is `null` when neither is available.
- `useAppVisible()` follows `wx.onAppShow` / `wx.onAppHide`; the listeners are
  installed once per `wx` object on first use, and the value starts `true`.
- `useLaunchOptions()` returns the immutable options captured from
  `wx.getLaunchOptionsSync()`; it is `undefined` when the base library does not
  expose that API. `onAppShow` receives the show options separately.
- `onAppShow(handler)` / `onAppHide(handler)` run on `wx.onAppShow` /
  `wx.onAppHide`; `onAppError(handler)` and `onUnhandledRejection(handler)`
  bridge `wx.onError` / `wx.onUnhandledRejection`. Their unsubscribe functions
  are also run when the component root is disposed.
  `onUnhandledRejection` receives `event.reason` when present.
- `usePageOptions()` returns the owning page's `{ id, query }` when the
  component is inside a page-context subtree; it is `undefined` otherwise.
  Query values come from the page wrapper's `onLoad(query)`.
- `usePageEvent(name)` reads the latest payload of a page event. The event
  names are `scroll`, `shareAppMessage`, `shareTimeline`, `addToFavorites`,
  `tabItemTap`, `saveExitState`, `pullDownRefresh`, `reachBottom` and
  `routeDone`. Page-context components share the page's channel, so a child
  can read the event directly.
- `onPageEvent(name, handler)` returns an unsubscribe function. Its return
  value is forwarded for page methods that expect one (`onShareAppMessage`,
  `onShareTimeline`, `onAddToFavorites`, `onSaveExitState`). The channel is
  shared across the page-context subtree; `routeDone` also continues to reach
  every component through `pageLifetimes`.
- `onComponentError(handler)` receives glass-easel errors and binding failures;
  binding failures also keep their `Errored` channel.
- `onComponentMoved(handler)` runs when the component is moved in the node tree;
  the root and signals are not rebuilt.
- `onBeforeDetach(handler)` runs before the root is disposed.
- Hooks must be called during `setup`; calling them from an event handler or a
  later effect throws.
- Handlers are cleared when the root is rebuilt or detached; register them in
  setup beside the effects that use them.

The real glass-easel tests cover the normal `attached` -> `ready` order,
`ready` before `attached`, `detached` before `ready` (no late mount),
`detached` -> `attached` -> `ready` (rebuild once), a `moved` component keeping
its root and firing its hook, `beforeDetach`, `routeDone`, page resize, and the
error lifetime.

### Replaced error sources release the old consumer

`binding.source` remembers the last source this binding reported. When a later
failure resolves to a different source, `markAsync` clears the binding's
consumer for the old source before registering the new one. Without that, the
old source kept its consumer after the new source recovered and `Errored`
stayed true (A -> B -> success). Status is re-projected only when the boundary
had consumers before the clear, and the new-source registration keeps its own
projection; the test asserts `errored` and `error` are false/null after
recovery.

### Effects install once per root

`InstanceState.effectsInstalled` guards `attach`. `ready` before the platform's
`attached` mounts and installs effects while the phase is still `mounted`; the
later `attached` still advances the phase to `attached` but skips a second set
of binding effects. `attach` also returns early when there is no root or owner,
so the `waiting-context` attach (before `ready`) cannot count as installed. The
flag resets in `mount` and on `detached`, so a rebuilt root installs a fresh set
once. The regression test updates one signal after `ready` + `attached` and
asserts the binding read ran once.

### Config validation

`defineGlazeComponent` validates the generated config before it builds any
state. It rejects names that collide after lowercasing, `propSignals` entries
that are not declared properties (including the internal `glazeprops` and
`glazecontext` names when structured props or boundary contexts are in use), a
non-positive `bindingGroupSize`, a negative `handlerCount`, malformed
`listBindings`/`listFields` pairs, and invalid `asyncStatus` indexes, boundaries
or kinds. These are all cases where the old runtime would silently build the
wrong signal set or skip a generated feature.

## Trade-offs

- Logging no longer reads a component-wide flag. `config.errorBoundary` is
  gone from the contract; behavior derives from each binding's boundary id,
  which is what distinguishes mixed components.
- `settled` is established at mount instead of removing the guard in the status
  effect. Probing an uninitialized memo can suspend instead of answering false,
  so the guard is required.
- The primitive guard scans each array once. That is negligible next to a list
  splice and prevents ambiguous ops for rows that cannot be keyed.
- The generated page wrapper defines only the methods whose event names appear
  in compiled sources; a dynamic or aliased hook enables the full set. Share
  methods therefore enable the share menu only on pages that register them.
- App visibility uses one module-level signal per runtime copy and `wx.onAppShow`
  / `wx.onAppHide`; there is no per-page app listener.

## Validation

```
pnpm --filter @glaze/runtime test
# tests 186, pass 186, fail 0
pnpm --filter @glaze/runtime typecheck
# tsc --noEmit -p tsconfig.json (no output)
pnpm --filter @glaze/build test
# tests 121, pass 121, fail 0
cd examples/solid-todo && pnpm build
# glaze build: 17 pages, 31 components
# minidev e2e: 10 cases, 10 passed (the context case scrolls and asserts the root sees the page event)
```
