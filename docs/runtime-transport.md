# Runtime data transport and materialization

This document covers the transport/materialization changes in
`packages/runtime/src` on branch `omos/runtime-transport` (base `9e37948`).
The async-boundary and lifetime code is out of scope and was not changed.

## Direction

Three problems sat on the path from a binding to component data:

1. `applyPending` re-probed the component's capability on every microtask, and
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
  readonly kind: 'data-group' | 'grouped' | 'set-data'
  apply(changes: readonly DataChange[]): void
}
```

Resolution order and splice capability:

| Rank | Transport | Detected by | `canSplice` |
| --- | --- | --- | --- |
| 1 | `data-group` | `Component.getDataProxy(component)` or `component._$dataGroup` with `getChanges`/`setChanges`/`applyDataUpdates` | yes |
| 2 | `grouped` | `groupUpdates` plus `replaceDataOnPath` and/or `spliceArrayDataOnPath` | yes only when `spliceArrayDataOnPath` exists |
| 3 | `set-data` | plain `setData` | no |

`canSplice` means "a splice can actually be committed by this transport", not
"the component happens to expose `spliceArrayDataOnPath`". `applyBinding`
therefore asks `transport.canSplice` and falls back to the whole value when it
is false. `apply` still validates defensively: a splice handed to a transport
that cannot commit one throws
`[glaze] data transport cannot commit a splice; send the whole value instead`
instead of being filtered out. The grouped path validates before calling
`groupUpdates`, so a rejected change cannot leave a partially queued update.

The data-group path keeps another writer's queued changes and appends the
runtime's entries in glass-easel's own tuple format
(`[path, value, undefined, undefined]`, `[path, inserts, index, del]`). All
methods are called on their original receiver (`group`, or `component`).

## Materialization

`materialize(index, value)` returns `{ payload, baseline }`:

- Scalar binding: `payload` is `normalizeDataValue(value)`, `baseline` is the
  raw applied value, which is what the unchanged-value check in `applyBinding`
  compares against.
- List binding: the value is projected with the existing `listFields` rule
  (the key is always kept, `*this` is not projected). `payload` and `baseline`
  are two independent `snapshotList` copies: the platform mutates the payload
  in place, so it must not alias either the application row or the next diff
  baseline.
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

Cost: every list update now takes two deep snapshots. Projected lists already
did that; unkeyed and `*this` lists previously took one, so this is the price of
the separation between payload and baseline.

## Flush failures

`flush` clears `pending` and `flushScheduled` before applying, and
`applyBinding` advances `state.previous` when the change is scheduled. A
transport failure is therefore intentionally **not replayed**: replaying would
re-apply changes that may already have been committed. The catch sets
`state.error` and logs through `reportTransportError`; it deliberately does not
call `markAsync` or touch loading/error boundaries. The regression test makes
`applyDataUpdates` throw, asserts one log and `state.error`, then checks that
the next change flushes exactly once more.

## List helpers

- `diffList(previous, next, key, binding, canSplice)` owns the
  patch → splice → `null` decision; `applyBinding` uses `null` to send the whole
  value. `listPatch` and `listOps` remain separate algorithms.
- `listOps` returns `ListOp | null` (it only ever produced one operation).
- `listPatch` reuses one `WeakMap` comparison cache per call instead of
  allocating one per field; cycle protection is unchanged.
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
# tests 129, pass 129, fail 0
pnpm --filter @glaze/runtime typecheck
# tsc --noEmit -p tsconfig.json, exit 0
```

Capability combinations covered by `test/transport.test.ts`:

| Combination | Covered by |
| --- | --- |
| full data proxy | DataGroup queue/tuple/receiver test |
| group + replace only | replace applied; splice rejected before grouping |
| group + splice only | splice committed; replace falls back to `setData` |
| group + replace + splice | both path APIs used |
| no path APIs | `setData` with `dataKey`; splice rejected |
| splice API without group/proxy | runtime sends the whole list, no silent drop |

Minidev e2e was not run in this lane; integration runs later.
