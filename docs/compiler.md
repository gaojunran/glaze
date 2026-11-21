# Compiler architecture

Status: working spike, 2026-11-21.

## Direction

Glaze compiles Solid JSX to mini-program WXML at build time and runs only the
reactive logic at runtime. There is no runtime virtual tree and no generic
recursive template.

```
Counter.tsx
  └── @glaze/compiler
        ├── Counter.wxml        static structure + binding paths
        └── Counter.tsx         Solid setup + ctx.bind / ctx.event calls
              └── esbuild       bundles solid-js + @glaze/runtime
                    └── components/glaze-counter/index.js
```

The runtime only forwards binding values:

```
signal write
  └── createEffect(compute, apply)
        └── setData({ b0: value })
              └── WXML binding update
```

## Why not external components

The original plan used glass-easel `externalComponent` plus a custom
`templateEngine`. That API is view-layer only; a user `Component()` runs in the
appservice and its config is serialized, so the engine object is lost. The
component mounts, but the engine never runs. See
[findings-external-component.md](findings-external-component.md).

## Compiler

`@glaze/compiler` parses the default-exported component function with Babel,
keeps the setup statements before `return`, and compiles the returned JSX into
WXML.

First-wave support:

| Syntax | Compiles to |
| --- | --- |
| native element | same tag |
| static text / attribute | static WXML |
| `{expression}` text or attribute | `{{bN}}` + a binding |
| `onClick` / `onTap` / `onInput` / ... | `bindtap` / `bindinput` + `eN` |
| `<Show when={...}>` | `wx:if` |
| `<Show fallback={...}>` | `wx:if` + `wx:else` |
| `<For each={...} key="id">` | `wx:for` + `wx:key` |
| item/index expressions inside `For` | inline `{{item.x}}` |

Anything outside this subset is a compile error. Silent fallback would hide the
cases where the mini-program path diverges from Solid.

### Generated runtime

```
defineGlazeComponent({
  data: { b0: null, b1: null, b2: null },
  handlerCount: 2,
  setup(ctx) {
    // original setup statements
    ctx.bind(0, () => count())
    ctx.bind(1, () => count() > 3)
    ctx.event(0, () => setCount((value) => value + 1))
  },
})
```

`defineGlazeComponent`:

1. creates one Solid root per mini-program component instance in `created`;
2. runs `setup`, then evaluates every binding once and `setData`s the initial
   values before the first paint;
3. in `attached`, creates one `createEffect(compute, apply)` per binding and
   sends later values to `setData({ bN: value })`;
4. disposes the root in `detached`.

## Solid 2 note: burst events

Solid 2 writes are microtask-batched. In a burst of taps, `setCount(count() + 1)`
reads the old value each time and only increments once. Use the functional setter:

```tsx
onClick={() => setCount((value) => value + 1)}
```

This is documented as a user-facing rule for Glaze, not hidden by the runtime.

## Validation

Build the example:

```bash
node packages/compiler/src/build-example.mjs
```

Run the real mini-program in the simulator:

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

Run the benchmark against the native page while the simulator is running:

```bash
NODE_PATH=~/Playground/minibuild/sdk node examples/solid-todo/bench/compare.cjs
```

Run the e2e case:

```bash
target/debug/minidev test \
  --project ~/Projects/glaze/examples/solid-todo \
  --browser ~/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell
```

Result: `counter.test.js` passes (title, count, tap updates, `Show`, `For`).

## Benchmark

`examples/solid-todo` contains two equivalent 1000-row pages:

- `pages/bench/index` — compiled Solid (`glaze-bench`);
- `pages/native/index` — hand-written WXML.

Measured through `minidev-automator` on minidev 0.18.0, base library 3.17.3,
headless Chromium 1248, local Linux. First render is wall time from `reLaunch`
to the 1000th `.row` becoming queryable; update is wall time from tapping
`bump` to the `.tick` text changing. Automation overhead is included, so compare
relative numbers only.

| Run | Glaze first render | Native first render | Glaze update | Native update |
| --- | --- | --- | --- | --- |
| 1 | 3267 ms | 3206 ms | 25 ms | 27 ms |
| 2 | 3226 ms | 3210 ms | 24 ms | 25 ms |
| 3 | 3223 ms | 3213 ms | 24 ms | 24 ms |

Within this harness, first render is within ~1–2% of native and a scalar update
is the same. The 1000 rows are rendered by native `wx:for` in both cases; Solid
does not build a virtual tree.

## Known gaps

1. **Props and component composition** are not implemented. The compiler only
   handles the page root component.
2. **List item updates** currently send the whole array when the `For` source
   changes. Native WXML can send `items[0].title`; Glaze needs per-item paths.
3. **Events inside `For`** cannot yet receive the item or index. A handler that
   references the loop item is rejected.
4. **Unsupported JSX** (`.map`, dynamic components, render props, `Portal`,
   `Transition`) is a compile error.
5. **Build integration** is a standalone script; a Vite plugin and per-component
   discovery are next.
6. **Svelte** has no compiler yet.
