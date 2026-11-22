# Performance backlog

These are glass-easel-specific optimizations for standard Solid code. The
component-dense benchmark, the shared runtime module, P0 pure-component
inlining, binding-effect batching and the structured data-change queue are
implemented and measured below.

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

Status: implemented.

Previously every binding got its own `createEffect`, so a component with 50
scalar bindings created 50 effects. The runtime now groups consecutive scalar
bindings into batches and creates one effect per batch. The batch size is
`runtime.bindingGroupSize` in `glaze.config`, defaulting to 8; `1` gives one
effect per binding:

```js
createEffect(
  () => group.map((index) => ({ index, value: state.bindings[index]() })),
  { effect(values) { for (const item of values) applyBinding(item.index, item.value) } },
)
```

Trade-off: with size eight, one change recomputes at most the other seven
bindings in its batch. `applyBinding` then skips unchanged scalars, so those
recomputes do not become data paths. List bindings keep their own effect because
diffing an array is more expensive than a scalar read. Initial values are still
evaluated once per binding before the first paint, and the first effect run skips
values unchanged since then.

A dependency-set grouping would be more precise: the compiler knows the signal
and prop reads of a simple expression, so it could emit a sorted dependency key
per binding and the runtime could put equal keys in one effect. This is safe
even when the analysis is incomplete: the effect still executes every binding,
so Solid tracks every dependency that is actually read; a missed dependency only
means the binding stays in a coarser group. It is also not free: bindings with
unique dependency sets become one effect each, which loses the creation/memory
saving for large forms; aliases, stores, context, prop proxies and user helper
functions need analysis rules; and a superset/subset pair still wakes two
effects on the shared signal. The fixed-size config is the current escape hatch
and keeps the runtime independent of compiler analysis. Dependency grouping is
left as a compiler-side optimization, not assumed to be a win.

Acceptance was same or lower `setData` count, fewer effects, and no regression
in single-field update latency. The effect count itself is not exposed by the
runtime, so the wall-time result is the evidence rather than an effect-count
assertion.

Measured on the component-dense route after grouping: Glaze first render
3616/3563/3605 ms (mean 3595), first-row update 33/29/28 ms (mean 30), state row
click 25/24/24 ms, append 190/199/190 ms, delete 182/198/188 ms. The same-session
native means were 3618 ms first render, 34 ms update, 24 ms state click, 194 ms
append and 187 ms delete. This is within run spread; it is not claimed as a
wall-time win. The concrete change is fewer effects per component, with a
maximum of eight scalar bindings recomputed per change.

## P1 — Structured data-change queue

Status: implemented. This supersedes the earlier pending key/value map and the
`dataPath()` parser.

The compiler and the list diff already know every path as an array. The runtime
now keeps that shape from the binding to glass-easel:

```ts
type DataChange =
  | { path: (string | number)[]; value: unknown }
  | { path: (string | number)[]; splice: { index: number; del: number; inserts: unknown[] } }
```

A microtask flush appends those entries to the component's `DataGroup` queue:

```js
const group = Component.getDataProxy(component)
group.setChanges([
  ...group.getChanges(),
  [['b0'], 1, undefined, undefined],
  [['b2'], [nextItem], 7, 1],
])
group.applyDataUpdates()
```

`getDataProxy` and `DataGroup.getChanges` / `setChanges` / `applyDataUpdates`
are public glass-easel APIs. Keeping a previous queue entry matters: another
writer may have queued a change between flushes, and replacing the queue would
drop it. The tuple order is glass-easel's own `DataReplace` / `DataSplice`
format, so replace and splice changes share one template update and no path
string is parsed again.

Two fallbacks remain, in this order:

1. `groupUpdates` + `replaceDataOnPath` / `spliceArrayDataOnPath`;
2. one `setData` built with `dataKey()` (`b3[0].done`).

`dataKey()` is only used by the last fallback; the old `dataPath()` string parser
was removed.

Two smaller changes ride with the queue:

- **Unchanged scalar bindings are skipped.** Scalar bindings share one effect per
  group of eight. The effect recomputes all eight, but `applyBinding` now returns
  early when `Object.is(value, state.previous[index])` holds. A form with eight
  independent signals therefore writes one data path, not eight. List bindings
  still always diff, because array identity and field diffs are their job.
These are deterministic reductions in work and payload. They did **not** produce
a clear wall-time change over the previous `replaceDataOnPath` flush in the
component-dense benchmark; the wall-time wins below come from the list data-path
design (field patches and one splice) plus pure-row inlining, not from the queue
itself.

### Results after the data-change queue

Three runs per route in one server session, on the component-dense routes. The
harness now also exercises two list-wide actions added for this measurement:

- `.toggle-all` maps every pure row to `done` and waits for the **last** row;
- `.reverse-rows` reverses the whole pure-row list and waits for the **first and
  last** titles to swap;
