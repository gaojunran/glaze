# Framework benchmark fixtures

Exploratory, same-machine comparison of a 1000-row mini-program page across
Glaze, Vue Mini, Taro and uni-app. It answers "can these frameworks run in
minidev at all, and what does the same page shape cost?" rather than claiming a
production benchmark.

## Fixtures

| App | Stack | Build | Route |
| --- | --- | --- | --- |
| `apps/vue-mini` | `@vue-mini/core 1.2.16`, official create-vue-mini build | `pnpm install && pnpm build` | `pages/home/index` |
| `apps/taro` | Taro 4.3.3, React 18, **Vite compiler** | `pnpm install && pnpm build:weapp` | `pages/index/index` |
| `apps/uni-app` | uni-app Vue3 Vite preset `3.0.0-5030420261029002` | `pnpm install && pnpm build:mp-weixin` | `pages/index/index` |
| Glaze | `examples/solid-todo` | repository `pnpm build` | `pages/bench/index` |
| Native | `examples/solid-todo/src/static/pages/native` | repository `pnpm build` | `pages/native/index` |

Every page renders exactly 1000 `.row` elements with `.row-title` text. The
framework fixtures also have `#title`, `#update` and `.reverse`; the Glaze/native
flat pages only have `.reverse` (their update actions differ and are not compared
here). All fixtures include a `pages/blank/index` neutral route for a reLaunch
before the timed route.

## Run a fixture

Build the app, then make a minidev simulator distribution and start its server:

```bash
# Vue Mini
cd bench/frameworks/apps/vue-mini
pnpm install
pnpm build

# Taro: use the Vite compiler in config/index.js. Webpack5 currently fails in
# minidev with "Cannot access '_raf' before initialization".
cd ../taro
pnpm install
pnpm build:weapp

# uni-app
cd ../uni-app
pnpm install
pnpm build:mp-weixin
```

For each app, point minidev at the build output (or at the project root when
`project.config.json` already contains `miniprogramRoot`):

```bash
cd ~/Playground/minibuild
target/debug/minidev sim build --project <project-or-output> --out <sim-dist>
target/debug/minidev sim serve --dist <sim-dist> \
  --browser ~/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell \
  --port 9440
```

Then measure. `NODE_PATH` must point at the minidev SDK that contains
`minidev-automator`:

```bash
NODE_PATH=~/Playground/minibuild/sdk node bench/frameworks/run.mjs \
  --port 9440 --route /pages/home/index --neutral /pages/blank/index \
  --update '#update' --last 'Row 999' --runs 3
```

For Glaze/native, use `--root '#app'` for Glaze, and no `--update` because the
flat page does not expose the same row-update action:

```bash
node bench/frameworks/run.mjs --port 9446 --route /pages/bench/index \
  --neutral /pages/index/index --root '#app' --last 'Item 999' --runs 3
node bench/frameworks/run.mjs --port 9446 --route /pages/native/index \
  --neutral /pages/index/index --last 'Item 999' --runs 3
```

The runner prints JSON with each run's `firstRender`, optional `update`, and
`reverse` in milliseconds. It asserts 1000 rows and the first row text, so a
page that silently fails to render is not reported as a fast render.

## Observed on 2026-11-23

These are exploratory numbers from separate minidev servers on one machine, not
a final cross-framework result. Every row uses three runs with the neutral route
and the fixture in this directory; Glaze/native use the existing flat benchmark.
`—` means the page does not expose the same action.

| Implementation | First render | First-row update | Reverse 1000 rows |
| --- | ---: | ---: | ---: |
| Glaze | 3295–3302 ms | — | 223–234 ms |
| Native WXML | 3311–3346 ms | — | 226–238 ms |
| Vue Mini 1.2.16 | 3281–3306 ms | 53–60 ms | 233–238 ms |
| Taro 4.3.3 (Vite) | 3235–3308 ms | 76–81 ms | 618–627 ms |
| uni-app Vue3 Vite | 3268–3293 ms | 52–54 ms | 230–256 ms |

Caveats:

- First render includes page routing and automator round-trips; it is not a
  device timing.
- The framework pages update the first row title; the Glaze/native flat pages
  do not have that control, so their update column is empty.
- Taro's Webpack5 compiler did not register the page in minidev: the appservice
  threw `ReferenceError: Cannot access '_raf' before initialization` and
  `rootCompPath=pages/index/index not found`. The fixture therefore uses Taro's
  Vite compiler. Do not compare the Webpack5 variant until that is fixed.
- Vue Mini needs an immutable array replacement (`rows.value = [...rows.value].reverse()`)
  for reverse; in-place `reverse()` did not trigger its update.
- minidev can retain stale DOM across `reLaunch`; always use the neutral route
  and treat small update differences as noise.
- No `setData` count or byte metric is available here.

## Scope

The fixtures are source-only; `node_modules` and build output are ignored. They
are not part of the repository workspace and do not affect Glaze's normal build.
Keep the comparison diagnostic: the production benchmark remains the
same-harness Glaze/native suite in `docs/optimizations.md`.
