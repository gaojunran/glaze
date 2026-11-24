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

`glaze.config.mts`:

```ts
import type { GlazeConfig } from "@glaze/build"

const config: GlazeConfig = {
  source: 'src',
  output: 'miniprogram',
  pages: {
    'pages/index/index': 'Counter.tsx',
    'pages/bench/index': 'Bench.tsx',
  },
  static: ['static'],
  staticPages: ['pages/native/index'],
  subpackages: [
    { root: 'pkg', pages: { 'pages/sub/index': 'PkgPage.tsx' } },
    { root: 'isolated', pages: { 'pages/sub/index': 'IsoPage.tsx' }, independent: true },
  ],
  pageConfig: {
    'pages/index/index': { navigationBarTitleText: 'Counter' },
  },
  runtime: { bindingGroupSize: 8 },
}

export default config
```

| Field | Meaning |
| --- | --- |
| `source` | source root, a subdirectory of the project |
| `output` | generated mini-program root, a subdirectory of the project |
| `pages` | route → page component source, relative to `source` |
| `static` | asset entries copied into the output; a string copies its contents to the root, an object can set `to` and `subpackage` |
| `staticPages` | routes already present in `static` and kept in `app.json` |
| `subpackages` | subpackage roots, their page maps, and optional `independent: true` |
| `pageConfig` | per-route page JSON merged into the generated page config |
| `clean` | replace the previous output after a successful build; defaults to `true` |
| `runtime.bindingGroupSize` | scalar bindings per effect; a positive integer, default `8`, `1` disables grouping |
| `css.tailwind.input` | optional Tailwind 4 stylesheet; enables the Tailwind stage |
| `css.tailwind.safelist` | class names that do not appear as literal source text |

Paths are validated before anything is written:

- `source` and `output` must both be strict subdirectories of the project;
- `output` must not be the project root, `source`, inside `source`, or an
  ancestor of `source`;
- `output` must not contain the internal staging directory
  `.tmp/glaze-build`.

This protects the project from a config typo such as `output: 'src'` or
`output: '.'` deleting source files or the project itself.

Routes and subpackage roots are normalized before they are validated (leading
`./`, trailing slashes and Windows backslashes). Two subpackage roots or two
page config keys that normalize to the same value are rejected instead of the
last one silently winning. The same applies to two page routes that normalize
to the same route.

## SCSS and Less

SCSS and Less are compiled inside `@glaze/build`, not by the WeChat DevTools
compiler plugins. A component's sibling `style.scss` or `style.less` is
compiled to the generated `index.wxss`; `src/app.scss` and `src/app.less` are
compiled to the generated `app.wxss`. This keeps the output a portable
`wxml / js / wxss / json` package that minidev and `miniprogram-ci` can load.

Resolution order is `style.wxss` -> `style.scss` -> `style.less`, so an existing
`.wxss` keeps priority. Imports are resolved by the preprocessor from the style
file's directory, which means `@use './vars'` and `@import './vars.less'` work
as usual.

`sass@^1` and `less@^4` are optional peer dependencies. They are loaded only
when a matching style file exists; a missing package is a build error naming
the package to install. `app.scss` / `app.less` suppress the missing
`app.wxss` warning.

Tailwind should still use a `.css` entry. If a project uses both, the compiled
`app.wxss` is written first and the Tailwind-generated CSS is appended after
it; do not put `@import "tailwindcss"` inside `.scss` / `.less`.

Tailwind is documented separately in [tailwind.md](tailwind.md).
Single-file snippet projects are described in [snippet.md](snippet.md).

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
  pages/<route>.js       Page({ data: {} }); page-context pages add onLoad
  pages/<route>.json     usingComponents: { "glaze-page": ... }
  pages/<route>.wxml     <glaze-page id="app" />; page-context pages add glazepage
  pages/<route>.wxss     empty
  components/glaze-*/    compiled Solid components
  glaze-runtime/index.js shared Solid + Glaze runtime
  pages/native/...       static pages copied from static/
  <subpackage>/          subpackage pages and components; normal packages
                         share the main runtime, independent ones copy it
