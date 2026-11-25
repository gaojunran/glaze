# Page runtime (`pageRuntime: "page"`)

By default a Glaze page is a native `Page` whose WXML contains one
`<glaze-page>` custom component. The page root component owns the Solid root and
projects its bindings through `Component.setData`. This is safe for every page,
including page events and page context, but it puts the whole page content one
component level below the page.

`pageRuntime: "page"` removes that level for every eligible page. Use
`{ pages: [route, ...] }` to opt in per route; the listed pages run directly and
the rest keep the default component wrapper.

```ts
// glaze.config.mts
const config: GlazeConfig = {
  pageRuntime: 'page',
  // or: pageRuntime: { pages: ['pages/bench/index'] },
}
```

The option is opt-in. The default remains `"component"`.

## What changes

For a direct page the builder writes the page files instead of a wrapper plus a
root component:

| File | Default (`component`) | `page` |
| --- | --- | --- |
| `index.wxml` | `<glaze-page id="app" />` | the compiled page WXML, with the root element carrying `id="app"` |
| `index.js` | `Page({ data: {} })` wrapper | the compiled page module, registering `defineGlazePage` |
| `index.json` | `usingComponents.glaze-page` | the page's own component map |
| `index.wxss` | empty | the compiled page styles |

`defineGlazePage` reuses the component definition built by
`defineGlazeComponent`. Only the host changes:

| Component lifetime | Page method |
| --- | --- |
| `created` | `onLoad` (after the page query is stored) |
| `attached` | `onReady` |
| `ready` | `onReady`, after `attached` |
| `beforeDetach` | `onUnload`, before disposal |
| `detached` | `onUnload` |
| `pageLifetimes.show/hide/resize` | `onShow` / `onHide` / `onResize` |

The page root has no component property bridge, so `props` is empty. `refs`,
bindings, events, async boundaries, `onComponentError`, page visibility, page
size and app visibility use the same runtime code; only `setData` is called on
the page instance.

## When it is used

The builder falls back to the component wrapper when the page needs the page
wrapper's forwarding or property bridge:

- the page or a child uses `usePageOptions`, `usePageEvent` or `onPageEvent`
  (page context);
- the page source references a page event such as `onPageScroll`,
  `onShareAppMessage` or `onPullDownRefresh`.

Static routes are left untouched. A root that is not a `<view>`, or whose
`<view>` already has an `id`, is wrapped in `<view id="app">` instead of
falling back to a component, so the page still runs directly.

## Compatibility detail

The first root `<view>` receives `id="app"` so existing page selectors and
`outerWxml()` checks still work. If the root is not a `<view>`, the builder
wraps the page in `<view id="app">`; the wrapper is a plain WXML node, not a
component, so it does not restore the old component boundary cost.

The page has no `moved` lifetime and no component `error` lifetime. Errors from
bindings and event handlers still reach `onComponentError`; unsupported
component-only hooks are simply absent on a page root.

## Measured result

500 real child components, `update-all`, real tap, in-appservice
`setData` callback, minidev (not a phone):

| Shape | Component root | `pageRuntime: "page"` |
| --- | ---: | ---: |
| 500 stateful children, 8 props | 60.1 ms | 15.6–23.3 ms |
| 500 children, 1 prop | 61.1 ms | 19.4–19.8 ms |
| 500 children, 16 props | 81.3 ms | 30.2–30.8 ms |

This is simulator evidence. The same-page native comparison (`Page` vs
`Component`) is also simulator-only; real-device confirmation is still needed
before making this the default.

Validate with:

```bash
cd examples/solid-todo
mise exec -- pnpm build
cd ~/Playground/minibuild
target/debug/minidev test \
  --project /data/home/nebula/Projects/glaze/examples/solid-todo \
  --browser ~/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell
```

Unit coverage lives in `packages/runtime/test/page.test.ts` and
`packages/build/test/build.test.ts`.
