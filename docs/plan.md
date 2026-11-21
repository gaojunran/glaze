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

### M3 — lists and events inside loops (next)

- `For` item events with index/key payload.
- Per-item binding paths instead of whole-array `setData` for item updates.
- Keyed reorder benchmark.
- Batch consecutive binding writes into one `setData`.

Acceptance: updating one row sends only that row's path; 1000-row reorder is
within 1.5x native.

### M4 — build integration

- Vite plugin: discover components, compile, bundle, emit WXML/JSON/WXSS.
- JSX intrinsic types for `view`, `text`, `button`, `input`, `scroll-view`.
- A single `pnpm build` produces a project accepted by `minidev sim build`.
- Remove the standalone example build script.

### M5 — Svelte 5

- Svelte compiler AST to the same WXML/binding IR.
- `$state` / `$derived` / `$effect` mapping.
- Scoped CSS to WXSS.
- Same e2e and benchmark suites.

## Validation rule

Every milestone runs in the minidev simulator with a real page and records:

- exact command;
- pass/fail of `minidev test`;
- first-render and update numbers against the native page;
- any known gap that affects correctness or performance.
