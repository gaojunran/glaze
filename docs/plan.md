# Implementation plan

Status: 2026-11-21. Solid compiler spike is working; Svelte is not started.

## Goal

Run Solid 2 (later Svelte 5) on glass-easel mini-programs with a native WXML
view path and a binding-level update path, close enough to hand-written WXML that
the framework is not the bottleneck.

## Current architecture

Build-time Solid JSX to WXML compiler plus a small Solid runtime. See
[compiler.md](compiler.md) and [architecture.md](architecture.md).

The earlier external-component design is archived as a negative result in
[findings-external-component.md](findings-external-component.md).

## Milestones

### M0 — repository and platform validation (done)

- pnpm workspace, package skeletons, MIT license.
- Confirmed minidev runs a glass-easel project only with both
  `componentFramework: "glass-easel"` and `window.glassEaselWebview: true`.
- Confirmed `externalComponent` + `templateEngine` is not reachable from user
  appservice code.

### M1 — compiler spike (done)

- Babel-based compiler for a constrained Solid subset.
- Static elements, bindings, events, `Show`, `For`.
- `defineGlazeComponent` runtime with initial data and binding effects.
- Counter page and 1000-row benchmark page in the minidev simulator.
- E2E test passes; benchmark recorded.

Acceptance met: e2e green; 1000-row first render within ~1–2% of native in the
same harness; scalar update equal.

### M2 — props and composition (done)

- Component props: scalar and object.
- Compile a Solid component used by another into a mini-program component.
- Prop updates map to `setData` on the child component.
- Reject dynamic components with a clear error.

Acceptance met: `Counter` renders three `TodoItem` children; toggling the first
todo changes the child's `done` property and its class. E2E passes.

### M2.5 — static component inlining (done)

- Inline eligible child components into the parent's WXML and Solid root.
- Props become getters, so no property bridge and no child component instance.
- Keep a component boundary for `For`-scoped usages and unsupported children.

Acceptance met: `Header` is inlined (`no <header>`, no `Header` import in the
generated module), while `TodoItem` inside `For` stays a component. E2E passes.

### M3 — lists and events inside loops (done)

- `For` item events with index payload (`data-glaze-index`); the generated
  handler resolves the item from the loop source.
- Per-item binding paths instead of whole-array `setData` for item updates.
- Keyed reorder benchmark.
- Batch consecutive binding writes into one `setData`.

Acceptance met: toggling one todo sends `b2[0].done` (observed in the appservice
log), removing a row through a `For` event works in e2e, and 1000-row reverse is
65–71 ms on Glaze versus 65–68 ms native. Structural changes still send the full
array.

### M4 — build integration (done)

- `@glaze/build` CLI: `glaze build`.
- Config for pages, static directories and static pages.
- Compiles reached components, page wrappers, `app.json` and the app shell.
- A single `pnpm build` produces a project accepted by `minidev sim build`.
- Removed the standalone example build script.

Acceptance met: `pnpm build` writes a clean project; builder test passes; the
counter e2e passes against the generated output.

### M5 — component surface (done, with scoped limits)

- Default and named slots: inlined default slot plus boundary `<slot>` /
  `<slot name>` with `multipleSlots`.
- Component custom events: `onX` → `bind:x`, child `eventProps` → `triggerEvent`.
- Context Provider: inline descendants only, via `withProvider`.
- Refs: generated id plus `boundingClientRect` measurement facade.
- Nested `For`: distinct item/index names, one index marker per level.
- Structural list patches: insert/delete/reorder use glass-easel
  `spliceArrayDataOnPath` via `groupUpdates`; field patches remain for stable
  key order.

Acceptance met: unit tests cover every compile path; the counter e2e exercises
inline default slot, boundary default slot, named slot, component event,
context value, ref measurement, nested loop event, and list append.

Known limits are listed in [compiler.md](compiler.md#known-gaps).

### M6 — Svelte 5

- Svelte compiler AST to the same WXML/binding IR.
- `$state` / `$derived` / `$effect` mapping.
- Scoped CSS to WXSS.
- Same e2e and benchmark suites.

## Deferred performance work

The component-dense benchmark and pure-component inlining ideas are tracked in
[optimizations.md](optimizations.md). Feature coverage stays the current
priority; performance work starts only after that benchmark exists.

## Validation rule

Every milestone runs in the minidev simulator with a real page and records:

- exact command;
- pass/fail of `minidev test`;
- first-render and update numbers against the native page;
- any known gap that affects correctness or performance.
