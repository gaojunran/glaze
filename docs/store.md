# Store

Glaze's store is a thin layer over Solid's own `createStore`. It does not add a
second reactive system: the state is a Solid store proxy, actions mutate a
draft, and the existing compiler/runtime bindings project it into WXML.

## Direction

`@glaze/store` exists because a mini-program needs one place to keep state that
outlives pages and component boundaries. A signal created inside a component is
disposed with that component; a store must be created before any component and
must be shared by every bundle that imports the same definition.

The smallest API that provides that lifetime is:

```ts
export const useTodos = defineStore('todos', () => {
  let nextId = 0
  const [state, setState] = createStore({ items: [] as Todo[] })
  const remaining = createMemo(() => state.items.filter((item) => !item.done).length)
  const add = (title: string) =>
    setState((draft) => {
      draft.items.push({ id: nextId++, title, done: false })
    })
  return { state, remaining, add }
})
```

`useTodos()` is called from any component setup. The first call runs the setup
inside a detached `createRoot`; later calls return the same object. There is no
provider, no injection and no prop threading.

### Why not another store library

- **Solid `createStore`** is the primitive. It already provides fine-grained
  nested updates, draft setters and array proxies. Importing Nano Stores,
  Zustand or TanStack Store would either duplicate that graph or force a
  framework-agnostic wrapper around it.
- **Nanostores** has its own atom model and lifecycle. Bridging it to Solid
  would add a second dependency and a subscription layer without replacing any
  code in the runtime.
- **Zustand** is built around React's external-store subscription model; its
  selector/equality machinery is not used by Glaze's binding compiler.
- **Pinia** is Vue-specific (Vue reactivity, plugins, devtools, SSR). Only its
  setup-store shape is useful here, and that shape fits Solid directly.

So the package is deliberately small: a registry, lazy creation, disposal and
diagnostics. The state itself remains `solid-js/store`.

## API

### `defineStore(id, setup)`

- `id` must be a non-empty string. It is the global key; two definitions with
  the same id share one instance.
- `setup` runs once, lazily, inside `createRoot`, and must return an object.
  The object is the store; it may contain stores, signals, memos, actions or
  any other Solid primitives.
- The returned `useStore` function has `$id` and creates or returns the single
  instance.
- The instance gets non-enumerable `$id` and `$dispose` fields. A setup return
  value cannot already contain those names.
- A circular dependency (`A()` calls `B()`, `B()` calls `A()`) throws
  `[glaze] circular store dependency: "<id>"`.
- A failed setup leaves no instance behind, so the next call retries.

### `defineStore` and component bundles

Every generated component bundle contains its own copy of the module that calls
`defineStore`, because the builder only shares `solid-js` and the `@glaze/*`
runtime through `glaze-runtime/index.js`. The registry therefore lives in the
shared runtime, not in the store definition module:

- the first bundle to load registers the setup;
- if no instance exists yet, a later duplicate definition replaces the pending
  setup (both copies come from the same source and are equivalent);
- once an instance exists, a duplicate definition reuses it and ignores its
  setup;
- every `useStore` closure, whichever bundle created it, resolves to the same
  registry entry.

The consequence is that store definitions should keep their state inside the
setup function. A module-level mutable variable is copied per component bundle
and is not shared. Define ids uniquely per application; a duplicate id with a
different shape is a programming error, not a feature.

### Lifetime

The store is app-wide, not page-wide. Detaching the page or a component that
read it does not dispose it; this is what makes a store survive navigation and
component remounts. `$dispose()` disposes the Solid root and clears the
instance; the next `useStore()` builds a fresh one. It is intended for tests,
HMR and deliberate resets. There is no automatic disposal on page unload.

### Reserved names

`$id` and `$dispose` are reserved on the returned store object. A setup that
returns either name throws. This keeps the store's identity and lifetime API
unambiguous.

## Using store state in WXML

The compiler projects every binding through the runtime. Store state works the
same way as a signal, with one additional rule: a Solid store mutates arrays in
place.

- A keyed list is recommended:

  ```tsx
  <For each={todos.state.items} keyed={(item) => item.id}>
    {(item) => <text>{item.title}</text>}
  </For>
  ```

  This generates a keyed list binding, so field changes become field paths and
  insert/delete becomes a splice.