```

A page is a thin wrapper over a compiled component. That keeps the page itself
free of Solid runtime code and lets the same page component be tested as a
component.

When the page subtree uses page hooks, the wrapper adds an `onLoad` that
creates a per-instance page id and stores the route query in
`data.__glazePage`, and the WXML passes that object to `glaze-page` as
`glazepage`. The builder marks every page-context boundary on that path and
recompiles it with `pageContext`/`pageRoot`; unrelated components keep the
plain wrapper shape.

Each compiled component directory contains:

- `index.wxml` — structure and bindings;
- `index.js` — Solid setup and binding effects, bundled with esbuild;
- `index.json` — `component: true`, `styleIsolation: "apply-shared"`,
  `usingComponents`, and `multipleSlots` when the component declares named
  slots;
- `index.wxss` — its own styles plus styles from inlined children.

Page JSON starts from the generated `usingComponents` and merges
`pageConfig[route]` over it; a page config may add components but `glaze-page`
always points at the generated component. `pageConfig` keys are normalized too,
and two keys that normalize to the same route are a build error. Only components
actually reached from a page are emitted. A component that is
always inlined (`Header` in the example) does not get an output directory.

### Output collisions

The builder reserves every generated path before it copies static files or
writes page wrappers: component `index.*` files, the shared
`glaze-runtime/index.js`, page wrapper files, and the app shell files it is
going to write. A later writer that lands on a reserved path fails the build
with an `Output path collision` error naming both writers and the shared path.

This catches:

- a page route such as `components/glaze-app/index` that would overwrite the
  generated component for `App.tsx` (also inside a subpackage);
- a `static` file such as `static/components/glaze-app/index.wxml` or
  `static/glaze-runtime/index.js` that would overwrite generated code;
- a `static` file that would overwrite a generated page wrapper;
- two `static` entries that target the same output file.

Failures happen in the staging directory, so the previous `output` is left
intact.

An alternative was to let the last writer win or to check only static files
that look like generated paths. A single claim registry was chosen because it
covers page wrappers, per-package runtime copies and config-dependent app files
with one check, and because it runs before the staged write. Static-to-static
duplicates are rejected for the same reason: a silent last-wins copy hides a
config error.

Generated modules bundle with `minify: true` and resolve `solid-js` and the
Glaze packages through one shared `glaze-runtime/index.js` module. Components
are 0.6–3.4 KB each; the shared module is about 47 KB, so total runtime size is
roughly `47 KB + n × 1 KB` instead of `n × 30 KB`.

## Shared runtime

Every component bundle externalizes `solid-js`, `@glaze/runtime`,
`@glaze/runtime/mini` and `@glaze/store` to a relative `require()` of
`glaze-runtime/index.js`. The shim is generated per build by collecting the
named imports from the generated modules and their bundled helper files, then
bundling `solid-js` and the Glaze runtime once with the builder's own copies.
Solid 2 exposes `createStore` from the `solid-js` root entry; there is no
`solid-js/store` subpath, so a component imports it from `solid-js`.

Sharing is semantic as well as a size optimization: `createRoot`, `getOwner`
and `runWithOwner` must come from the same Solid module instance or effects
lose their owner and never clean up, and `defineStore` must use the same
registry or two component bundles would create two stores with the same id.

The builder rejects a namespace/default import from a shared specifier because
it cannot enumerate the names to re-export, and rejects a `static` file that
already occupies `glaze-runtime/index.js`. The shared file is referenced by
relative path, never an absolute `/glaze-runtime/...` path.

### Subpackages

`subpackages` entries generate `app.json.subPackages`. Roots are normalized
before validation: `./pkg/`, `pkg/` and `pkg\` all mean `pkg`, and duplicate
normalized roots are a build error. Each page route is `<root>/<page>`; the page
source path remains relative to `source`:

```ts
subpackages: [
  { root: 'pkg', pages: { 'pages/sub/index': 'pkg/Sub.tsx' } },
  { root: 'isolated', pages: { 'pages/sub/index': 'isolated/Sub.tsx' }, independent: true },
]
```

Components are grouped by the package their **source file** lives in. Every
package gets its own `components/` directory. A normal subpackage's bundles
`require()` the main `glaze-runtime/index.js` by a relative path; only an
`independent: true` package gets its own runtime copy, because it cannot require
main-package JavaScript. The shared shim is built once from the union of imports
across all packages that use the main runtime.

Ownership rules:

- a main page may only reach main-package components;
- a normal subpackage page may reach its own components and main-package
  components;
- an independent subpackage page may only reach components inside its own
  root;
- a page must live inside the package it declares.

A normal subpackage that imports a main component still works because the
generated path is absolute (`/components/...`); an independent subpackage that
does so is a build error.

Limitations:

- global Tailwind styles are still written once at the output root, so an
  independent subpackage cannot see them; use a `static` entry with
  `subpackage` for package-local assets;
- component class escaping is applied to every package's `components/` tree;
- a component cannot be shared by two packages when either is independent;
- page routes are normalized and rejected when they contain `..`, so a page
  cannot write outside the staged output;
- `require()` paths are checked by the build tests and e2e, because the
  platform build does not fail on a wrong relative path (it fails at runtime
  with a blank page).

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

Component imports may also come from a workspace package with a TSX subpath
export, e.g. `import UiButton from '@glaze/ui/button'`. The builder resolves the
specifier with `createRequire(project/package.json).resolve`, loads the `.tsx`
source into the same source map as project files, and emits it as a normal
component. A package component outside the configured `source` directory gets
an external output name such as `glaze-ext-packages-ui-src-ui-button`; only the
trailing `..` segments are removed. Relative imports inside that package
resolve lazily against the package file, so package-internal components do not
have to be listed in `pages` or copied into the project.

Output names are derived from the path relative to `source`:
`pages/FooBar.tsx` becomes `glaze-pages-foo-bar`. Path separators are
normalized to `/` before the name is generated, so Windows and POSIX produce the
same names. If two source files map to the same name, the build fails with both
paths instead of silently overwriting one component.

## Assets and WXSS references

`static` accepts strings and objects:

```ts
static: [
  'static',                                      // contents copied to the output root
  { from: 'assets', to: 'assets' },              // output/assets/*
  { from: 'pkg/assets', to: 'assets', subpackage: 'pkg' },
]
```

An object entry copies a directory's contents into `to` (relative to the output
root or the named subpackage). A single file is copied to `to` or to the target
directory. `subpackage` is normalized like a subpackage root.

Every `static` source must exist. A typo in `from` is a build error naming the
missing path; it is not skipped silently.

### Imported assets

A standard module import is bundled by esbuild with the `file` loader:

```tsx
import logo from './assets/logo.png'

