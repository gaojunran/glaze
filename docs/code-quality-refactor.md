# Compiler and runtime code-quality refactor

This document records the structural cleanup that followed the compiler/runtime
audit. The goal was not a rewrite: every wave kept the generated WXML/JS, the
runtime transport fallback order, and the public compiler/runtime surfaces
stable, except where a confirmed correctness gap required a behavior change.

## Direction

The audit found four recurring problems:

1. the same semantic rule implemented in several places (groupable props,
   expression visitors, data keys, capability probes);
2. mutable state spread across parallel arrays and maps (`bindings`,
   `bindingFns`, `asyncPending`, eight boundary maps, three lifecycle
   booleans);
3. the generated config having no single typed contract between compiler,
   build and runtime;
4. a few god functions (`compileComponent`, `inlineComponent`, the
   `mini.ts` mount/update path) hiding phase boundaries.

The refactor therefore worked in small, mergeable waves: share leaf utilities,
define one protocol, model runtime state explicitly, then fix the correctness
gaps the models exposed. Full expression/control-flow IRs, a generic visitor
framework, and a full `CompilerContext` rewrite were rejected because they
would change the compiler's failure semantics without a measured benefit.

## Waves

### 1. Shared protocol and generated-config contract (`9e37948`)

- `@glaze/shared/protocol.ts` now owns `STRUCTURED_PROP`, `CONTEXT_PROP`,
  `LIST_KEY_WHOLE`, binding/event/ref/data-key helpers, async and boundary
  entry types, and `GeneratedConfigJson`.
- Removed the dead `errorBoundary` and `refCount` config fields; the runtime
  derives logging from each binding's boundary.
- `GlazeContext.bind` has its fourth `errorBoundary` parameter in the public
  type, matching the generated calls.
- The fail-closed prop audit also scans `block.effects`, closing a path that
  could skip a prop read.
- `packages/compiler/test/generated-config.test.ts` compiles a real component,
  imports the emitted config and asserts data keys, list metadata, async status,
  handler count and property names against `GeneratedConfigJson`.

### 2. Compiler structure (`672ce86`)

- Shared AST helpers: `visitChildren` (visitor-key order, in-place
  replacement), `unwrapTs` (only `as`/`satisfies`/non-null), static member
  chains, reference identifiers.
- Shared tag/attribute/event emission leaves; native-element and component
  differences stay explicit at the call sites.
- `Scope` gained the fields it actually used (`itemAst`, `directKey`) and
  factories for loop/callback scopes.
- `compileComponent` split into `analyzeComponent` and `finalizeProps` without
  moving the context-rewrite -> prop-map -> compile -> prop-audit order.
- A temporary golden corpus of 871 compilation variants (33 example components
  plus about 280 inline sources under three option sets) was byte-identical
  before and after. The corpus is not committed.

Deliberately not changed: `hoistLoopExpression`/`substituteInlineProps`/
`validateInline` keep their own traversal and pruning, `__glazeIndex` stays a
literal, and `CompilerContext` keeps its current shape.

### 3. Runtime transport (`67c1fb4`)

- `packages/runtime/src/transport.ts` resolves the data capability once per
  attach: `DataGroup` -> grouped path APIs -> `setData`.
- `canSplice` means "a splice can be committed safely", not "the method
  exists".
- `materialize(index, value)` returns a detached `payload` and a separate
  diff `baseline`; lists, including `*this`, never alias the application array
  or the platform data object.
- `diffList` owns the patch/splice/whole-value decision.
- A transport failure is reported on the instance and log channel; the batch is
  not replayed.

### 4. Runtime state models (`e077dbb`, `10aae1f`)

- `BindingState`: `raw`, `read`, `memo`, `initial`, `previous`, `settled`,
  `loadingBoundary`, `errorBoundary`, `source`, `fallbackSource`.
- `BoundaryState`: pending/consumers/errors, loading/errored/error-value/reset
  signals, and `loadingOn`.
- `LifecycleState`: `unmounted`, `waiting-context`, `mounted`, `attached`,
  `detached`; `attachedBeforeMount` records the deferred-context attach.
