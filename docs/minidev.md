# Running with minidev

Glaze targets the **glass-easel** component framework. A project must opt in
twice: once at compile time, once at runtime.

## 1. Compile with glass-easel

In `app.json` (or a page's `.json`):

```json
{
  "componentFramework": "glass-easel"
}
```

## 2. Use glass-easel in the WebView renderer

```json
{
  "window": {
    "glassEaselWebview": true
  }
}
```

`glassEaselWebview` is the runtime gate. **Without it, the WebView renderer
falls back to exparser even when `componentFramework` is `glass-easel`.**

A complete `app.json` for a Glaze project:

```json
{
  "pages": ["pages/index/index"],
  "componentFramework": "glass-easel",
  "window": {
    "glassEaselWebview": true,
    "navigationStyle": "default"
  }
}
```

For Skyline projects, `componentFramework` must be `glass-easel`, and the
host injects `glassEaselWebview` for Skyline pages. Glaze targets the WebView
renderer, so set it explicitly.

## Build the example

```bash
cd ~/Projects/glaze
node packages/compiler/src/build-example.mjs
```

This compiles `examples/solid-todo/src/*.tsx` into mini-program components under
`examples/solid-todo/miniprogram/components/`.

## Build and serve

Use the local minidev checkout; do not depend on a globally installed binary.

```bash
cd ~/Playground/minibuild

target/debug/minidev sim build \
  --project ~/Projects/glaze/examples/solid-todo \
  --out ~/Projects/glaze/.tmp/sim

target/debug/minidev sim serve \
  --dist ~/Projects/glaze/.tmp/sim \
  --browser ~/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell \
  --port 9422
```

Open `http://127.0.0.1:9422/appservice/mainframe`.

## End-to-end test

```bash
cd ~/Playground/minibuild
target/debug/minidev test \
  --project ~/Projects/glaze/examples/solid-todo \
  --browser ~/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell
```

The test uses a custom component id (`#app`) because mini-program selector
queries do not pierce a component's shadow root from the page level.

## Where this is enforced

In the minidev source:

- `crates/simulator/src/assembly/assets/host/parts/30-frames.js` merges the
  global `window.glassEaselWebview` into page config and uses it in
  `getPageRenderer`.
- `crates/simulator/tests/fixtures/skyline-mini/miniprogram/app.json` shows the
  working shape.

If a page renders with exparser despite `componentFramework: "glass-easel"`,
check `glassEaselWebview` first.
