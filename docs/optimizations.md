# Performance backlog

These are glass-easel-specific optimizations for standard Solid code. The
component-dense benchmark, the shared runtime module and P0 pure-component
inlining are implemented and measured below; the P1 optimizations are not.

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

Status: implemented. The compiler inlines a pure child directly into the loop
template; a stateful child keeps the component boundary.

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

Status: investigated and deliberately **not implemented**.

Insert, delete, and middle replacement already use
`Component.spliceArrayDataOnPath` with `groupUpdates`. Reorder currently
replaces the changed middle with one splice.

Source evidence:

- `Component.spliceArrayDataOnPath` records a `DataChange` with
  `[path, inserts, index, del]`.
- `TemplateInstance.updateValues`
  (`glass-easel/src/tmpl/index.ts:162-235`) folds those changes into an
  `UpdatePathTreeNode`; multiple splices are applied to the same tree.
- `proc_gen_wrapper` creates a `RangeListManager` for each `wx:for`
  (`glass-easel/src/tmpl/proc_gen_wrapper.ts:369`), and
  `RangeListManager.diff` (`glass-easel/src/tmpl/range_list_diff.ts:145+`)
  computes the new key order and LIS independently of how the splice changes
  were shaped.

So sending a runtime LIS as several splices would add runtime work and payload
while the view layer still performs its own key diff/LIS. The current one-splice
middle replacement is the cheaper representation. Re-evaluate only if the
template engine update mode changes to a path that consumes splice ops directly
without `RangeListManager.diff`.

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

Status: the component-dense baseline below implements the second and third rows
of this table (`bench/components.cjs`). It was measured before P0; the P0 result
is recorded separately below.

## Component-dense baseline

Measured 2026-11-22 on the local minidev checkout. This is the control for the
P0 inlining work: at that commit pure rows stayed real component boundaries
because the compiler only inlined a component outside `<For>`.

### Routes and shapes

| Route | Pure rows | Stateful rows |
| --- | --- | --- |
| Glaze `pages/bench-components/index` | 1000 `BenchRow` rows (boundary before P0, inlined after) | 1000 `BenchStateRow` components |
| Native `pages/native-components/index` | 1000 `bench-row` components | 1000 `bench-state-row` components |

- Glaze pure row (`src/BenchRow.tsx`): props `title`/`done`, no signals, memo,
  effects, lifecycle, context or refs. Renders `.pure-title` and `.pure-state`.
- Glaze state row (`src/BenchStateRow.tsx`): local `createSignal(0)`, `.state-count`,
  `.state-bump` button, `.state-title`.
- Glaze page (`src/BenchComponents.tsx`): two keyed `<For>` loops. `.update-row`
  toggles the first pure row's `done` through parent state; `.append-row` appends
  one pure row; `.delete-row` removes the first pure row. The state row updates
  itself.
- Native pure row (`src/static/components/bench-row`): `Component` with `title`
  and `done` properties, equivalent `.pure-title`/`.pure-state`.
- Native state row (`src/static/components/bench-state-row`): local `clicks` data,
  equivalent `.state-count`/`.state-bump`.
- Native page updates the first pure row with a path setData
  (`'rows[0].done'`), appends with a new array, and deletes with `slice(1)`.
- Both native components set `styleIsolation: "apply-shared"` so page WXSS can
  style the internals; component WXSS also carries the row layout.

### Commands

```bash
cd ~/Projects/glaze
pnpm build

cd ~/Playground/minibuild
target/debug/minidev sim build \
  --project ~/Projects/glaze/examples/solid-todo \
  --out ~/Projects/glaze/.tmp/sim
target/debug/minidev sim serve \
  --dist ~/Projects/glaze/.tmp/sim \
  --browser ~/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell \
  --port 9422

# separate shell
cd ~/Projects/glaze
NODE_PATH=~/Playground/minibuild/sdk node examples/solid-todo/bench/components.cjs
```

Environment: minidev 0.18.0 (`400d69e`, 2026-11-22), Node v22.23.0, pnpm
11.28.7, Linux 5.15.0-94-generic x86_64, minidev simulator runtime 3.17.3.
Three runs per route, in one server session. The harness reLaunches a neutral
page (`pages/index/index`) between runs and that reLaunch is not timed.

### Results before P0 (control)

