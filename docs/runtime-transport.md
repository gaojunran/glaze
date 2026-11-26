# Runtime data transport and materialization

This document covers the transport/materialization changes in
`packages/runtime/src` on branch `omos/runtime-transport` (base `9e37948`).
The async-boundary and lifetime code is out of scope and was not changed.

## Direction

Three problems sat on the path from a binding to component data:

1. `applyPending` re-probed the component's capability on every scheduled
   commit, and
   the list decision used `typeof component.spliceArrayDataOnPath`. A component
   with that method but no `groupUpdates`/data proxy emitted a splice that the
   final `setData` filter silently removed.
2. `applyBinding` only snapshotted a list payload when `listFields` existed.
   `*this` and unkeyed lists never emit `listFields` (the compiler sets it to
   `null`), so their whole-array update was the application array itself. The
   platform mutates component data in place, so that array accumulated the
   previous page's edits.
3. `flush` cleared `pending`/`flushScheduled` and then called the transport with
   no `try`/`catch`; a throwing transport lost the batch with no report.

The fix keeps the transport adapter in a closure and adds one new module
(`transport.ts`), so `types.ts` and the lifetime block stay untouched.

## DataTransport

`createDataTransport(component)` resolves the capability once per `attach` and
returns:

```ts
type DataTransport = {
  readonly canSplice: boolean
  readonly kind: 'data-group' | 'grouped' | 'page-path' | 'set-data'
  apply(changes: readonly DataChange[]): void
}
```

Resolution order and splice capability:

| Rank | Transport | Detected by | `canSplice` |
| --- | --- | --- | --- |
| 1 | `data-group` | `Component.getDataProxy(component)` or `component._$dataGroup` with `getChanges`/`setChanges`/`applyDataUpdates` | yes |
| 2 | `grouped` | `groupUpdates` plus `replaceDataOnPath` and/or `spliceArrayDataOnPath` | yes only when both path APIs exist |
| 3 | `page-path` | page root with `replaceDataOnPath` + `applyDataUpdates`, without `groupUpdates` | no |
| 4 | `set-data` | plain `setData` | no |

`canSplice` means "a splice can safely be chosen for this change batch", not
"the component happens to expose `spliceArrayDataOnPath`". `applyBinding`
therefore asks `transport.canSplice` and falls back to the whole value when it
is false. `apply` still validates defensively: a splice handed to a transport
with no splice API at all throws
`[glaze] data transport cannot commit a splice; send the whole value instead`
instead of being filtered out. The grouped path validates before calling
`groupUpdates`, so a rejected change cannot leave a partially queued update.

A grouped transport with `spliceArrayDataOnPath` but no `replaceDataOnPath`
splices inside the group and defers replacements to `setData` afterwards. A
mixed batch (whole-list replacement plus insert) would then lose the splice, so
`canSplice` stays false there; `apply` can still commit a lone splice, but
`diffList` chooses the whole-value path for structural changes.

The `page-path` transport is selected only for page roots (the `pageRoot` state
set by `defineGlazePage`). It schedules up to 64 replaces on the path API and
flushes once with `applyDataUpdates()`; a larger batch falls back to one
`setData` payload, because one call per path costs more than a batched payload
at high fan-out. It never accepts a splice, so a structural list change falls
back to a whole-value replace.

The data-group path keeps another writer's queued changes and appends the
runtime's entries in glass-easel's own tuple format
(`[path, value, undefined, undefined]`, `[path, inserts, index, del]`). All
methods are called on their original receiver (`group`, or `component`).

### Commit scheduling

`mini.ts` collects changes in `state.pending` and asks `createFrameScheduler`
to flush them. The scheduler reaches the view-side `requestAnimationFrame`
through glass-easel's `setData` callback (or directly exposed backend);
otherwise it uses a microtask. This is upstream of the transport: the transport
still sees one batch per frame and keeps its own capability order.

## Materialization

`materialize(index, value)` returns `{ payload, baseline }`:

- Scalar binding: `payload` is `normalizeDataValue(value)`, `baseline` is the
  raw applied value, which is what the unchanged-value check in `applyBinding`
  compares against.
