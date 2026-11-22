# Framework benchmark fixtures

Exploratory, same-machine comparison of mini-program list pages across Glaze,
Vue Mini, Taro and uni-app. It answers two questions:

1. can these frameworks run in minidev at all;
2. which page shapes expose real architectural costs, not just routing noise.

This is diagnostic, not a production benchmark. The production benchmark remains
the same-harness Glaze/native suite in `docs/optimizations.md`.

## Fixtures

| App | Stack | Build | Routes |
| --- | --- | --- | --- |
| `apps/vue-mini` | `@vue-mini/core 1.2.16`, official create-vue-mini build | `pnpm install && pnpm build` | `pages/home/index` (flat), `pages/fine/index` (rich rows) |
| `apps/taro` | Taro 4.3.3, React 18, **Vite compiler** | `pnpm install && pnpm build:weapp` | `pages/index/index`, `pages/fine/index` |
| `apps/uni-app` | uni-app Vue3 Vite preset `3.0.0-5030420261029002` | `pnpm install && pnpm build:mp-weixin` | `pages/index/index`, `pages/fine/index` |
| Glaze | `examples/solid-todo` | repository `pnpm build` | `pages/bench/index`, `pages/bench-fine/index` |
| Native | `examples/solid-todo/src/static/pages/*` | repository `pnpm build` | `pages/native/index`, `pages/native-fine/index` |

The **flat** pages render 1000 `.row` elements and expose `#title`, `#update`
and `.reverse`. The Glaze/native flat pages only have `.reverse`; their update
actions differ and are not compared there.

The **fine** pages render 5000 `.row` elements. Each row also carries
`extra: 'x'.repeat(2000)`, which is data, not rendered text. They expose:

- `#bump` — increment `tick` only
- `#update` — change `rows[0].title`
- `#toggle` — change `rows[0].done`
- `#insert` — prepend a row
- `#delete` — delete the first row
- `.reverse` — reverse the list

Every app has a `pages/blank/index` neutral route for a reLaunch before the
timed route.

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
# Flat page, 1000 rows
NODE_PATH=~/Playground/minibuild/sdk node bench/frameworks/run.mjs \
  --port 9440 --route /pages/home/index --neutral /pages/blank/index \
  --update '#update' --last 'Row 999' --runs 3
```

```bash
# Rich-row page, 5000 rows, one field update only
NODE_PATH=~/Playground/minibuild/sdk node bench/frameworks/run.mjs \
  --port 9440 --route /pages/fine/index --neutral /pages/blank/index \
  --count 5000 --update '#update' --skip-reverse --runs 3
```

For Glaze use `--root '#app'`; native has no root selector:

```bash
node bench/frameworks/run.mjs --port 9446 --route /pages/bench-fine/index \
  --neutral /pages/index/index --root '#app' --count 5000 \
  --update '#update' --skip-reverse --runs 3
node bench/frameworks/run.mjs --port 9446 --route /pages/native-fine/index \
  --neutral /pages/index/index --count 5000 \
  --update '#update' --skip-reverse --runs 3