All values are milliseconds. `first render` runs from `reLaunch` until 1000
pure hosts and 1000 state hosts exist and their first inner titles are readable.
`update` taps `.update-row` until the first `.pure-state` changes; `state click`
taps the first `.state-bump` until `.state-count` is `1`; `append`/`delete` wait
for the `.pure-row` count to become 1001/1000.

| Case | Glaze runs | Glaze mean | Native runs | Native mean |
| --- | --- | --- | --- | --- |
| First render (2000 components) | 3812, 3800, 3766 | 3793 | 3641, 3601, 3643 | 3628 |
| First pure row update | 36, 24, 23 | 28 | 33, 33, 33 | 33 |
| State row click | 24, 24, 24 | 24 | 26, 23, 25 | 25 |
| Append one pure row | 202, 173, 188 | 188 | 185, 184, 192 | 187 |
| Delete first pure row | 191, 173, 186 | 183 | 185, 191, 186 | 187 |

Counts verified every run on both routes: 1000 pure rows, 1000 state rows,
1001 after append, 1000 after delete; the first state count moved `0 -> 1` and
the first pure state moved `todo -> done`.

### Results after P0 inlining

The same routes and harness were rerun after pure `BenchRow` inlining. State
rows still cross a real component boundary; pure rows are now native WXML in the
loop.

| Case | Glaze runs | Glaze mean | Native runs | Native mean |
| --- | --- | --- | --- | --- |
| First render (2000 rows) | 3612, 3589, 3658 | 3620 | 3601, 3540, 3572 | 3571 |
| First pure row update | 32, 28, 29 | 30 | 33, 33, 44 | 37 |
| State row click | 27, 23, 23 | 24 | 24, 25, 24 | 24 |
| Append one pure row | 198, 211, 220 | 210 | 182, 177, 175 | 178 |
| Delete first pure row | 181, 183, 224 | 196 | 179, 179, 190 | 183 |

Counts and first-row transitions were verified exactly as in the control. The
Glaze first-render gap falls from +165 ms to +49 ms (about 1.4% over native), and
Glaze's own first render drops by ~173 ms. Update and click stay at the polling
floor. Append/delete rose by about 20 ms/13 ms versus the control in this run;
those operations still send the parent list and are not evidence of a P0
regression, but they need a dedicated measurement before claiming an
improvement.

### Interpretation

- Before P0, first render cost about 4.5% more on Glaze (3793 ms vs 3628 ms
  mean, +165 ms). After P0 it is about 1.4% (3620 ms vs 3571 ms, +49 ms). The
  remaining difference is largely the 1000 stateful rows, which must keep a
  component boundary.
- Update, click, append and delete are all within the automator/CDP round-trip
  floor plus polling granularity (10 ms for text, 50 ms for counts). The 24 ms
  vs 34 ms update difference is about one poll interval and is not evidence of a
  real routing difference. These cases still validate the paths and selectors;
  they do not rank the two implementations.
- The flat-row benchmark already showed a 1–2% delta. Moving from flat rows to
  component rows raises the visible first-render gap to roughly 5%, which is the
  scale P0 has to beat. A P0 result should be judged on this table's first-render
  row, not on the flat-row page.

### Measurement compromises

- **Shadow roots are not pierced by page-level selectors.** In the pre-P0
  control, `page.$$('.pure-title')` returned 0 because each pure row lived in a
  custom component. The harness marks hosts with classes (`.pure-row`,
  `.state-row`) passed from the page, counts those hosts, then queries
  `.pure-title`, `.pure-state`, `.state-count` and `.state-bump` from a host
  element. After P0 the pure rows are inlined, so `.pure-row` is the root view
  and the same element-scoped queries still work; state rows remain component
  hosts. This measures the same DOM nodes, but the raw page selector is not the
  one in the protocol text.
- **A repeated Glaze run can surface a stale first row.** The harness can read
  `done` on the first row after `reLaunch` before the new tree settles. It
  re-queries hosts and normalizes the first row to `todo` outside the timed
  update; append/delete counts also re-query hosts. The update measurement itself
  is a real tap.
- **Rows use the automator**, so every number contains CDP round-trips and
  polling. No `setData` count or payload bytes are collected here; the runtime
  does not expose them through the automator.

## Non-goals

- Flattening stateful components; local state needs an instance.
- Cross-boundary context or function props; the mini-program data bridge cannot
  carry them.
- Arbitrary dynamic components, render props, or HOCs.
- Replacing WXML for every component; first render would regress.
