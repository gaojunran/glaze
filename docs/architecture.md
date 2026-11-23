# Architecture

The module-level source map is in [source-layout](source-layout.md).

Glaze has two layers: a build-time compiler and a small runtime.

```
Solid component (TSX)
  └── @glaze/compiler
        ├── component.wxml      structure, bindings, events
        └── component.ts        setup + ctx.bind / ctx.event
              └── esbuild       solid-js + @glaze/runtime
                    └── mini-program component
```

## View layer

The compiler emits a normal mini-program WXML template. Structure is static;
dynamic values are WXML bindings (`{{bN}}`). `Show` becomes `wx:if`, `For`
becomes `wx:for`. The view layer is native WXML/glass-easel, not a recursive
generic template.

## Logic layer

`defineGlazeComponent` creates one Solid root per component instance:

- `created` runs the component's setup and computes the initial binding values
  before the first paint;
- `attached` groups scalar bindings into batches of eight (list bindings keep
  one effect each), skips scalar values that did not change, and forwards later
  values as `DataChange[]` through `Component.getDataProxy` +
  `DataGroup.setChanges`/`applyDataUpdates` (falling back to `groupUpdates` +
  `replaceDataOnPath`/`spliceArrayDataOnPath`, then `setData`);
- components with async boundaries additionally memoize each binding and use
  `isPending` for refetch; `asyncStatus` condition bindings are written directly
  so a pending read elsewhere in the component cannot hold the fallback state;
- `detached` disposes the root.

No virtual DOM, Taro DOM, or generic renderer exists at runtime. The only data
that crosses the bridge is the changed binding value.

A child Solid component becomes a mini-program component with declared
`properties`. Its parent passes WXML attributes. A prop used only in WXML is
projected directly as `{{title}}`, so the property path updates the template
without a child effect. A prop read by generated JavaScript gets a prop signal
and an observer; the child's binding effects then update its WXML. The parent
does not render the child in JS.

For a Glaze-to-Glaze child with two or more groupable scalar props, the build
groups them into one internal `glazeprops` object property so a parent update
crosses the component boundary once instead of once per prop. The child source
still reads `props.a`; its WXML projection falls back to the scalar property
when a field is absent, which keeps native parents and component defaults
working. A one-prop child keeps the normal attribute path. This is a transport
optimization, not a public component API. See
[compiler.md](compiler.md#structured-props-for-component-boundaries).

## Why this shape

The original external-component plan was rejected after an empirical test: the
custom `templateEngine` is a glass-easel view-layer API and cannot be supplied
from appservice. The platform forces the render step into WXML. Compiling the
structure and keeping only bindings at runtime is the shortest remaining path.
See [findings-external-component.md](findings-external-component.md).

Implementation details and the current supported subset are in
[compiler.md](compiler.md).
