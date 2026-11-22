# Single-file snippets

`glaze snippet` turns one TSX file into a standalone mini-program project.
The generated project has a `project.config.json` and a `miniprogram/` tree; it
can be opened in WeChat DevTools or run with minidev. It does not create a
DevTools share link; sharing a code snippet remains a DevTools UI action.

## Usage

```bash
glaze snippet ./Page.tsx
# -> ./page-snippet/project.config.json
#    ./page-snippet/miniprogram/

glaze snippet ./Page.tsx --out ./demo
glaze snippet ./Page.tsx --out ./demo --force
```

- The default output is `<kebab-case-source-name>-snippet` in the current
  directory, so `HelloWorld.tsx` becomes `hello-world-snippet/`.
- An existing non-empty output directory is refused; `--force` replaces it.
  The output directory must not contain the source file.

## Source format

```tsx
import { createSignal } from 'solid-js'

export const glaze = {
  project: {
    appid: 'touristappid',
    projectname: 'My snippet',
  },
  app: {
    window: {
      navigationBarTitleText: 'My snippet',
    },
  },
  page: {
    route: 'pages/index/index',
    config: {
      navigationBarTitleText: 'Demo',
    },
  },
  tailwind: true,
}

export default function Page() {
  const [count, setCount] = createSignal(0)
  return (
    <view class="p-4">
      <text class="count">{count()}</text>
      <button onClick={() => setCount(count() + 1)}>+</button>
    </view>
  )
}
```

`glaze` is a compile-time export. The builder removes it before compiling the
component. Its value must be a static JSON-like object: strings, numbers,
booleans, null, arrays and objects only. Function calls, identifiers and
computed keys are rejected. TypeScript `as const` / `satisfies` wrappers are
accepted.

### `project`

Merged into `project.config.json`. Glaze forces:

```json
{
  "miniprogramRoot": "miniprogram/",
  "compileType": "miniprogram",
  "appid": "touristappid",
  "setting": { "es6": false, "minified": false }
}
```

`appid`, `projectname` and `setting` can be overridden. The generated project is
a normal mini-program project, not a DevTools share link.

### `app`

Merged into `app.json`. Glaze forces `pages: [route]`,
`componentFramework: "glass-easel"` and
`window.glassEaselWebview: true`; other `window` fields are merged.

### `page`

`route` defaults to `pages/index/index`. `config` is merged into the generated
page `index.json` (for example navigation title). Only one page is generated.

### `tailwind`

`true` generates:

```css
@import "tailwindcss" source(none);
@source "./**/*.{tsx,ts}";
```

and enables `css.tailwind` in the temporary build config. An object form
supports `safelist`:

```tsx
tailwind: { safelist: ['text-[40rpx]'] }
```

`tailwindcss` and `weapp-tailwindcss` are optional peers of `@glaze/build`.
Tailwind runs after the component build, so class escaping and `app.wxss`
generation are the same as a normal Glaze project.

## Generated output

```text
page-snippet/
├── project.config.json
└── miniprogram/
    ├── app.js
    ├── app.json
    ├── app.wxss
    ├── pages/index/index.{js,json,wxml,wxss}
    ├── components/glaze-page/...
    └── glaze-runtime/index.js
```

The original TSX is not copied into the output; it remains the source of truth
for the next `glaze snippet` run. The output is compiled code plus the project
shell.

## Limits

- One page and one entry component per file.
- `app.js` is generated as `App({})`; custom app lifecycle code is not available.
- No separate WXSS source; use Tailwind classes and inline `style` bindings.
- No assets; use remote URLs.
- Strictly static `glaze` config; no runtime values.
- minidev validates the generated project. DevTools snippet creation/sharing is
  a manual UI step and is not automated.
