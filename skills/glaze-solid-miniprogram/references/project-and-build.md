# Project layout, assets, styles and verification

## Project shape

A Glaze project has a normal mini-program shell plus TSX source:

```text
project/
  glaze.config.mts
  src/
    app.js
    app.json
    app.wxss
    pages/
      index/
        index.tsx          # or a flat file such as Counter.tsx
    components/
      TodoItem.tsx
      TodoItem.wxss
    assets/
      logo.png
    static/
      pages/native/index.*
  miniprogram/             # generated output; never edit by hand
```

The example project uses flat page components and maps routes explicitly. Keep
the project's existing convention; do not migrate page files just to match this
document.

## Config

```ts
import type { GlazeConfig } from '@glaze/build'

const config: GlazeConfig = {
  source: 'src',
  output: 'miniprogram',
  pages: {
    'pages/index/index': 'Counter.tsx',
    'pages/todo/index': 'pages/todo/TodoPage.tsx',
  },
  subpackages: [
    { root: 'pkg', pages: { 'pages/sub/index': 'pkg/PkgPage.tsx' } },
    {
      root: 'isolated',
      pages: { 'pages/sub/index': 'isolated/SubPage.tsx' },
      independent: true,
    },
  ],
  static: [
    'static',
    { from: 'assets/logo.png', to: 'assets/logo.png' },
    { from: 'pkg/assets', to: 'assets', subpackage: 'pkg' },
  ],
  staticPages: ['pages/native/index'],
  pageConfig: {
    'pages/index/index': { navigationBarTitleText: 'Counter' },
  },
  runtime: { bindingGroupSize: 8 },
  css: { tailwind: { input: 'src/tailwind.css', safelist: ['dynamic-class'] } },
}

export default config
```

Notes:

- `source` and `output` must be strict subdirectories of the project; `output`
  must not be the project root/source or contain it. Keep the existing paths.
- `pages` maps a route to a TSX file relative to `source`.
- `subpackages[].root` is normalized; each page route is `<root>/<page>`.
  Components are grouped by the package their source file lives in.
  Independent subpackages cannot reference main-package components; normal
  subpackages can.
- `static` copies assets. A string copies a directory's contents to the output
  root; an object can set `to`, and `subpackage` for a package-local asset.
- `staticPages` are routes already present in `static` and kept in `app.json`.
- `pageConfig` merges JSON into generated page config; `glaze-page` is always
  preserved.
- `clean: false` merges into existing output. Default is a staged full replace.
- `runtime.bindingGroupSize` controls scalar binding batching; do not tune it
  without a measured reason.

`app.json` must enable glass-easel for the WebView renderer:

```json
{
  "componentFramework": "glass-easel",
  "window": {
    "glassEaselWebview": true
  }
}
```

The WebView renderer needs base library 3.8.12+. Skyline uses glass-easel
natively, but this project's Skyline support is not validated.

## Assets

```tsx
import logo from './assets/logo.png'

<image src={logo} />
<image src="./assets/static-logo.png" />
```

- Imported assets use esbuild's file loader and emit to
  `<package>/components/<component>/assets/<name>-<hash>.<ext>`; the generated
  module gets a package-absolute URL. Supported: PNG, JPEG, GIF, WebP, SVG,
  WOFF/WOFF2/TTF/OTF/EOT, MP3, MP4.
- A relative static `src`/`poster` literal must match a file copied by `static`;
  the builder rewrites it to a package-absolute path.
- Dynamic values are not rewritten:
  ```tsx
  <image src={props.src} />       // use /assets/logo.png, https://..., or runtime data
  ```
- JS strings are not scanned for asset paths.

## Styles

- Put `Foo.wxss` (or `Foo.scss` / `Foo.less`) next to `Foo.tsx`. The build
  compiles it to the generated component's `index.wxss`.
- `src/app.wxss` / `app.scss` / `app.less` becomes the app stylesheet.
- Relative `url()` in a component stylesheet must resolve to a file copied by
  `static`; the URL is rewritten for the generated component directory.
- `@import` in WXSS is not supported. Use the build's SCSS/Less preprocessing
  or inline the stylesheet.
- A component that is inlined loses its own style isolation; its styles are
  appended to the parent stylesheet.
- Tailwind is optional and generated once at the output root. A normal
  subpackage can see global app styles; an independent subpackage cannot, so it
  needs its own `static` assets/styles.

## Build and watch

Use the project's existing command:

```bash
pnpm build
# or, if the project exposes it directly:
glaze build
glaze watch
```

`glaze watch` is compile-incremental, not mini-program HMR. It reloads the
config and recompiles changed TSX, propagating changes from an inlined child to
its parent because the parent embeds the child WXML. It still rewrites the
staged output and does not refresh a running devtools page automatically.

Do not edit `miniprogram/` or `.tmp/glaze-build/`. If a generated file looks
wrong, fix the TSX/config and rebuild.

## Verification

At minimum:

```bash
pnpm build
```

Then run the project's simulator/e2e command. In this repository that is:

```bash
cd ~/Playground/minibuild
target/debug/minidev test \
  --project ~/Projects/glaze/examples/solid-todo \
  --browser ~/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell
```

The build catches unsupported JSX, bad paths, output collisions, missing
assets and invalid styles. The simulator catches runtime paths the compiler
cannot prove: page load, WXML rendering, props/events, list splices, context
crossing a boundary, async refetch/reset and asset loading.

For a new UI behavior, add or update a test that observes the rendered text or
attribute, not just the compiler output. A passing build alone is not
behavioral verification.

## Common project questions

- **Where do I put a page?** Follow the existing `pages` map. A page entry is a
  TSX file with a default-exported component; the builder creates the page
  wrapper.
- **How do I add a route?** Add it to `pages` (or `subpackages[].pages`) and to
  `app.json`'s generated page list through the config; do not hand-edit the
  output app.json.
- **How do I add a static page?** Put it under a copied `static` directory and
  list the route in `staticPages`; the builder unions it into `app.json.pages`
  and does not wrap it.
- **Why is my component not a separate component?** It is pure and was inlined.
  Add state/lifecycle/slot/context/ref if the boundary is required, or accept
  the inlining and keep styles in the parent.
- **Why is my asset 404?** Dynamic strings are not rewritten; use an import or
  a `static` package-absolute path.
