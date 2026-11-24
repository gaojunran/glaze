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

The spike lives in `examples/solid-todo/src/ui/` and is exercised by
`pages/ui/index`.

## Why an adapter is not enough

The Solid adapter renders any tag through a dynamic component and dynamic
spread:

```tsx
const Tag = dynamic(() => tag)
return <Tag {...resolved} />
```

Glaze rejects both. Its compiler requires a relative component import for a
capitalized JSX tag and only accepts static object literals for JSX spread. A
runtime `tag` is a web-only concept; WXML has no equivalent.

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

| File | Root | Kind | Notes |
| --- | --- | --- | --- |
| `UiButton.tsx` | `button` | boundary | `variant`, `size`, `block`, `disabled`, `loading`; `onPress` |
| `UiToggle.tsx` | `button` | boundary | controlled `pressed` + `onPressedChange`; `aria-pressed` |
| `UiSwitch.tsx` | `button` | inlined | controlled `checked` + `onCheckedChange`; `aria-checked` |
| `UiField.tsx` | `view` | boundary | `label`, `description`, `error`, `required`; default slot |
| `UiInput.tsx` | `input` | inlined | controlled `value`, `placeholder`, `type`, `disabled`; `onValueChange` |

`UiSwitch` and `UiInput` are pure projections and are inlined into the parent
WXML. The other three read event props or own a slot, so they stay real
glass-easel component boundaries. This is the same split the compiler already
applies to application components.

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

This also matters outside the UI spike: any imported component with a `value`
prop was previously swallowed.

## Validation

Commands and results from the spike:

```bash
cd examples/solid-todo && pnpm build
# glaze build: 19 pages, 38 components

mise exec -- pnpm -r test
# shared 2, store 8, runtime 202, compiler 302, build 123 = 637, 0 failed

mise exec -- pnpm -r --if-present typecheck
# 6 packages Done

cd ~/Playground/minibuild
target/debug/minidev test \
  --project ~/Projects/glaze/examples/solid-todo \
  --browser ~/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell \
  --spec tests/ui.test.js
# 1 case, 1 passed (12 cases total with the existing suite)
```

`tests/ui.test.js` covers:

- button press crossing the component event boundary and updating page state;
- controlled toggle and switch state plus `aria-pressed` / `aria-checked`;
- controlled input updates, empty-value validation through `UiField`, and the
  conditional error element;
- loading state switching through a second button.

This is minidev simulator validation (base library 3.17.3), not a real-device
run.

## Trade-offs and rejected alternatives

- **Vendoring `@ui-sdk/core`**: rejected. The parts are `HTMLElement` handles;
  the behaviors need keyboard, hover and focus events that WXML does not emit.
- **`<web-view>`**: rejected as the main route. It loses native WXML, works only
  as a full-page escape hatch, and cannot share state with the page.
- **Copying `web.css`**: rejected. The stylesheet uses browser-only functions
  and attribute selectors; component WXSS also rejects tag, id and attribute
  selectors. The port uses class-based state.
- **Uncontrolled state**: not implemented. `UiToggle` and `UiSwitch` are
  controlled only; `defaultPressed` / `defaultChecked` and internal signals are
  follow-up work.
- **Keyboard, hover and focus traps**: not implemented. Mini-program touch
  interaction has no hardware-keyboard navigation; a dialog would need a
  `scroll-view`-based focus model or a platform-native overlay.
- **Real component boundaries**: `UiButton`, `UiToggle` and `UiField` are real
  glass-easel boundaries, so they pay the same per-component property cost as
  application components. Pure parts (`UiSwitch`, `UiInput`) are inlined.

## Next steps

1. Extract the port into `@glaze/ui` once the build can compile TSX from a
   workspace package. Today `collectTsx` only walks the configured `source`
   directory and the compiler resolves component imports relative to the
   source tree.
2. Add `UiCheckbox`, `UiRadio`, `UiTabs`, `UiAccordion` and `UiDialog`. The
   first four are pure/controlled and cheap; a dialog needs an overlay model
   and a decision about focus handling.
3. Add uncontrolled variants and `aria-*` coverage tests per component.
4. Re-check the UI SDK API before publishing; `0.1.0-beta.16` is still beta.
