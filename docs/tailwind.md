# Tailwind CSS

Glaze can compile a Tailwind CSS 4 entry into one `app.wxss` and rewrite the
Class strings in generated WXML/JS. It is optional: a project without
`css.tailwind` builds exactly as before.

## Why this lives in the builder

A Tailwind Vite plugin cannot do this job for Glaze. `@glaze/vite-plugin` only
calls `buildProject()` on Vite's lifecycle; the mini-program WXML/WXSS/JS files
are written by `@glaze/build`, outside Vite's CSS module graph.

The actual chain is:

```
TSX --@glaze/compiler--> WXML + JS
                         |
src/tailwind.css --------+--> weapp-tailwindcss/core
                         |      generate CSS, classNameSet
                         |
                         +--> app.wxss
                         +--> escaped WXML class strings
                         +--> escaped generated JS strings
```

`weapp-tailwindcss/core` supplies the Tailwind 4 generator, `.wxss` target,
class-name escaping and template/JS transforms. Glaze owns source discovery,
staging, watch and writing the mini-program output.

## Config

```ts
// glaze.config.mts
export default {
  source: 'src',
  output: 'miniprogram',
  pages: {
    'pages/index/index': 'Counter.tsx',
  },
  css: {
    tailwind: {
      input: 'src/tailwind.css',
      safelist: ['text-[20rpx]'],
    },
  },
}
```

`input` is required and must be inside the project. It is a normal Tailwind 4
entry:

```css
@import "tailwindcss" source(none);

@source "./**/*.{tsx,ts}";
```

`source(none)` disables Tailwind's automatic workspace scan. Add one or more
`@source` patterns for the source tree. The builder also collects static class
tokens from generated WXML and passes them as explicit candidates, so classes
introduced by the compiler still reach the generator.

`safelist` is for class names that do not appear as literal source text.

## What the builder writes

- Generated Tailwind CSS becomes `miniprogram/app.wxss`.
- If the project has a separate `src/app.wxss`, its contents are appended after
  the generated CSS so project rules keep overriding utilities. When `input` is
  `src/app.wxss` itself, it is not appended twice.
- Every generated component WXML is transformed, so Tailwind classes become
  WXSS-safe (`text-[24rpx]` -> `text-_b24rpx_B`).
- Every generated component JS is transformed with the same classNameSet. This
  covers `className(...)` values that only exist in the generated JavaScript.
- `miniprogram/app.json`, page wrappers and component JSON are unchanged.

Components use `styleIsolation: "apply-shared"`, so the global `app.wxss` reaches
component internals. Glaze does not inject a second Tailwind copy into each
component `index.wxss`.

## Dependencies

Install the optional peer packages in the project that enables the feature:

```bash
pnpm add -D tailwindcss@^4 weapp-tailwindcss@^5
```

The builder loads `weapp-tailwindcss/core` only when `css.tailwind` is present.
`weapp-tailwindcss` requires Node `^22.18.0 || >=24.11.0`; Glaze currently uses
the same Node range.

## Boundaries

- **Literal classes only for discovery.** Static class strings and class-object
  keys are scanned. A class assembled from arbitrary runtime data
  (`class={row.className}`) cannot be discovered; put those tokens in
  `safelist`.
- **Dynamic class values in JS are escaped only if Tailwind generated them.**
  The core transform uses an exact classNameSet hit, so ordinary business
  strings containing `/` or `:` are left alone.
- **`@apply` inside component `index.wxss` is not compiled.** Put Tailwind
  directives in the Tailwind entry. Component WXSS remains plain WXSS.
- **Variants follow mini-program semantics.** `hover:`/`focus:`/`group-*`/
  `peer-*` do not map 1:1 to touch UI or WXML event bubbling. Build success is
  not proof of the intended runtime interaction; verify the specific variant.
- **One global app.wxss for now.** Subpackage-specific Tailwind roots and
  independent subpackage isolation are not implemented. Everything is paid for
  on every page that loads the main package.
- **Preflight is global.** The Tailwind reset changes default `view`/`text`
  box model and spacing. Customize the Tailwind entry if the reset conflicts
  with existing WXSS.
- **CSS compatibility still needs runtime evidence.** Tailwind 4 can emit
  modern CSS; `weapp-tailwindcss` produces the mini-program target, but the
  result should be checked in the simulator and on a device.

## Validation

Example project (`examples/solid-todo`, Tailwind page plus existing pages):

```bash
pnpm --filter @glaze/example-solid-todo exec glaze build
# glaze build: 5 pages, 12 components
# miniprogram/app.wxss: 1,752 bytes (generated CSS plus the project app.wxss)
```

The generated WXML contains `text-_b24rpx_B`, `h-_b20rpx_B` and
`w-_b120rpx_B`; `app.wxss` contains `.p-4`, `.bg-red-500` and
`.text-_b24rpx_B`. A real minidev test checks `font-size` resolves to `12px`
and `padding-top` to `16px`, not just that the class attributes exist.

Builder tests also assert the generated CSS, the escaped WXML and rejection of
a missing input stylesheet.
