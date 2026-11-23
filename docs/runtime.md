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
channel, so it still logs through `reportBindingError`. `config.errorBoundary`
is no longer used as a blanket suppression flag. Every call site passes the
instance state: the initial mount pass, the memo-backed boundary effect, and the
scalar/list binding effects.

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
now copies each object row one level deep, so a direct field mutation is visible
to `listPatch` and becomes a field path. Nested objects still require replacing
the row object; copying arbitrarily deep data on every binding would cost more
than the update it detects.

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

### Context value proxy

`withProvider` accepts an optional `read` callback. Object values are wrapped in
a proxy whose property reads call `read`, so a child sees later provider values
without remounting. `withBoundaryContexts` accepts either an object or an
accessor and passes a matching reader for each context key. Primitive values are
captured at mount because a proxy cannot preserve primitive identity.

### Primitive list rows

`listOps` returns `null` when either array contains a non-object item, and
`listPatch` already rejected primitive rows. `applyBinding` treats `null` as a
whole-array replacement, which is the only unambiguous result when rows have no
key to align on. `key === '*this'` continues to return `null` from both helpers.
The tests cover `[1, 2] -> [1, 3]` and `[1, 2] -> [2, 1]` at the helper and
runtime levels.

## Trade-offs

- Logging no longer reads `config.errorBoundary`. The field stays in the config
  type because the compiler emits it; behavior now derives from each binding's
  boundary id, which is what distinguishes mixed components.
- `settled` is established at mount instead of removing the guard in the status
  effect. Probing an uninitialized memo can suspend instead of answering false,
  so the guard is required.
- The primitive guard scans each array once. That is negligible next to a list
  splice and prevents ambiguous ops for rows that cannot be keyed.

## Validation

```
pnpm --filter @glaze/runtime test
# tests 100, pass 100, fail 0
pnpm --filter @glaze/runtime typecheck
# tsc --noEmit -p tsconfig.json (no output)
```

The full repository suite and minidev e2e were run after this change (468 unit
tests plus 9 e2e cases, all passing).
