# Build

The build takes a Glaze project and writes a normal mini-program directory.

## Why a builder instead of a compiler script

The compiler only turns one TSX file into one component pair. A project also
needs:

- page wrappers;
- component discovery and `usingComponents`;
- the app shell;
- a place for hand-written static pages;
- a clean output directory so deleted files do not linger.

The `glaze build` command owns those steps. `glaze watch` reruns the same
pipeline on source changes. The Vite plugin is a thin wrapper around this
pipeline; Vite is not used to render the mini-program.

## Config

`glaze.config.mjs`:

```js
export default {
  source: 'src',
  output: 'miniprogram',
  pages: {
    'pages/index/index': 'Counter.tsx',
    'pages/bench/index': 'Bench.tsx',
  },
  static: ['static'],
  staticPages: ['pages/native/index'],
}
```

| Field | Meaning |
| --- | --- |
| `source` | source root, relative to the project |
| `output` | generated mini-program root, relative to the project |
| `pages` | route → page component source, relative to `source` |
| `static` | directories whose contents are copied into the output root |
| `staticPages` | routes already present in `static` and kept in `app.json` |
| `clean` | delete the output directory first; defaults to `true` |

## What it writes

```
miniprogram/
  app.js                 copied from src/app.js
  app.wxss               copied from src/app.wxss
  app.json               copied from src/app.json, pages replaced
  pages/<route>.js       Page({ data: {} })
  pages/<route>.json     usingComponents: { "glaze-page": ... }
  pages/<route>.wxml     <glaze-page id="app" />
  pages/<route>.wxss     empty
  components/glaze-*/    compiled Solid components
  pages/native/...       static pages copied from static/
```

A page is a thin wrapper over a compiled component. That keeps the page itself
free of Solid runtime code and lets the same page component be tested as a
component.

Each compiled component directory contains:

- `index.wxml` — structure and bindings;
- `index.js` — Solid setup and binding effects, bundled with esbuild;
- `index.json` — `component: true`, `usingComponents`, and `multipleSlots` when
  the component declares named slots;
- `index.wxss` — its own styles plus styles from inlined children.

Only components actually reached from a page are emitted. A component that is
always inlined (`Header` in the example) does not get an output directory.

## Command

```bash
pnpm build
# or, inside the example
pnpm --filter @glaze/example-solid-todo build
```

The CLI can also be run against another project:

```bash
node packages/build/src/cli.mjs build /path/to/project
```

Watch mode:

```bash
node packages/build/src/cli.mjs watch /path/to/project
# or
pnpm --filter @glaze/example-solid-todo exec glaze watch
```

`watch` performs an initial build, then debounces source changes and serializes
rebuilds. It watches `.tsx`, `.ts`, `.js`, `.json`, `.wxml`, and `.wxss` files
under `source`, plus `glaze.config.mjs`.

## Vite plugin

`@glaze/vite-plugin` runs `buildProject` from `buildStart` and rebuilds on a
`.ts`/`.tsx` hot update:

```js
import glaze from '@glaze/vite-plugin'

export default {
  plugins: [glaze({ project: process.cwd() })],
}
```

It is deliberately a build bridge, not a DOM renderer. `build: false` disables
the automatic build while keeping the plugin loaded.

## Validation

Builder test:

```bash
pnpm --filter @glaze/build test
```

It builds a temporary project and asserts the page wrapper, the inlined child
and the generated `app.json`.

Real simulator run:

```bash
cd ~/Playground/minibuild
target/debug/minidev build \
  --project ~/Projects/glaze/examples/solid-todo \
  --out ~/Projects/glaze/.tmp/sim
target/debug/minidev serve --dist ~/Projects/glaze/.tmp/sim --browser <chrome> --port 9422
target/debug/minidev test \
  --project ~/Projects/glaze/examples/solid-todo \
  --browser <chrome>
```

Result: the counter e2e passes against the generated `miniprogram` directory.

## Known gaps

1. **Watch is full rebuild.** Every change reruns the whole pipeline; there is
   no incremental compile yet.
2. **Vite plugin is a build bridge.** It does not provide mini-program HMR or a
   web preview renderer.
3. **No asset pipeline.** Images and other assets are copied only through
   `static`.
4. **No per-page config.** `app.json` window/navigation settings are shared.
5. **Output ownership is all-or-nothing.** `clean: true` deletes the whole
   output directory; custom files must live in `static`.

## Rejected alternatives

**Vite plugin first.** Vite assumes a web output model: HTML entry points,
module graph, HMR. A mini-program needs a fixed directory contract and
`usingComponents` JSON. Building the directory contract first makes the Vite
plugin a wrapper, not a rewrite.

**Compile pages directly to WXML/JS without a wrapper component.** A page could
host the Solid root itself, but then every page entry needs the runtime and
lifecycle bridge inline. A single wrapper component keeps that logic in one
place and matches the already-tested component path.