- List binding: the value is projected with the existing `listFields` rule
  (the key is always kept, `*this` is not projected). `payload` and `baseline`
  are independent `snapshotList` copies when the payload can share a nested
  reference with the source. If projection produced fresh plain rows and every
  field is primitive, `payload` reuses those rows and only `baseline` is
  snapshotted; the platform can mutate the payload without reaching either the
  source or the baseline.
- `*this` list: no projection, no patch and no splice (`listPatch`/`listOps`
  return `null` for the whole-list key), but the payload is still a detached
  snapshot.
- Non-plain rows keep the existing `projectList` fallback: the original value
  is used, never a JSON clone. `snapshotList` still copies object rows.
- Event handlers keep reading the original application row through the
  existing source path; nothing on the event path changed.

The `*this` alias bug is confirmed, not just suspected. Against base `9e37948`
the update payload is reference-equal to the signal's array:

```
AssertionError: Expected "actual" not to be reference-equal to "expected"
```

`test/transport.test.ts` now covers `*this` and an unkeyed/keyed list without
`listFields`; both assert the payload and rows are distinct from the source and
that mutating the payload leaves the application array unchanged.

Cost: nested values and the `projectList` fallback still take two deep
snapshots. A flat projected list takes one baseline snapshot and reuses the
projected rows as payload; that saves the second deep copy without changing the
bytes sent to the platform.

## Flush failures

`flush` clears `pending` and `flushScheduled` before applying, and
`applyBinding` advances `state.previous` when the change is scheduled. A
transport failure is therefore intentionally **not replayed**: replaying would
re-apply changes that may already have been committed. The catch sets
`state.error`, logs through `reportTransportError`, and replaces the baseline of
every binding in the failed batch with an invalid-baseline sentinel. The next
change for those bindings sends the whole value instead of diffing against a
value the platform never received. It deliberately does not call `markAsync` or
touch loading/error boundaries. The regression test makes `applyDataUpdates`
throw once, then asserts the next list update is a whole-value tuple rather
than a splice based on the uncommitted baseline.

## List helpers

- `diffList(previous, next, key, binding, canSplice)` owns the
  patch → splice → `null` decision; `applyBinding` uses `null` to send the whole
  value. `listPatch` and `listOps` remain separate algorithms. A splice only
  carries inserted rows, so `diffList` also deep-compares every retained
  prefix/suffix row with the existing `equalValue` helper; any changed retained
  row falls back to the whole value.
- `listOps` returns `ListOp | null` (it only ever produced one operation).
- `listPatch` reuses one `WeakMap` comparison cache per call instead of
  allocating one per field; a separate recursion stack handles leaf diffs.
  Same-shape plain objects and arrays are descended to the changed leaf; a
  changed shape, a class value or `__proto__` key falls back to the whole
  field. A failed descent discards its partial leaves and emits one field path.
- `cloneValue` now documents its supported inputs: primitives, arrays, `Date`,
  `RegExp`, plain objects and cycles. Any other object, including `Map`, `Set`
  and `TypedArray`, is copied by enumerable own keys, so a `Map`/`Set` flattens
  to `{}`. List rows should stay plain data (or be replaced whole). No JSON
  clone was introduced.

`data.ts` was not split into smaller modules: it is 26 lines, and the transport
work had higher value.

## Validation

```
pnpm --filter @glaze/runtime test
# tests 211, pass 211, fail 0
pnpm --filter @glaze/runtime typecheck
# tsc --noEmit -p tsconfig.json, exit 0
pnpm --filter @glaze/build test
# tests 120, pass 120, fail 0
```

Capability combinations covered by `test/transport.test.ts`:

| Combination | Covered by |
| --- | --- |
| full data proxy | DataGroup queue/tuple/receiver test |
| group + replace only | replace applied; splice rejected before grouping |
| group + splice only | lone splice committed; `canSplice` false, so whole-value diff |
| group + replace + splice | both path APIs used; mixed batch keeps group order |
| no path APIs | `setData` with `dataKey`; splice rejected |
| splice API without group/proxy | runtime sends the whole list, no silent drop |

Minidev e2e was not run in this lane; integration runs later.