- append waits for the new row's title (`Appended 1000`);
- delete waits for the first row's title to change.

| Case | Glaze runs | Glaze mean | Native runs | Native mean |
| --- | --- | --- | --- | --- |
| First render (2000 rows) | 3605, 3582, 3564 | 3584 | 3665, 3548, 3571 | 3595 |
| First pure row field update | 31, 30, 30 | 30 | 32, 33, 32 | 32 |
| Toggle all 1000 rows | 58, 57, 58 | 58 | 74, 75, 71 | 73 |
| State row click | 24, 28, 24 | 25 | 26, 27, 25 | 26 |
| Append one pure row | 286, 267, 254 | 269 | 293, 235, 230 | 253 |
| Delete first pure row | 201, 185, 188 | 191 | 183, 179, 177 | 180 |
| Reverse 1000 rows (full) | 438, 400, 413 | 417 | 436, 426, 490 | 451 |

Current status versus native: first render and a state-row click are tied;
single-row field updates, toggle-all and full reverse are faster on the Glaze
route; append/delete stay the weak spot (+16 ms / +11 ms mean), where one
inline row has to be materialized or removed while the native side can satisfy a
host count earlier. Do not claim append/delete as a win until a tighter harness
removes the selector/poll bias.

## P2 — Dependency-set binding groups

Status: candidate, deliberately not scheduled.

A compiler-side dependency key per binding would let the runtime group bindings
that read exactly the same signals/props, instead of slicing by index. It removes
the "one change recomputes the other seven" cost, but unique dependency sets
degrade to one effect per binding, and aliases, stores, context, prop proxies and
helper calls make a sound analysis expensive. Revisit only with a benchmark page
whose bindings contain expensive expressions and where effect creation is not the
dominant cost. The fixed-size `runtime.bindingGroupSize` remains the current
policy.

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
of this table (`bench/components.cts`). It was measured before P0; the P0 result
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
  toggles the first pure row's `done` through parent state; `.toggle-all` maps
  every row to the opposite `done`; `.reverse-rows` reverses the list;
  `.append-row` appends one pure row; `.delete-row` removes the first pure row.
  The state row updates itself.
- Native pure row (`src/static/components/bench-row`): `Component` with `title`
  and `done` properties, equivalent `.pure-title`/`.pure-state`.
- Native state row (`src/static/components/bench-state-row`): local `clicks` data,
  equivalent `.state-count`/`.state-bump`.
- Native page updates the first pure row with a path setData
  (`'rows[0].done'`), toggles all with one mapped array, reverses with
  `slice().reverse()`, appends with a new array, and deletes with `slice(1)`.
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
NODE_PATH=~/Playground/minibuild/sdk node examples/solid-todo/bench/components.cts
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

## Edge-case benchmarks

The flat-list and component-dense benchmarks measure row throughput. These four
cases target shapes that a compile-first framework can break on even when raw
render speed is fine:

| Case | Risk |
| --- | --- |
| Deep nesting | Recursive component references and a 100-instance tree; compile-time inlining could loop, flatten state, or lose a boundary. |
| Form typing | Many independent scalar bindings and an `input` event that must round-trip through state without resetting the other fields. |
| Slots / children | Slot content is authored in the page but rendered inside 100 component shadow trees. |
| Custom events | A component event must reach the parent handler with its payload, once per click. |

### Routes and shapes

| Route | Implementation |
| --- | --- |
| Glaze `pages/bench-edges/index` | `src/BenchEdges.tsx` plus `BenchEdgeDeep.tsx`, `BenchEdgeSlotCard.tsx`, `BenchEdgeEventRow.tsx` |
| Native `pages/native-edges/index` | `src/static/pages/native-edges/index.*` plus two local components under `src/static/pages/native-edges/components/` |

- **Deep (Glaze).** `BenchEdgeDeep` imports itself under an alias. The page
  renders 10 top-level chains; each instance renders exactly one child until
  level 9, so the tree is 10 levels × 10 instances = 100 custom component
  instances. Recursion goes through a `<For>` with `keyed={false}`, and the
  component has a local `createSignal`, so the loop-purity rule keeps a real
  component boundary at every level instead of inlining the next level. Every
  node renders `.deep-node` and `.deep-label`; level 9 also renders `.deep-count`
  and `.deep-bump`. The measured update bumps the first chain's leaf.
- **Deep (native).** WXML has no recursive template, so the sanctioned fallback
  is used: 10 chains of 10 explicitly nested `<view class="deep-node">` (100
  plain views). Only the innermost view renders `.deep-count` and `.deep-bump`;
  the handler writes one path, `chains[i].count`.
- **Form.** Glaze holds 20 independent `createSignal('')` pairs; native holds
  `fields[i].value`. Both render 20 `<input class="field-input">` and mirror the
  last field into `.field-mirror`. The harness appends 10 characters to the last
  input through 10 automator `input()` calls.
