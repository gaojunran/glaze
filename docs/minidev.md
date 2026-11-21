# Running with minidev

Glaze targets the **glass-easel** component framework. A mini-program project
must opt in twice: once at compile time, once at runtime.

## 1. Compile with glass-easel

In `app.json` (or a page's `.json`):

```json
{
  "componentFramework": "glass-easel"
}
```

This selects the glass-easel template compiler. Without it, the project is
compiled for exparser.

## 2. Use glass-easel in the WebView renderer

```json
{
  "window": {
    "glassEaselWebview": true
  }
}
```

`glassEaselWebview` is the runtime gate. **Without it, the WebView renderer
falls back to exparser even when `componentFramework` is `glass-easel`.** This
is the configuration that is easy to miss: the project compiles for glass-easel,
but the page still runs the old component framework.

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
simulator/host injects `glassEaselWebview` for Skyline pages. Glaze's first
target is the WebView renderer, so set it explicitly.

## Optional: `useGlassEaselForWxml`

`project.config.json`:

```json
{
  "setting": {
    "useGlassEaselForWxml": true
  }
}
```

This compiles WXML exclusively with glass-easel and removes the wcc `$gwx`
artifacts. It is not required for an external component, and pure-glass output
has packaging limitations. Leave it off unless you are deliberately testing the
pure glass-easel pipeline.

## Commands

Use the local minidev checkout; do not depend on a globally installed binary.

```bash
cd ~/Playground/minibuild

cargo run -p daemon --bin minidev -- sim build \
  --project ~/Projects/glaze/examples/solid-todo \
  --out ~/Projects/glaze/.tmp/sim

cargo run -p daemon --bin minidev -- sim serve \
  --dist ~/Projects/glaze/.tmp/sim \
  --browser /snap/bin/chromium

cargo run -p daemon --bin minidev -- test \
  --project ~/Projects/glaze/examples/solid-todo \
  --browser /snap/bin/chromium
```

`--browser` depends on the machine; `/snap/bin/chromium` is the path used on the
current development host. A Playwright `chromium_headless_shell` also works.

## Where this is enforced

In the minidev source:

- `crates/simulator/src/assembly/assets/host/parts/30-frames.js` merges the
  global `window.glassEaselWebview` into page config and uses it in
  `getPageRenderer`.
- `crates/simulator/tests/fixtures/skyline-mini/miniprogram/app.json` shows the
  working shape.

If a page renders with exparser despite `componentFramework: "glass-easel"`,
check `glassEaselWebview` first.
