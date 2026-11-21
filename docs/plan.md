# Glaze implementation plan

Status: draft, 2026-11-21.

## 1. Goal

Build a Solid 2 runtime that renders directly into glass-easel nodes and runs as
a real WeChat mini-program, with performance close to native glass-easel.

Svelte 5 is out of scope for the first wave, but the adapter is designed so that
a Svelte renderer can be added without changing the boundary model.

## 2. Non-goals (first wave)

- Multi-platform output (Alipay, ByteDance, H5, RN). We target glass-easel only.
- Svelte 5 support.
- A full mini-program UI component library.
- A general-purpose CSS-in-JS system.
- Subpackage-aware code splitting and async components. The architecture keeps
  room for them, but the first milestone is synchronous and single-bundle.

## 3. Architecture

### 3.1 Boundary

A page hosts one `<glaze-root>` component. That component is a glass-easel
component with `externalComponent: true` and a custom `templateEngine`:

```
Page WXML
  <glaze-root id="app" />

glaze-root component (glass-easel, externalComponent: true)
  templateEngine: GlazeTemplateEngine
    createInstance() -> TemplateInstance
      shadowRoot: ExternalShadowRoot
      initValues(data) -> mount Solid root into the backend element
      updateValues(data, changes) -> update boundary props
```

The page and the boundary component declare `componentFramework: "glass-easel"`.
The rest of the Solid component tree never becomes mini-program components.

`externalComponent` makes glass-easel hand the shadow tree to Glaze instead of
running its own template engine. Glaze renders directly to the backend elements
provided by the DOM-like backend, which avoids creating glass-easel logical
nodes for every element.

This is the intended path for third-party frameworks, but it has hard limits
that must be designed around:

- only the **Domlike** backend supports external rendering;
- only a single slot, no named or dynamic slots;
- the external subtree cannot reference other glass-easel components;
- selector queries and tree traversal cannot see inside the external subtree;
- events are handled by `ExternalShadowRoot.handleEvent` / `setListener`, not by
  glass-easel's normal event system.

For the first wave the boundary is a root container with no WXML children, so
these limits are acceptable. WXML component interop, if needed later, must go
through a bridge outside the external boundary.

### 3.2 Renderer

`@glaze/solid` wraps `createRenderer` from `@solidjs/universal` and maps its
operations to DOM-like backend elements:

| Universal renderer | glass-easel backend |
| --- | --- |
| `createElement(name)` | descriptor, materialized on insert |
| `createTextNode(text)` | `context.document.createTextNode` |
| `insertNode(parent, node, anchor)` | `parent.insertBefore(node, anchor)` |
| `removeNode(parent, node)` | `parent.removeChild(node)` |
| `setProperty(node, name, value)` | `setAttribute` / listener / class / style |
| `getParentNode` / `getFirstChild` / `getNextSibling` | `parentNode` / `childNodes[0]` / `nextSibling` |

`createElement` has no parent context: a component can create a node inside an
effect, long after the root was mounted. Glaze therefore returns a lightweight
**descriptor** and materializes the real backend element in `insertNode`, where
the parent is known. This avoids a global "current root" stack and makes
multiple roots safe.

The boundary's `ExternalShadowRoot` is implemented by Glaze:

- `root` is the component's backend element;
- `slot` is a backend element created by Glaze (the component's WXML children
  would be placed there);
- `setListener` stores framework event listeners per backend element;
- `handleEvent` walks from the event target to the root and dispatches them.

### 3.3 Props

Only boundary props are synchronized. Inside the boundary, Solid state is the
single source of truth.

- Each declared property gets a `createSignal`.
- The public props object is a proxy of getters over those signals.
- `updateValues` sets the signals for changed top-level props.
- Nothing is mirrored into glass-easel `data`.

### 3.4 Events

`onTap`, `onClick`, `onInput`, etc. are passed to the renderer as properties.
The renderer maps `onXxx` to `addListener` / `removeListener` and wraps the
glass-easel event in a DOM-like facade (`target`, `currentTarget`, `detail`,
`preventDefault`, `stopPropagation`).

### 3.5 Styles

Solid has no scoped CSS of its own. The first wave uses plain WXSS plus the
glass-easel style scope. A later milestone can add CSS modules or a compiler
that emits WXSS per component.