- **Slots.** Glaze renders 100 `BenchEdgeSlotCard` components, each with default
  slotted `<text class="card-text">`. Native renders 100 local
  `bench-slot-card` components with `<slot />`. `.update-card` toggles the first
  card's text through parent state.
- **Custom events.** Glaze renders 100 `BenchEdgeEventRow` components with a
  local click count; `.pick` calls `onPick(rowId)` and the page writes
  `.picked` as `picked-<id>-<n>`. Native does the same with
  `triggerEvent('pick', rowid)`. One first-row click is measured.
- All selectors are stable classes and buttons; the harness drives both pages
  through the automator without knowing which implementation is mounted.

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
  --port 9435

# separate shell
cd ~/Projects/glaze
NODE_PATH=~/Playground/minibuild/sdk node examples/solid-todo/bench/edges.cts
```

`edges.cts` defaults to port `9422`; pass `GLAZE_PORT=9435` (or set the server
port to match). Port 9435 was used here because other simulator servers were
already running on the machine. `GLAZE_RUNS` defaults to 3.

Environment: minidev 0.18.0 (`fd870b3`), Node v22.23.0, pnpm 11.28.7, Linux
5.15.0-94-generic x86_64, simulator runtime 3.17.3. `pnpm build` reported
`9 pages, 20 components`. Three runs per route in one server session; a
neutral `pages/index/index` reLaunch runs between runs and is not timed.

### Results

Measured 2026-11-23 on the local minidev checkout. All values are milliseconds.

| Case | Glaze runs | Glaze mean | Native runs | Native mean |
| --- | --- | --- | --- | --- |
| First render (all four cases) | 3295, 3277, 3267 | 3280 | 3211, 3197, 3220 | 3209 |
| Deep leaf update | 23, 22, 22 | 22 | 22, 22, 22 | 22 |
| Form: 10 chars into last input | 22, 26, 49 | 32 | 36, 37, 33 | 35 |
| Slot: first card text update | 69, 70, 68 | 69 | 70, 74, 69 | 71 |
| Custom event: one click round-trip | 24, 23, 23 | 23 | 22, 22, 22 | 22 |

Verified on every run:

- Deep: native rendered 100 `.deep-node`; Glaze rendered 10 top-level `.deep-host` chains and the
  harness walked the first chain to level 9 (100 instances by construction). The leaf count moved on
  the timed bump (`0 -> 1` on both routes).
- 20 `.field-input` elements, `target.value()` and `.field-mirror` both ended
  with the 10-character buffer.
- 100 `.slot-card-host` hosts and the first `.card-text` changed on the timed
  update.
- 100 `.event-row-host` hosts, the first `.event-count` moved, and `.picked`
  changed after one `.pick` tap.

### Methodology caveats

- **One page, one first-render number.** All four cases share a route, so
  `firstRender` runs from `reLaunch` until the last case is ready; it is not a
  per-case number. It includes routing, page creation and one automator poll
  interval. For Glaze it also includes the harness walking nine `.deep-host`
  levels to confirm the leaf exists. Reloading a 100-component page per case
  made the automator session too slow to finish, so that variant was rejected.
- **Updates are at the automator floor.** Every update number is one tap or 10
  input calls plus CDP round-trips and 10 ms text polling. A 1–2 ms difference
  between the routes is not evidence of a real routing difference; only the
  order of magnitude is meaningful. The Glaze form run spread (22–49 ms) shows
  how much a single run can vary.
- **Form typing is not real key input.** `element.input(value)` sets
  the whole value and fires one input event per call. Ten calls approximate ten
  keystrokes, and each call re-sends the accumulated string. The automator and
  the runtime do not expose `setData` counts, so the number of field updates is
  not observable; 10 keystrokes is the upper bound, and the final value/mirror
  check is the evidence.
- **The simulator can surface stale DOM across `reLaunch`.** On the second
  Glaze run the first card already read `Card 0 changed` before the timed update,
  even though the previous run had changed it. The handler toggles between
  `Card 0` and `Card 0 changed`, so each timed update is still a real parent
  state change, but run 2 measures the changed -> initial direction. This is the
  same class of staleness as the component benchmark's stale first row; it is
  reported, not hidden. The form starts from the input's current value for the
  same reason.
- **Deep is not instance-for-instance identical.** Native WXML cannot recurse,
  so the native side uses 100 plain nested views while Glaze uses 100 custom
  component instances. The comparison answers "what does deep nesting cost on
  each side", not "same instance type on both sides". The native leaf update is
  one path `setData`; the Glaze leaf update is a local signal inside the deepest
  component.
- **The page/component budget is at the soft limit.** The two required routes
  plus four cases add one page and three components. `glaze build` reports
  `9 pages, 20 components`; `staticPages` adds two native route entries to
  `app.json` (11 route entries total), but the build's page counter counts Glaze
  page entries only.
