# Architecture

Glaze renders a framework component tree directly into glass-easel backend
nodes. There is no WXML in the hot path, no `setData` for internal state, and no
DOM shim.

## Boundary

A page hosts one `<glaze-root>` component:

```
Page WXML
  <glaze-root id="app" />

glaze-root component (glass-easel, externalComponent: true)
  templateEngine: GlazeTemplateEngine
    createInstance() -> TemplateInstance
      shadowRoot: ExternalShadowRoot
      initValues(data) -> mount the framework root
      updateValues(data, changes) -> update boundary props
```

`externalComponent: true` is the glass-easel escape hatch for third-party
frameworks. glass-easel hands the subtree to Glaze instead of maintaining
logical nodes for it. Glaze renders directly to the DOM-like backend elements,
which is the shortest path to the view layer.

The boundary is intentionally small:

- glass-easel owns the page, properties, lifetimes, and the host node;
- Glaze owns the component tree inside the boundary;
- inner components never become mini-program components.

## Renderer

The Solid renderer wraps `createRenderer` from `@solidjs/universal` and maps its
operations to backend elements:

| Universal renderer | glass-easel backend |
| --- | --- |
| `createElement(name)` | descriptor, materialized on insert |
| `createTextNode(text)` | `context.document.createTextNode` |
| `insertNode(parent, node, anchor)` | `parent.insertBefore(node, anchor)` |
| `removeNode(parent, node)` | `parent.removeChild(node)` |
| `setProperty(node, name, value)` | `setAttribute` / listener / class / style |
| `getParentNode` / `getFirstChild` / `getNextSibling` | `parentNode` / `childNodes[0]` / `nextSibling` |

`createElement` has no parent context: a component can create a node inside an
effect, long after the root was mounted. The renderer therefore returns a
lightweight descriptor and materializes the real backend element in
`insertNode`, where the parent is known. This avoids a global "current root"
stack and makes multiple roots safe.

## State

Only boundary properties are synchronized with glass-easel. Inside the
boundary, framework state is the single source of truth.

- Each declared property maps to a signal.
- The props object exposed to the root is a proxy of getters over those
  signals.
- `updateValues` sets the signals for changed top-level properties.
- Nothing is mirrored into glass-easel `data`.

## Events

`onTap`, `onClick`, `onInput`, and similar props are handled by the renderer.
The boundary's `ExternalShadowRoot.setListener` stores listeners per backend
element; `handleEvent` walks from the event target to the root and dispatches
them. The handler receives a small DOM-like facade, not a browser event.

## Styles

The first wave uses WXSS plus the glass-easel style scope. Svelte's scoped CSS
and a CSS-in-JS layer are separate, later work.

## Constraints of external components

`externalComponent` is the fastest path, but glass-easel documents hard limits:

- only the Domlike backend supports external rendering;
- a single slot, no named or dynamic slots;
- the external subtree cannot reference other glass-easel components;
- selector queries and tree traversal cannot see inside the subtree;
- events are owned by `ExternalShadowRoot`, not glass-easel's event system.

The first wave uses the boundary as a root container with no WXML children, so
these limits are acceptable. WXML component interop, if required later, needs a
bridge outside the external boundary or a second `ShadowRoot`-based adapter.