- An unkeyed list also works. The compiler emits a whole-list binding
  (`listBindings: { "2": "*this" }`) instead of treating the array as a scalar
  binding; a change sends the full array. The WXML has no `wx:key`, so use a
  keyed list for large or frequently reordered lists.

- The runtime reads list values deeply inside the binding effect
  (`trackListValue` in `packages/runtime/src/list.ts`). Reading the length,
  indexes and row fields subscribes the binding to Solid store mutations such
  as `state.items.push(...)` and `state.items[0].done = true`. A keyed list
  only reads the fields that list projection recorded (plus the key); an
  unkeyed list reads every row field. Without this, a list binding would only
  react when the array were replaced. Plain (non-reactive) arrays pay only
  ordinary property reads.

- Scalar store fields work as ordinary expressions:

  ```tsx
  <text>{todos.remaining()}</text>
  ```

  The compiler still applies the prop-only projection rules; a value read from
  a store is a JS read, so it becomes a binding, not a WXML property.

## Implementation

| Location | Responsibility |
| --- | --- |
| `packages/store/src/index.ts` | `defineStore`, the global registry, lazy `createRoot`, `$id`/`$dispose` |
| `packages/build/src/shared.ts` | treats `@glaze/store` as a shared specifier |
| `packages/runtime/src/list.ts` | `trackListValue` deep reader for store arrays |
| `packages/runtime/src/mini.ts` | wraps every array binding with `trackListValue` |
| `packages/compiler/src/control.ts` | unkeyed `For` gets a `*this` list binding |

`@glaze/store` is externalized from each component bundle exactly like
`@glaze/runtime`, so `glaze-runtime/index.js` exports one `defineStore`
function and one registry for the whole mini-program. A normal subpackage
shares the main package's runtime. An `independent: true` subpackage has its
own runtime copy and therefore its own store registry; do not expect stores to
cross that boundary.

## Trade-offs

- **Setup stores only.** Pinia also supports an options store (`state`,
  `getters`, `actions`). Glaze does not; Solid code already has explicit
  signals and memos, and a second options shape would need a conversion layer
  with no runtime benefit. The setup form is the supported API.
- **One instance per id, app-wide.** There is no per-page or per-component
  scope. A page-specific store should be a signal owned by that page; making
  every page create its own store would reintroduce a provider/injection
  system.
- **Duplicate definitions are last-writer-before-instance.** This makes
  separate component bundles work without a build-time shared module for store
  definitions. It also means a typo that reuses an id with different state is
  not detected; ids are a naming contract.
- **No automatic SSR or devtools.** The target is a mini-program app, not a
  server-rendered web app. Devtools integration would require a separate
  package and a stable inspection protocol.
- **Deep list reads cost O(rows).** The alternative is stale WXML after an
  in-place store mutation. The list path already clones and diffs rows, so the
  added reads are in the same order; keyed lists remain the recommended shape
  for large data.

## Validation

Run from the repository root:

```bash
pnpm -r test
pnpm -r --if-present typecheck
cd examples/solid-todo && pnpm build
cd ~/Playground/minibuild && target/debug/minidev test \
  --project /data/home/nebula/Projects/glaze/examples/solid-todo
```

Results for this change:

- `pnpm -r test`: shared 2, store 8, runtime 202, compiler 300, build 123;
  635 passed, 0 failed.
- `pnpm -r --if-present typecheck`: shared, store, runtime, compiler, build,
  vite-plugin all Done.
- `examples/solid-todo`: `glaze build: 18 pages, 34 components`.
- minidev e2e: 11 cases, 11 passed; the store case crosses the real
  `glaze-store-page` / `glaze-store-panel` component boundary and checks
  initial state, page-driven updates, panel-rendered state (read through
  `outerWxml` because page selectors do not cross the child shadow root), a
  keyed row toggle and `clear`.
- Store unit tests: 8 cases covering lazy creation, setup reactivity, duplicate
  definitions from separate bundles, distinct ids, `$dispose`, circular
  detection and invalid returns.
- Runtime unit tests: an unkeyed store array re-sends after an in-place
  `push`, and a projected list re-runs for a projected field but not for an
  unprojected `extra` field.
