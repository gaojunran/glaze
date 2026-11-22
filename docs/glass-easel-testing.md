# Testing below minidev

minidev is the end-to-end check: it boots a real mini-program bundle in a
headless Chromium and drives it through the automator. It is the right place to
verify WXML, WXSS, routing and platform behavior, but it is slow and hides the
component runtime inside a browser.

glass-easel exposes enough primitives to test the same runtime in Node without a
browser.

## The layers

| Layer | What it proves | Speed |
| --- | --- | --- |
| `packages/*/test/*.test.ts` with fake component instances | pure data/binding/list logic | milliseconds |
| glass-easel `ComponentSpace` + `EmptyBackendContext` | real glass-easel lifecycle, property observers, DataGroup queues, event dispatch | milliseconds |
| `TmplGroup` + `ComponentSpace` + `EmptyBackendContext` | actual WXML rendering: text/attribute/class bindings, `wx:if`, keyed `wx:for`, events, child props and custom events | tens of milliseconds |
| minidev e2e | compiled WXML/WXSS, routing, subpackages, real browser layout | tens of seconds |

## A no-browser glass-easel harness

The runtime test file `packages/runtime/test/glass-easel.test.ts` does this:

```ts
import * as glassEasel from 'glass-easel'

const space = new glassEasel.ComponentSpace()
globalThis.Component = (config) => space.defineComponent(config)
const { defineGlazeComponent } = await import('../src/mini.ts')

const def = defineGlazeComponent({ /* ... */ })
const element = glassEasel.Component
  .createWithContext('root', def, new glassEasel.EmptyBackendContext())
  .general()

glassEasel.Component.pretendAttached(element)
```

`Element.setData`/`triggerEvent` then use the real glass-easel data path. The
tests cover:

- scalar bindings applied through `DataGroup`;
- list field patches and `spliceArrayDataOnPath`;
- custom event props and `event.detail`;
- `pretendDetached` / `pretendAttached` rebuilding;
- property observers updating a prop signal;
- one failing binding not freezing the rest.

Run it with:

```bash
pnpm --filter @glaze/runtime test
pnpm --filter @glaze/compiler test
```

## What this layer can and cannot catch

It catches:

- a binding that never reaches `DataGroup.data`;
- wrong path shapes (`b0` vs `b0[0].done`);
- list patch/splice mistakes;
- lifecycle bugs (`detached` leaves a live effect, reattach does not rebuild);
- property observer timing;
- event detail/option propagation.

It does not catch:

- WXML parsing or attribute quoting by itself (use the `TmplGroup` layer);
- WXSS, Tailwind and style isolation;
- page routing, subpackage loading and CDN behavior;
- real-device base-library differences.

## WXML-level testing

The platform's own template compiler is
[`glass-easel-template-compiler`](https://github.com/wechat-miniprogram/glass-easel/tree/main/glass-easel-template-compiler).
Its `TmplGroup` API compiles WXML to a gen-object and its Rust CLI can compile a
directory of WXML. `packages/compiler/test/wxml.test.ts` uses `TmplGroup` to
compile representative generated templates (control flow, slots, components,
async boundaries, WXS helpers, hyphenated attributes). This is stronger than
string matching for structural WXML validity, though the parser is permissive
about some malformed attribute quoting, so the compiler still needs its own
quote tests.

The upstream test setup (`glass-easel/tests/base/env.ts`) uses:

```ts
const group = TmplGroup.newDev()
group.addTmpl('', src)
const genObject = new Function(`return ${group.getTmplGenObjectGroups()}`)()
```

That object is passed to a `ComponentSpace` definition as `template`; the same
component can then be created with `EmptyBackendContext` and `pretendAttached`.
`packages/runtime/test/harness.ts` packages this flow as `compileTemplate`,
`register` and `mount`, and `packages/runtime/test/template.test.ts` uses it to
render real WXML for text/attribute/class bindings, `wx:if`/`wx:elif`/`wx:else`,
keyed `wx:for` with node reuse, normalized `bindtap` with dataset, child props
and custom events, and detach/reattach.

Two practical constraints:

- `solid-js` must load its client build, so tests run with
  `node --conditions=browser`. `--conditions` only affects ESM; a `require()` of
  `solid-js` still resolves to the server build and effects silently do nothing.
- Glaze emits native `bindtap`, while glass-easel's template parser understands
  `bind:tap`. The harness rewrites `bindX`/`catchX` to `bind:X`/`catch:X` outside
  `<wxs>` blocks before compiling WXML.

A few fields are intentionally not asserted at this layer: `class` is rendered
into the element dump rather than `getAttribute('class')`, component properties
are read from `elem.data` (component tag selectors are not supported), the
`ready` lifetime is not fired by glass-easel core (so boundary-context fixtures
need `glazecontext` set explicitly), and an empty `wx:for` list should start as
`[]` to avoid a platform warning.
