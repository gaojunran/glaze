# UI SDK port

This document records the first `vercel-labs/ui` integration attempt: why its
runtime cannot be mounted in Glaze, what was ported instead, and what the port
exposed in the compiler.

Reference: `vercel-labs/ui` `0.1.0-beta.16` at `926dab8`.

## Direction

`@ui-sdk/core` is a behavior library, not a mini-program component library. Its
Solid adapter (`@ui-sdk/solid`) renders DOM elements and drives them with DOM
events, focus, hover and measurement APIs. The package was therefore used as an
**API and state-name reference**, not as a dependency:

- component names, prop names and `data-slot` / `data-state` / `aria-*`
  attributes come from the UI SDK;
- behavior is reimplemented in Glaze TSX so the compiler can turn it into
  static WXML;
- no `@ui-sdk/core` runtime is shipped.

The components live in `packages/ui/src/` and are published as `@glaze/ui`
workspace subpath exports. `examples/solid-todo/src/UiPage.tsx` imports them
from `@glaze/ui/button`, `@glaze/ui/toggle`, and so on.

## Why an adapter is not enough

The Solid adapter renders any tag through a dynamic component and dynamic
spread:

```tsx
const Tag = dynamic(() => tag)
return <Tag {...resolved} />
```

Glaze rejects both. A capitalized JSX tag needs an import the compiler can
resolve to TSX, and JSX spread only accepts static object literals. A runtime
`tag` is a web-only concept; WXML has no equivalent.

The core is also DOM-bound. It stores `HTMLElement` handles on every part and
uses `focus`, `getBoundingClientRect`, `ResizeObserver`, `MutationObserver`,
`window` and `document` throughout. Mini-program appservice code has none of
those, and WXML nodes are not `HTMLElement`s. A `@ui-sdk/glaze` package would
need a host abstraction in the upstream core first; that is a cross-project
change, not an adapter file.

The web stylesheet (`packages/core/src/web.css`) is not portable either:
`light-dark()`, `:where()`, `focus-visible` and `[data-slot]` selectors assume a
browser. The port uses plain WXSS and keeps only the token names and state
attributes.

## Ported components

| File | Root | Notes |
| --- | --- | --- |
| `UiButton.tsx` | `button` | `variant`, `size`, `block`, `disabled`, `loading`, `hoverClass`; `onPress` |
| `UiToggle.tsx` | `button` | controlled `pressed` or uncontrolled `defaultPressed`; `onPressedChange`; `aria-pressed` |
| `UiSwitch.tsx` | `button` | controlled `checked` or uncontrolled `defaultChecked`; `onCheckedChange`; `aria-checked` |
| `UiField.tsx` | `view` | `label`, `description`, `error`, `required`; default slot |
| `UiInput.tsx` | `input` | controlled `value`, `placeholder`, `type`, `disabled`; `onValueChange` |
| `UiDialog.tsx` | `view` | controlled `open` or uncontrolled `defaultOpen`; mask close, scroll lock, title/description, default slot |
| `UiCheckbox.tsx` | `view` | controlled/uncontrolled checked state; `aria-checked`; default slot label |
| `UiRadio.tsx` | `view` | controlled/uncontrolled checked state; groups are composed by the page |
| `UiTabs.tsx` | `scroll-view` | `items`, controlled/uncontrolled `value`, `onValueChange`; header only, no panel |
| `UiCollapsible.tsx` | `view` | controlled/uncontrolled open state, title, default slot; accordions are composed from multiple instances |

Package components are always component boundaries in this iteration. The
compiler only inlines a relative import; `@glaze/ui/*` imports are resolved by
`@glaze/build` and emitted as real mini-program components. A future change can
opt package-internal pure parts back into inlining once their source path is
tracked across the package boundary.

`UiDialog` is a fixed overlay inside the component tree, not a portal. A
`position: fixed` overlay already escapes layout in WXML, and the mask and panel
use `catchtouchmove` to stop the page behind it from scrolling. There is no
web-style focus trap: WXML has no global `keydown` event, and only native
`input`/`textarea` expose `focus`. The dialog exposes `role="dialog"` and
`aria-modal="true"`; a real focus model is a platform-level limitation, not a
missing prop.

### Naming constraints

The port cannot use the UI SDK names verbatim:

1. **Native WXML tags are reserved.** `<Button>`, `<Input>` and `<Switch>`
   collide with the built-in `button`, `input` and `switch` tags. The compiler
   rejects them, so the port uses `UiButton`, `UiInput` and `UiSwitch`.
2. **Event props collide with native events.** `onClick` is rejected because
   `click` maps to the native `tap` event. The port uses `onPress`. `onInput`
   is rejected for the same reason; the port uses `onValueChange`, which is
   also the UI SDK name.

Both rules apply to every future component, so a published Glaze UI kit should
use a `Ui` prefix and avoid native event names.

## Compiler fix found by the port

`<UiInput value={name()} />` initially disappeared from the generated WXML.
The compiler treated every imported identifier as a potential context and
compiled `<UiInput value={...}>` as `<Context.Provider value={...}>`: its
children were compiled as provider content and its own element was dropped.

