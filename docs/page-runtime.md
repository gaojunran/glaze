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

500 real child components, `update-all`, real tap, in-appservice `setData`
callback, minidev (not a phone). Values are median (min–max) of three runs:

| Prop-shape | Glaze component root | Glaze page root |
| --- | ---: | ---: |
| 1 prop | 60.5 (58–63) ms | **19.7 (18.9–22.6) ms** |
| 2 props | 66.5 (63–70) ms | **24.2 (22.4–26.3) ms** |
| 4 props | 69.5 (63–76) ms | **23.1 (22.8–27.9) ms** |
| 8 props | 78 (67–89) ms | **25.6 (24.8–34.3) ms** |
| 16 props | 85 (75–95) ms | **30.5 (28.7–52.6) ms** |

![500 real child components: Glaze component root, page root, native and uni-app](assets/page-runtime-prop-shape.svg)

The chart also includes the native WXML page and uni-app measured in the same
precise harness: native stays at 14 / 16.5 / 18 / 22.5 / 32 ms and uni-app at
33 / 31 / 32.5 / 36.5 / 42 ms for 1 / 2 / 4 / 8 / 16 props. At 16 props the
component root is 85 ms, the page root 30.5 ms, native 32 ms and uni-app 42 ms;
the page root removes the component-boundary tax but keeps the per-child work,
so native is still slightly ahead.

A separate `bench-component-rows` case (500 stateful children with 8 props)
measured 60.1 ms on the component root and 15.6–23.3 ms on the page root in an
earlier run.

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