<image src={logo} />
```

The asset is emitted next to the compiled component as
`assets/<name>-<hash>.<ext>`, and the generated module receives a
package-absolute URL such as
`/components/glaze-app/assets/logo-PVIPRHR2.png`. Supported extensions are
PNG, JPEG, GIF, WebP, SVG, WOFF/WOFF2/TTF/OTF/EOT, MP3 and MP4.

The absolute URL is deliberate: the same value works for a component prop and
for a component boundary, and an independent subpackage gets its own
`/<package>/components/.../assets/...` path.

### Static WXML references

A relative literal in a resource attribute is resolved from the source TSX and
must match a file copied by `static`:

```tsx
<image src="./assets/logo.png" />
<video poster="./assets/poster.jpg" />
```

`src` and `poster` are rewritten to a package-absolute path such as
`/assets/logo.png` or `/pkg/assets/logo.png`. This also applies when the literal
is passed as a component prop.

### Styles

Component styles are copied next to the generated component, so the builder
resolves asset references at build time:

- `url()` may be absolute (`/...`), remote (`http:`, `https:`),
  protocol-relative (`//...`) or a `data:` URL;
- a relative `url()` is resolved from the source stylesheet and must point at a
  file copied by `static`; the emitted URL is rewritten relative to the
  generated component directory;
- a relative `url()` with no matching `static` file is a build error;
- `@import` is still rejected with an error naming the source `.wxss` file.

The rewrite also runs for inlined child styles and for `app.wxss`.

### Dynamic references

A dynamic value is not rewritten:

```tsx
<image src={props.src} />
```

Use a package-absolute path (`/assets/logo.png`), a remote URL, or a runtime
value. Arbitrary JS strings are not inspected; only `import` and static
resource attributes are build-time asset inputs.

## Static pages

`staticPages` routes are unioned into `app.json.pages` and deduplicated. If a
route is already listed in `staticPages`, the builder does not generate a page
wrapper over it, so the static page keeps ownership of that route.

## App shell

`app.js` is copied when present, and `app.wxss` (or its `.scss`/`.less`
predecessor) is read, URL-rewritten, and written. If either is missing the build
still succeeds, but warns clearly because a mini-program normally needs both.
`app.json` is copied when present; otherwise a minimal glass-easel default is
written.

## Compiler warnings

Non-fatal compiler diagnostics are printed as
`glaze build: <file>: [<code>] <message>` and do not fail the build. The first
one is `GLAZE_UNTRACKED_READ_AFTER_AWAIT`, raised when an async computation
reads `props` after its first `await`; Solid cannot track that read, so the
memo would never retrigger. Read the value before awaiting.

## Command

```bash
pnpm build
# or, inside the example
pnpm --filter @glaze/example-solid-todo build
```

The CLI requires a command and prints usage for `--help`:

```bash
node packages/build/src/cli.ts --help
node packages/build/src/cli.ts build /path/to/project
```

Watch mode:

```bash
node packages/build/src/cli.ts watch /path/to/project
# or
pnpm --filter @glaze/example-solid-todo exec glaze watch
```

