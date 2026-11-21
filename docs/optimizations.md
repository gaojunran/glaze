# Performance backlog

These are glass-easel-specific optimizations for standard Solid code. They are
recorded here so feature work can land first; none of them are implemented yet.

## Why the current benchmark is not enough

`pages/bench/index` renders a flat `wx:for`:

```tsx
<For each={items()} keyed={(item) => item.id}>
  {(item) => (
    <view class="row">
      <text class="row-title">{item.title}</text>
    </view>
  )}
</For>
```

It measures the template/binding path, not component boundaries. A real page is
usually:

```tsx
<For each={items()} keyed={(item) => item.id}>
  {(item) => <TodoItem title={item.title} done={item.done} onToggle={...} />}
</For>
```

Each row then costs a component instance, a props property bridge, a child Solid
root, a child `setData`, and a host node. The current 1–2% result says nothing
about that shape.

## P0 — Inline pure components inside `For`

Status: not implemented. Expected to be the only change with a potentially
order-of-magnitude effect on component-dense pages.

Today a `TodoItem` row updates through:

```text
parent list signal
  -> parent setData(list)
  -> child property observer
  -> child signal
  -> child effect
  -> child setData
  -> child WXML
```

If the compiler proves the child is pure, it can expand the child JSX into the
loop body and substitute props with loop-scope expressions:

```xml
<view class="item">
  <text class="{{todo.done ? 'item-title done' : 'item-title'}}"
        bindtap="e3"
        data-glaze-index="{{index}}">
    {{todo.title}}
  </text>
</view>
```

Then a row update is one parent path (`b3[i].done`); there is no child instance,
property bridge, child root, or child `setData`. Component events also collapse
to direct parent handler calls.

Conservative purity conditions:

- no `createSignal`, `createMemo`, `createEffect`, `createStore`;
- no `onMount`, `onCleanup`, `onSettled`;
- no `useContext`;
- no `ref`;
- no relative imports or module-level runtime statements;
- only props, JSX and pure expressions;
- a default slot may inline; named slots require a boundary.

Ineligible children keep the component boundary. Recursive inlining of pure
children can follow once the single-level case is measured.

Risks:

- WXML expressions are a smaller language than JS; validate every substituted
  expression or reject it at compile time.
- Event handlers still need the loop index/row reconstruction.
- Local state is the semantic line: a stateful child must never be flattened.

## P1 — Batch scalar bindings

Today every binding gets its own `createEffect`, so a component with 50 scalar
bindings creates 50 effects. Microtask batching merges the resulting `setData`
calls, but effect creation and scheduling remain.

Options:

1. One effect for a group of scalar bindings, updating one payload.
2. Group by dependency, when the compiler can prove it.
3. Only group scalars; keep list bindings separate.
4. Split groups above a threshold so one change does not recompute everything.

Acceptance: same or lower `setData` count, fewer effects, no regression in
single-field update latency.

## P1 — Skip path parsing with `replaceDataOnPath`

The compiler already knows every data path. `setData` parses each string path at
runtime (`parseSinglePath`); `replaceDataOnPath(pathArray, value)` plus
`groupUpdates` avoids that.

Candidate:

```js
this.groupUpdates(() => {
  this.replaceDataOnPath(["b0"], value0)
  this.replaceDataOnPath(["b1"], value1)
})
```

This is a deterministic micro-optimization and should not change semantics.
Keep `setData` for the fallback path and for runtimes without these methods.

## P2 — LIS list moves through `spliceArrayDataOnPath`

Insert, delete, and middle replacement already use
`Component.spliceArrayDataOnPath` with `groupUpdates`. Reorder currently
replaces the changed middle rather than computing a minimal move set.

Potential work:

- derive LIS from the key sequence;
- delete only rows outside the LIS;
- insert only moved rows;
- emit several splice operations inside one `groupUpdates`.

Before implementing, inspect how `spliceArrayDataOnPath` reaches the template
engine. Glass-easel's `RangeListManager.diff` may also diff the `wx:for` list;
doing LIS on both sides could cancel the benefit.

## P2 — External component islands

A custom renderer over `externalComponent` can bypass WXML and `setData`:

```text
signal -> renderer -> backend node ops
```

That raises the update ceiling but lowers first-render performance and loses
WXML component interop, native `wx:for` diffing, and selector compatibility.

Recommended shape if pursued: static shell in WXML, high-churn dynamic subtree
as an external-component island. Not a default path.

## Measurement protocol

Add a component-dense benchmark before changing the compiler:

| Case | Purpose |
| --- | --- |
| 1000 flat `wx:for` rows | current baseline |
| 1000 pure `Row` components | component boundary cost |
| 1000 `Row` components with local signal | stateful boundary cost |
| 1000 pure `Row` components after inlining | P0 effect |

Record per case:

- first render wall time;
- single-row field update;
- single-row click;
- append/insert/delete/reorder;
- component instance count;
- `setData` / splice count and payload bytes.

Acceptance for P0: no correctness or semantics regression in the existing e2e,
and measurable improvement on the 1000-component cases. A flat-row improvement
is not evidence for P0.

## Non-goals

- Flattening stateful components; local state needs an instance.
- Cross-boundary context or function props; the mini-program data bridge cannot
  carry them.
- Arbitrary dynamic components, render props, or HOCs.
- Replacing WXML for every component; first render would regress.
