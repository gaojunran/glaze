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

## Trade-offs

- Logging no longer reads a component-wide flag. `config.errorBoundary` is
  gone from the contract; behavior derives from each binding's boundary id,
  which is what distinguishes mixed components.
- `settled` is established at mount instead of removing the guard in the status
  effect. Probing an uninitialized memo can suspend instead of answering false,
  so the guard is required.
- The primitive guard scans each array once. That is negligible next to a list
  splice and prevents ambiguous ops for rows that cannot be keyed.

## Validation

```
pnpm --filter @glaze/runtime test
# tests 162, pass 162, fail 0
pnpm --filter @glaze/runtime typecheck
# tsc --noEmit -p tsconfig.json (no output)
pnpm --filter @glaze/build test
# tests 120, pass 120, fail 0
cd examples/solid-todo && pnpm build
# glaze build: 17 pages, 31 components
```
