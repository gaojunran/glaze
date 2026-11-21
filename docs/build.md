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
| `source` | source root, a subdirectory of the project |
| `output` | generated mini-program root, a subdirectory of the project |
| `pages` | route → page component source, relative to `source` |
| `static` | directories whose contents are copied into the output root |
| `staticPages` | routes already present in `static` and kept in `app.json` |
| `clean` | replace the previous output after a successful build; defaults to `true` |

Paths are validated before anything is written:

- `source` and `output` must both be strict subdirectories of the project;
- `output` must not be the project root, `source`, inside `source`, or an
  ancestor of `source`;
- `output` must not contain the internal staging directory
  `.tmp/glaze-build`.

This protects the project from a config typo such as `output: 'src'` or
`output: '.'` deleting source files or the project itself.

## Build pipeline

1. Load and validate the config, source directory, output path and pages.
2. Compile the configured page components first.
3. Discover components from each page's compiled result and compile only the
   components that are reachable. Unrelated `.tsx` files under `source` are
   never parsed.
4. Write into a staging directory under `.tmp/glaze-build`.
5. Replace `output` only after the whole build succeeds.

Because the output is staged, a failed compile or a missing page leaves the
previous `output` directory intact. `clean: false` merges the staged files into
the existing output instead of replacing it.

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
- `index.json` — `component: true`, `styleIsolation: "apply-shared"`,
  `usingComponents`, and `multipleSlots` when the component declares named
  slots;
- `index.wxss` — its own styles plus styles from inlined children.

Only components actually reached from a page are emitted. A component that is
always inlined (`Header` in the example) does not get an output directory.

Generated modules bundle with `minify: true` and always resolve `solid-js` from
the builder's own copy. The runtime is still duplicated per component; a shared
runtime chunk is a future improvement. A simple component currently produces a
roughly 30 KB bundle instead of the previous 75–90 KB.

## Module resolution

The compiler emits the source file's import statements. The builder passes the
generated module to esbuild through `stdin` with the original source file's
directory as `resolveDir`, so helper imports resolve relative to the TSX file
rather than the staging directory:

```tsx
import { fmt } from './utils/format'
import data from './data.json'
import type { Label } from './types'
```

Both `.ts` helpers, JSON modules and type-only imports are bundled or erased by
esbuild as usual.

Output names are derived from the path relative to `source`:
`pages/FooBar.tsx` becomes `glaze-pages-foo-bar`. Path separators are
normalized to `/` before the name is generated, so Windows and POSIX produce the
same names. If two source files map to the same name, the build fails with both
paths instead of silently overwriting one component.

## WXSS limits

Component styles are copied next to the generated component, so source-relative
WXSS references cannot work:

- `@import` is rejected with an error naming the source `.wxss` file;
- `url()` is rejected unless it is absolute (`/...`), remote (`http:`,
  `https:`), protocol-relative (`//...`) or a `data:` URL.

Inlining `@import` and copying assets is not implemented yet.

## Static pages

`staticPages` routes are unioned into `app.json.pages` and deduplicated. If a
route is already listed in `staticPages`, the builder does not generate a page
wrapper over it, so the static page keeps ownership of that route.

## App shell

`app.js` and `app.wxss` are copied when present. If either is missing the build
still succeeds, but warns clearly because a mini-program normally needs both.
`app.json` is copied when present; otherwise a minimal glass-easel default is
written.

## Command

```bash
pnpm build
# or, inside the example
pnpm --filter @glaze/example-solid-todo build
```

The CLI requires a command and prints usage for `--help`:

```bash
node packages/build/src/cli.mjs --help
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

Every rebuild reloads the config with a cache-busting query, so editing
`glaze.config.mjs` takes effect without restarting the watcher. When the config
changes `source`, the watcher targets are rebuilt as well.

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

Builder tests:

```bash
pnpm --filter @glaze/build test
```

They build temporary projects and cover: page wrappers and inlined children,
helper/JSON/type-only imports, output path safety, preservation of previous
output on failure, `clean: false` merging, reachability, output-name collisions, Windows separators,
WXSS portability, `staticPages` deduplication, app shell warnings, config
reloads, CLI help and generated `styleIsolation`.

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

1. **Watch is a full rebuild.** Every change reruns the whole pipeline; config
   reloads and watcher targets are refreshed, but there is no incremental
   compile.
2. **Vite plugin is a build bridge.** It does not provide mini-program HMR or a
   web preview renderer.
3. **No asset pipeline.** Images and other assets are copied only through
   `static`.
4. **No per-page config.** `app.json` window/navigation settings are shared.
5. **Output ownership is all-or-nothing.** `clean: true` replaces the whole
   output directory; custom files must live in `static`.
6. **Each component bundles its own runtime.** `solid-js` is deduplicated within
   a bundle and minified, but not shared between component bundles yet.
7. **WXSS references need manual handling.** `@import` is rejected and relative
   `url()` must be rewritten before building.

## Rejected alternatives

**Vite plugin first.** Vite assumes a web output model: HTML entry points,
module graph, HMR. A mini-program needs a fixed directory contract and
`usingComponents` JSON. Building the directory contract first makes the Vite
plugin a wrapper, not a rewrite.

**Compile pages directly to WXML/JS without a wrapper component.** A page could
host the Solid root itself, but then every page entry needs the runtime and
lifecycle bridge inline. A single wrapper component keeps that logic in one
place and matches the already-tested component path.