The fix separates context discovery from imports:

- `analyzeComponent` now collects `importedContexts` only from
  `useContext(Name)` and `<Name.Provider>`, not from every import;
- `compileElement` only treats an imported tag with a `value` attribute as a
  provider when it is in that set, so an imported component with a `value` prop
  — including one named `ContextMenu` — compiles as a component;
- a provider-only file that imports a context should use
  `<Context.Provider value={...}>`; the direct `<Context value={...}>` form is
  reserved for a context created in the same file or already passed to
  `useContext` there;
- every import still stays in `contextKeys`, so `useContext` and `.Provider`
  keep working with aliased imports.

Regression tests cover both sides: an imported component with a `value` prop
compiles as a component, and an imported `ThemeContext` still compiles as a
provider.

This also matters outside the UI package: any imported component with a `value`
prop was previously swallowed.

## Package imports

`@glaze/ui` is a source-only workspace package. Its `package.json` maps each
subpath to a `.tsx` file:

```json
"exports": { "./button": "./src/UiButton.tsx" }
```

`@glaze/compiler` now accepts a non-relative component import when
`resolveComponent` returns a source; `@glaze/build` resolves the package with
`createRequire(project/package.json).resolve`, loads the TSX into the same
source map, and emits it under a stable external name such as
`glaze-ext-packages-ui-src-ui-button`. The compiler drops the package import
from the parent bundle once the child is emitted separately. Relative imports
inside a package component still resolve and load lazily, so a package can have
internal component dependencies.

The package ships `src/jsx.d.ts` declaring mini-program intrinsic elements for
`tsc`; the Glaze compiler owns JSX parsing and does not use that declaration.

## Validation

Commands and results from the package migration:

```bash
cd examples/solid-todo && pnpm build
# glaze build: 24 pages, 51 components

mise exec -- pnpm -r test
# shared 2, store 8, runtime 266, compiler 324, build 126 = 726, 0 failed

mise exec -- pnpm -r --if-present typecheck
# 7 packages Done (shared, store, ui, runtime, compiler, build, vite-plugin)

cd ~/Playground/minibuild
target/debug/minidev test \
  --project ~/Projects/glaze/examples/solid-todo \
  --browser ~/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell \
  --spec tests/ui.test.js
# 1 case, 1 passed (13 cases total with the existing suite)
```

`tests/ui.test.js` covers:

- button press crossing the component event boundary and updating page state;
- controlled toggle and switch state plus `aria-pressed` / `aria-checked`;
- uncontrolled toggle and switch initial defaults and taps;
- checkbox and radio controlled state, tabs selection, and collapsible open/close;
- controlled input updates, empty-value validation through `UiField`, and the
  conditional error element;
- loading state switching through a second button;
- dialog open from a button, slot content, mask close, and scroll lock.

This is minidev simulator validation (base library 3.17.3). A manual real-device
smoke was also run through `minidev preview` with a test appid after enabling
`setting.es6`; it found no blocking issues in rendering or the tap/dialog/input
paths. It is a single-device smoke, not a device matrix.

## Trade-offs and rejected alternatives

- **Vendoring `@ui-sdk/core`**: rejected. The parts are `HTMLElement` handles;
  the behaviors need keyboard, hover and focus events that WXML does not emit.
- **`<web-view>`**: rejected as the main route. It loses native WXML, works only
  as a full-page escape hatch, and cannot share state with the page.
- **Copying `web.css`**: rejected. The stylesheet uses browser-only functions
  and attribute selectors; component WXSS also rejects tag, id and attribute
  selectors. The port uses class-based state.
- **Uncontrolled state**: implemented as `defaultPressed`, `defaultChecked` and
  `defaultOpen` with an internal signal. A controlled prop wins when it is
  present; an uncontrolled component updates its own signal and still emits the
  change event.
- **Hover**: native `hover-class` is exposed as `hoverClass` on buttons, toggles
  and switches. It is press feedback, not CSS `:hover`; WXSS has no pointer
  hover state.
- **Keyboard and focus traps**: not implemented. Mini-program touch interaction
  has no hardware-keyboard navigation and WXML exposes no global key events; a
  dialog would need a `scroll-view` focus model or a platform-native overlay.
- **Real component boundaries**: every `@glaze/ui/*` import is a real
  glass-easel boundary, so the package pays the same per-component property
  cost as application components. Pure projection inlining only applies to
  relative imports today.

## Next steps

1. Re-check the UI SDK API before publishing; `0.1.0-beta.16` is still beta.
2. Consider making a package component inlinable again when it is a pure
   projection, so `UiSwitch` and `UiInput` stop paying a boundary cost.
3. Replace the dialog's touch-only model only if the platform gains a usable
   focus/keyboard surface; do not emulate a web focus trap with timers.
4. Decide whether a richer `UiAccordion` (multiple items with per-item slots)
   is worth a generated child-component design; the current `UiCollapsible` is
   the honest primitive.
