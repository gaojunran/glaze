# Legacy exparser component framework

Glaze targets glass-easel by default. A project can opt into the older
`exparser` component framework by setting `componentFramework` in `src/app.json`:

```json
{
  "componentFramework": "exparser"
}
```

`@glaze/build` preserves that value and removes `window.glassEaselWebview`,
which only applies to glass-easel. The build then emits
`componentFramework: "exparser"` into every generated component config so the
runtime can use the legacy lifecycle and property timing.

This is a compatibility mode, not a second optimized renderer. It runs the same
WXML, bindings, stores, contexts, refs, page channel and UI components; only the
data transport and mount timing differ.

## Why mounting moves to `attached`

Exparser creates a child component and then assigns its parent-provided
properties:

1. `Component.create` builds the template data from property defaults.
2. `created` runs.
3. The parent's template assigns the real property values.
4. `attached` runs.

glass-easel's `propertyEarlyInit` option moves step 3 before `created`. Exparser
does not support that option. Mounting the Solid root in `created` there would
make setup read default props (`null` for Glaze's generated properties), and a
captured value would stay wrong forever.

For `componentFramework: "exparser"` the runtime therefore:

- does not pass `propertyEarlyInit`;
- leaves the instance in the `unmounted` lifecycle phase after `created`;
- re-reads `properties` / `data` into the prop signals at `attached` (and at
  `ready` for the deferred-context path), flushing Solid's staged writes before
  setup runs;
- mounts the root and installs binding effects from `attached`.

`attached` is also the point where the legacy caller has real property values,
so setup and the first binding pass see the same props the WXML projection does.

## Data transport

Exparser has `getDataProxy` on its own `Component` constructor (not the global
mini-program `Component` wrapper) and a `DataGroup` with `doUpdates`, but no
`groupUpdates` or `spliceArrayDataOnPath`. Glaze's transport therefore falls
back to `setData` for this mode. Scalar bindings still go through the normal
`bN` keys; list changes send the whole array instead of a keyed patch or splice.
That is intentionally accepted: the legacy framework only needs to run, not to
match glass-easel's list-update performance.

## Files

- `packages/build/src/build.ts` reads `src/app.json` before compiling, passes
  the mode into the compiler, keeps it in the build cache key, and strips the
  glass-easel-only window flag.
- `packages/compiler/src/{types,compile,emit}.ts` carry the mode into the
  generated `defineGlazeComponent` config as `componentFramework`.
- `packages/runtime/src/mini.ts` defers the mount and re-seeds props for legacy
  instances; `packages/runtime/src/config.ts` validates the field.
- `packages/shared/src/protocol.ts` owns the generated field name.

## Validation

Unit tests:

```bash
mise exec -- pnpm -r test
```

The suite covers the legacy mount timing (`defers exparser setup to attached so
parent props are visible`) and the build output (`emits exparser-compatible app
config and component metadata`), including removal of `glassEaselWebview`.

For a real simulator run, set `componentFramework` to `exparser` in
`examples/solid-todo/src/app.json`, build, and run the existing minidev suite:

```bash
cd examples/solid-todo
mise exec -- pnpm build
cd ~/Playground/minibuild
target/debug/minidev test \
  --project /data/home/nebula/Projects/glaze/examples/solid-todo \
  --browser ~/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell \
  --port 9920
```

Result on 2026-11-24: `12 用例: 12 通过, 0 失败` (70405 ms). The run covered the
counter/bindings, review boundary probes, event semantics, store, Tailwind,
context boundary, refs, async `Loading`/`Errored`, independent subpackage,
projected rows and the UI components.

## Limits

- No keyed list splice or grouped data updates; whole-array `setData` is used.
- The compatibility path is simulator-verified, not a real-device matrix.
- glass-easel remains the default and the only mode with the optimized
  `DataGroup` / splice transport.
- A project that stores `componentFramework: "exparser"` in `app.json` cannot
  also rely on glass-easel-only window settings; the build removes
  `glassEaselWebview` in that mode.
