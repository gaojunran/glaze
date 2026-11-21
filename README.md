# Glaze

**Solid and Svelte, running natively on glass-easel.**

Glaze is a runtime that renders modern web frameworks directly into
[glass-easel](https://github.com/wechat-miniprogram/glass-easel) nodes. It does
not compile components to WXML, does not use `setData` for component state, and
does not need a DOM shim.

The first target is **Solid 2**. Svelte 5 support is planned on top of the same
glass-easel adapter.

## Why

Mini-program frameworks usually put a web framework on top of WXML:

```
React / Vue / Solid  ->  virtual DOM  ->  serialized data  ->  setData  ->  WXML
```

Glaze removes that stack:

```
Solid  ->  renderer  ->  glass-easel nodes  ->  backend ops  ->  view layer
```

The result is a shorter update path, no `setData` payload for internal state,
and full Solid semantics instead of a mini-program-safe subset.

## Architecture

```
<glaze-root>                         a normal mini-program component
  └── glass-easel component           owns a shadow root
        └── templateEngine            replaced by Glaze
              └── Solid root          mounted into the shadow root
                    └── renderer      creates / inserts / updates glass-easel nodes
```

The boundary is deliberately small: glass-easel owns the page, props, events,
lifetimes and style scope; Solid owns everything inside the boundary.

## Packages

| Package | Role |
| --- | --- |
| `@glaze/runtime` | glass-easel adapter: boundary component, template engine, props/events bridge |
| `@glaze/solid` | Solid 2 universal renderer, `render`, JSX runtime and types |
| `@glaze/vite-plugin` | build integration: compile Solid for the renderer and emit mini-program artifacts |
| `examples/solid-todo` | end-to-end example, validated with the minidev simulator |

## Status

Early. The first milestone is a Solid counter and todo running in a real
mini-program via the minidev simulator. Svelte is not implemented yet.

See [docs/plan.md](docs/plan.md) for the implementation plan and acceptance
criteria.

## Design principles

1. **No WXML in the hot path.** Templates are not compiled to WXML; they are
   rendered by the framework into glass-easel nodes.
2. **No `setData` for internal state.** `setData` is only used at the boundary,
   if at all.
3. **One boundary per page or public component.** Inner components stay inside
   the framework and update through the renderer.
4. **Measure against native glass-easel.** Performance claims are accepted only
   with simulator / device numbers.

## License

MIT
