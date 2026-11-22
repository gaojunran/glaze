# Architecture

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
- `attached` creates one `createEffect(compute, apply)` per binding and forwards
  later values through a batched `groupUpdates` + `replaceDataOnPath` flush
  (falling back to `setData` when those glass-easel primitives are missing);
- `detached` disposes the root.

No virtual DOM, Taro DOM, or generic renderer exists at runtime. The only data
that crosses the bridge is the changed binding value.

A child Solid component becomes a mini-program component with declared
`properties`. Its parent passes WXML attributes; property observers write the
child's prop signals, and the child's own binding effects update its WXML. The
parent does not render the child in JS.

## Why this shape

The original external-component plan was rejected after an empirical test: the
custom `templateEngine` is a glass-easel view-layer API and cannot be supplied
from appservice. The platform forces the render step into WXML. Compiling the
structure and keeping only bindings at runtime is the shortest remaining path.
See [findings-external-component.md](findings-external-component.md).

Implementation details and the current supported subset are in
[compiler.md](compiler.md).