```

The runner supports `--bump`, `--toggle`, `--insert`, `--delete`, `--row` (row
selector), `--first-text` (first-row text selector) and `--skip-reverse`. It prints JSON
with each run's `firstRender`, optional `update`, `toggle`, `insert`, `delete`
and `reverse` in milliseconds. It asserts the requested row count and, when a
first-row text selector is supplied, that the first row actually rendered.

## Observed on 2026-11-23

### Flat 1000-row page

Three runs with the neutral route; Glaze/native use the existing flat
benchmark. `—` means the page does not expose the same action.

| Implementation | First render | First-row update | Reverse 1000 rows |
| --- | ---: | ---: | ---: |
| Glaze | 3295–3302 ms | — | 223–234 ms |
| Native WXML | 3311–3346 ms | — | 226–238 ms |
| Vue Mini 1.2.16 | 3281–3306 ms | 53–60 ms | 233–238 ms |
| Taro 4.3.3 (Vite) | 3235–3308 ms | 76–81 ms | 618–627 ms |
| uni-app Vue3 Vite | 3268–3293 ms | 52–54 ms | 230–256 ms |

This is the case where **Vue Mini and Glaze look basically identical**. The
payload is small and the list is shallow, so Vue Mini's whole-array `setData`
is cheap.

### Rich-row page: 5000 rows, 2 KB extra per row

This isolates Vue Mini's coarse top-level binding. Vue Mini deep-watches
`rows`; changing one row rewrites the whole 5000-row array. Glaze/native update
one path; uni-app's data diff emits one array index.

| Implementation | First render | Single-field update | Toggle first | Insert first | Delete first | Reverse |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Glaze | 4372 ms | **55 ms** | 351 ms | 820 ms | 746 ms | 1535 ms |
| Native WXML | 4366 ms | **55 ms** | 348 ms | 749 ms | 757 ms | 1519 ms |
| Vue Mini 1.2.16 | 4216–4348 ms | **115–131 ms** | 392–403 ms | 772–784 ms | 771–869 ms | 1546–1583 ms |
| Taro 4.3.3 (Vite) | 3929 ms | 472 ms | — | — | — | — |
| uni-app Vue3 Vite | 4212 ms | **63 ms** | — | — | — | — |

Vue runs are three runs; Glaze/native/Taro/uni are single runs. `—` means that
action was not measured for this note.

The only clear Vue Mini weakness here is the **single-field update**: ~2.1–2.4×
native/Glaze. The cause is visible in the runtime: `definePage` deep-watches the
top-level `rows` ref and calls `setData({ rows: deepToRaw(rows.value) })`.
Rendered text is only one row field, but the serialized payload is all 5000 rows.
Glaze/native update a path such as `rows[0].title`; uni-app's render data diff
finds one changed array index.

Toggle is a smaller version of the same effect (one field in one row, still a
whole-array Vue payload). Insert/delete/reverse do not isolate Vue Mini: native
also replaces the array there, and Glaze's `spliceArrayDataOnPath` does not
produce a visible win in this simulator. Taro is slow on every mutation because
its WXML is a generic recursive template tree rather than a direct `wx:for`
list.

Caveats:

- First render includes page routing and automator round-trips; it is not a
  device timing.
- `extra` is intentionally not rendered; it isolates the cost of carrying rich
  row data. It is still a realistic row shape for pages with nested metadata.
- Vue Mini can call `this.setData` manually with a path in a method, but its
  default top-level binding does not do that. That manual optimization is not
  what the framework does automatically.
- Taro's Webpack5 compiler did not register the page in minidev: the appservice
  threw `ReferenceError: Cannot access '_raf' before initialization` and
  `rootCompPath=pages/index/index not found`. The fixture therefore uses Taro's
  Vite compiler. Do not compare the Webpack5 variant until that is fixed.
- Vue Mini needs an immutable array replacement (`rows.value = [...rows.value]`)
  for list changes; in-place mutation is not a reliable trigger.
- minidev can retain stale DOM across `reLaunch`; always use the neutral route
  and treat small update differences as noise.
- A scalar-only `#bump` on this 5000-row page measured 55 ms for both Vue Mini
  and uni-app (single runs). That is at the simulator polling floor, so it does
  not mean uni-app's full-data diff is free; it means this harness cannot
  resolve it without a larger payload or a data-diff counter.
- No `setData` count or byte metric is available here. The rich-row update is
  the wall-clock proxy for that missing metric.

## Scope

The fixtures are source-only; `node_modules` and build output are ignored. They
are not part of the repository workspace and do not affect Glaze's normal build.
Keep the comparison diagnostic: the production benchmark remains the
same-harness Glaze/native suite in `docs/optimizations.md`.
