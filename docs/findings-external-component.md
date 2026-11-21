# Finding: external components are not reachable from user code

Date: 2026-11-21.

## Summary

The planned `externalComponent: true` + custom `templateEngine` boundary does not
work in a real mini-program. The component mounts, but the template engine is
never created, so no external shadow tree is produced.

This is not a configuration problem. It is a process-boundary problem.

## What was tested

A minimal page:

```xml
<view class="page">
  <glaze-root id="app" />
</view>
```

A component that declares both an external component and a template engine:

```js
Component({
  options: {
    externalComponent: true,
    templateEngine,
  },
  lifetimes: {
    created() { console.log('[glaze] lifetime created') },
    attached() { console.log('[glaze] lifetime attached') },
  },
})
```

`app.json` opts in with:

```json
{
  "componentFramework": "glass-easel",
  "window": { "glassEaselWebview": true }
}
```

## Observed

The component module and both lifetimes run:

```
[glaze] component module loaded
[glaze] lifetime created
[glaze] lifetime attached
```

`templateEngine.create`, `createInstance`, and `initValues` never run. The page
renders the component's placeholder, not the external tree.

## Why

- `externalComponent` and `templateEngine` are **glass-easel view-layer**
  options. The built-in components use them inside `WARenderContext.js`:
  `.options({ externalComponent: true, templateEngine: Yi })`.
- A user `Component()` runs in the **appservice** (logic layer). Its definition
  is serialized and sent to the view layer; a JavaScript object with methods
  cannot cross that boundary.
- There is no public hook to register a view-layer template engine from
  appservice. The engine must exist before the component is registered in the
  view layer, and user code does not run there.

The appservice copy of glass-easel does have the option in its normalization
code, which is why the option type-checks, but it is not the copy that renders
the component tree.

## Implication

The "Solid renders directly into glass-easel nodes" architecture cannot be
implemented as a user-space mini-program framework. Any viable architecture must
keep the render step in the view layer (WXML / glass-easel templates) and send
serializable data across the bridge.

The remaining options are:

1. compile Solid JSX to WXML plus a binding runtime (near-native update path);
2. keep a runtime virtual tree and render it with a generic WXML template
   (Taro-style, with a visible performance cost);
3. a hybrid: compile static structure and bindings, fall back to a runtime
   renderer for dynamic subtrees.

## Reproduction

```bash
cd ~/Playground/minibuild
target/debug/minidev sim build \
  --project ~/Projects/glaze/examples/solid-todo \
  --out ~/Projects/glaze/.tmp/sim
target/debug/minidev sim serve \
  --dist ~/Projects/glaze/.tmp/sim \
  --browser ~/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell \
  --port 9421
```

Then read `~/.config/minidev/logs/wx0000000000000000/_local/compiler.2026-11-21.log`.
The component lifetimes appear; the template engine logs do not.