- `mini.ts` mount, initial read, memo creation, binding effects, async helpers,
  status projection and lifecycle callbacks now use those models. Sparse
  binding indexes are preserved and traversals skip empty slots.

The lifecycle phase is not a promise that effects are installed. That
distinction is explicit: `ready` can mount and install effects while the phase
is still `mounted`.

### 5. Correctness wave (`8d84625`, `8ce7df2`, `473c101`)

The new models made several existing gaps testable:

- **Undefined list payload.** `materialize` must normalize a list payload to
  `null` before mount's `setData`; the transport path already did this. Fixed
  and covered for mount and update.
- **List splice with a retained-row edit.** `listOps` keeps prefix/suffix rows
  by key only. `diffList` now deep-compares all retained rows and falls back to
  the whole list when any changed, so an insert cannot leave a stale title.
- **Grouped splice-only transport.** A grouped transport without
  `replaceDataOnPath` defers replacements after the group and could overwrite a
  splice. `canSplice` now requires both path APIs; only-splice platforms send a
  whole list for structural changes.
- **Failed flush baseline.** If the transport throws after `previous` advanced,
  the affected baselines become invalid; the next update sends a whole value.
- **Source switch.** `markAsync` clears the old error source's consumer before
  registering a new source, so A -> B -> success no longer leaves `Errored`
  true.
- **Double effects.** `effectsInstalled` guards `attach`; `ready` before
  `attached` installs one set of binding effects, and `attached` only advances
  the phase.
- **Pre-root status projection.** A deferred async component no longer writes a
  transient status value before its root exists; the test asserts no `setData`
  before `ready`.

### 6. Contract and readability (`9257d0a`, `6c4546e`, `4789cff`)

- `packages/compiler/src/props.ts` is the single groupable-prop predicate used
  by build marker selection, parent `glazeprops` grouping and child projection.
  Build asserts the marker and compiler decision agree. Declaring
  `props.glazecontext` is rejected like `props.glazeprops`.
- Generated metadata is typed as `GeneratedConfigMetadata`
  (`Pick<GeneratedConfigJson, ...>`); emitted JSON is byte-identical.
- `inlineComponent` is split into private phases: resolve target, capture/restore
  imports, parse child, adopt imports, collect props, compile body, assert
  children, register. Generated output is byte-identical across 14 probe
  scenarios (loop/stateful/imports/slots/children/errors).
- `validateConfig` rejects configuration that would silently disable a
  generated feature: unknown `propSignals`, lowercased property collisions,
  non-positive `bindingGroupSize`, negative `handlerCount`, malformed
  `listBindings`/`listFields`, and invalid `asyncStatus` entries.

## Rejected or deferred

- Full `CompilerContext` sink/cursor/analysis model and a `Scope` discriminated
  union: high migration cost, no measured output gain.
- A general AST substitution utility: the existing rewrite policies differ in
  shadowing and error behavior; only proven defects should add targeted tools.
- `errorArray` multi-source semantics: a real API decision, not a refactor.
  Current tests lock the single-value behavior.
- Merging `listPatch`/`listOps`, `initial`/`previous`, or the scalar-group and
  list effect schedulers: these separations encode performance and failure
  behavior.
- Splitting `data.ts`/`ref.ts`: too little code and no structural payoff.

## Validation

Final state is `4789cff` on `main` plus the lifecycle tests:

```
pnpm -r test
# shared 2, runtime 188, compiler 291, build 121 = 602 tests, 0 failed

pnpm -r --if-present typecheck
# shared, compiler, runtime, build, vite-plugin: Done

cd examples/solid-todo && pnpm build
# glaze build: 17 pages, 31 components

cd ~/Playground/minibuild
target/debug/minidev test --project /data/home/nebula/Projects/glaze/examples/solid-todo ...
# 10 cases, 10 passed, 0 failed (55965 ms)
```

The minidev run is the local simulator, not a real device. The remaining
real-device smoke and performance baselines are tracked separately in
[optimizations.md](optimizations.md).