`watch` performs an initial build, then debounces source changes and serializes
rebuilds. It watches `.tsx`, `.ts`, `.js`, `.json`, `.wxml`, and `.wxss` files
under `source`, plus `glaze.config.mts`.

Every rebuild reloads the config with a cache-busting query, so editing
`glaze.config.mts` takes effect without restarting the watcher. When the config
changes `source`, the watcher targets are rebuilt as well.

Builds for the same project are serialized in-process, so the Vite plugin and
`watch` cannot race the atomic output swap. `watch` passes the changed paths to the builder. The builder keeps the compiled
result of each TSX file keyed by mtime and size, recompiles only changed files
and reuses cached results for the rest. If an inlined child changes, the
dependency graph marks its parents for recompilation too, because the parent
embeds the child's WXML. Style, asset, config and Tailwind changes still rerun
the whole write/serialization stage; only TypeScript compilation is
incremental.

## Vite plugin

`@glaze/vite-plugin` runs `buildProject` from `buildStart` and rebuilds on
hot updates to TypeScript/JavaScript, styles (`.wxss`, `.scss`, `.less`, `.css`),
JSON and config files. The changed file is passed to `buildProject` as
`changedFiles`, so the incremental compile cache can skip unaffected TSX files:

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
incremental compilation with dependency propagation, `watch` rebuilding a
changed inlined child and reloading a changed config, static asset copying and
WXSS URL rewriting, helper/JSON/type-only imports, output path safety,
preservation of previous output on failure, `clean: false` merging,
reachability, output-name collisions, output path collisions between page
wrappers, static files, components and the runtime, Windows separators, WXSS
portability, `staticPages` deduplication, app shell warnings, config reloads,
CLI help, generated `styleIsolation`, the shared runtime file, relative
`require()` resolution, namespace-import rejection, subpackage root
normalization and duplicate rejection, subpackage ownership and runtime
placement, page config merging and duplicate rejection, route validation, and
the Vite hot-update options. `build.test.ts` now has 59 builder tests and `edge-cases.test.ts` adds
61; compiler has 197 (including 96 independent edge cases and 7 glass-easel WXML
compilation cases), runtime has 90 (including 6 glass-easel lifecycle tests, 6 real WXML render
tests and 48 independent edge cases), shared 2. The runtime also covers first-pending, refetch
pending, and error recovery for a memoized async binding.

`pnpm --filter @glaze/build test` and `pnpm --filter @glaze/build typecheck`
are green on Node 22. The collision tests assert that the error names both
writers; the watch test asserts that changing `glaze.config.mjs` rebuilds into
the new output directory.

Real simulator run (nine cases, including asset loading through
`wx.getImageInfo`):

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

Result: nine e2e cases pass against the generated `miniprogram` directory,
covering the counter/control-flow/list/event/context/ref probe, review-boundary
probes, catch/capture/mut-bind, store seams, Tailwind, cross-file context, ref
queries, async boundaries and an independent subpackage. The counter case also
asserts the imported asset URL and loads it with `wx.getImageInfo`, then checks
the static `src` literal the same way.

On the example project (`pnpm build`, 9 pages, 20 components) the shared module
is 46,582 B and all generated component `index.js` files total 10,678 B. Before
the shared runtime the six-component version was about 195 KB of component JS.

## Known gaps

1. **Watch is only compile-incremental.** It still rewrites the staged output
   and reloads the config on every change; there is no mini-program HMR.
2. **Vite plugin is a build bridge.** It does not provide mini-program HMR or a
   web preview renderer.
3. **Dynamic asset values are not rewritten.** `src={value}` and JS strings must
   use package-absolute or remote URLs; only `import` and static `src`/`poster`
   literals are build-time inputs.
4. **Output ownership is all-or-nothing.** `clean: true` replaces the whole
   output directory; custom files must live in `static`.
5. **Tailwind output is not duplicated.** Global Tailwind styles are written once
   at the output root; an independent subpackage that needs them must copy or
   generate them itself.
6. **WXSS `@import` remains unsupported.** Use a preprocessor or inline the
   stylesheet before building.

## Rejected alternatives

**Vite plugin first.** Vite assumes a web output model: HTML entry points,
module graph, HMR. A mini-program needs a fixed directory contract and
`usingComponents` JSON. Building the directory contract first makes the Vite
plugin a wrapper, not a rewrite.

**Compile pages directly to WXML/JS without a wrapper component.** A page could
host the Solid root itself, but then every page entry needs the runtime and
lifecycle bridge inline. A single wrapper component keeps that logic in one
place and matches the already-tested component path.