## 4. Package layout

```
packages/
  runtime/        @glaze/runtime
  solid/          @glaze/solid
  vite-plugin/    @glaze/vite-plugin
examples/
  solid-todo/
tests/
  e2e/
```

## 5. Milestones

### M0 — repository and spike (0.5 day)

- pnpm workspace, TypeScript, lint, CI.
- Confirm `@solidjs/universal` + glass-easel node creation works in a Node
  test.
- Confirm minidev can run a glass-easel project with a custom boundary.

Acceptance: a Node test mounts a Solid component and produces a glass-easel
node tree.

### M1 — renderer core (3–4 days)

- Descriptor-based `createElement`, `insertNode`, `removeNode`, `setProperty`.
- Text nodes, elements, fragments, comments.
- `insert` / `spread` / `setProp` / `ref` / `mergeProps` exports.
- Control flow re-exports (`For`, `Show`, `Switch`, `Match`, `Repeat`).
- Unit tests for tree shape and update behavior.

Acceptance: counter, `Show`, keyed `For`, and event handler render correctly in
a fake backend.

### M2 — boundary component (2–3 days)

- `GlazeTemplateEngine` and `TemplateInstance`.
- `initValues` mounts the Solid root; `detached` unmounts it.
- `updateValues` updates boundary signals.
- Minimal mini-program example with `<glaze-root>`.

Acceptance: `minidev sim serve` renders the counter in a real page, and
`minidev test` can assert its text and tap behavior.

### M3 — props, events, styles (3–4 days)

- Boundary props: string, number, boolean, object.
- Event facade and `triggerEvent` for boundary events.
- WXSS + style scope.
- Todo example.

Acceptance: todo app runs in the simulator; add / toggle / remove works; a
boundary event reaches the page.

### M4 — lists, batching, performance (3–4 days)

- Keyed list updates, insert/remove/move.
- Batch consecutive node operations before flush.
- Benchmark against native glass-easel: first render, single update, list
  update, reorder.

Acceptance: single update <= 1.2x native, first render <= 1.5x native on the
same simulator and machine; numbers and method recorded in the repository.

### M5 — build pipeline and docs (3–4 days)

- Vite plugin: `generate: "universal"`, `moduleName: "@glaze/solid"`.
- Emit boundary component JS/JSON/WXML/WXSS.
- JSX runtime types for glass-easel intrinsics.
- Documentation and a clean example.

Acceptance: `pnpm build` produces a project that `minidev sim build` accepts
without hand-written glue.

## 6. Validation

The source of truth is the minidev simulator running a real glass-easel
mini-program. Unit tests are necessary but not sufficient.

```bash
# Build
cargo run -p daemon -- sim build --project examples/solid-todo --out .tmp/sim

# Serve (headless Chrome)
cargo run -p daemon -- sim serve --dist .tmp/sim --browser /snap/bin/chromium

# End-to-end
cargo run -p daemon -- test --project examples/solid-todo --browser /snap/bin/chromium
```

Every milestone must keep the simulator path green. A change that only passes
unit tests is not accepted.

## 7. Risks

1. **glass-easel custom `templateEngine` is not exercised by minidev.** Verify in
   M0 before building the full adapter.
2. **Universal renderer needs DOM globals.** Verify the renderer path has no
   `document` / `window` dependency.
3. **First render cost.** Direct node creation may be slower than WXML for large
   pages. Mitigations: static hoisting, batched inserts, node reuse, islands.
4. **Event semantics.** Mini-program `tap` / `catch` / `mut-bind` do not map
   one-to-one to DOM events. Start with a small, documented subset.
5. **Styles.** WXSS selector support is narrower than CSS. Validate generated
   CSS early.
6. **glass-easel internals.** `NativeNode.create` is marked internal. Keep it
   behind one adapter module; upstream a public API if needed.

## 8. Open questions

- Can a page itself be a glass-easel component with a custom template engine, or
  is a `<glaze-root>` wrapper required?
- How does minidev's glass-easel assembly treat a component whose template is
  replaced at runtime?
- Does `@solidjs/universal` support async insertion (`lazy`, `Suspense`) without
  DOM assumptions?
- How should boundary props expose two-way binding (`model:`) later?
