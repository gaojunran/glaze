# Source layout

This document records the TypeScript/module split: why the source is arranged
this way, what each module owns, and the trade-offs that came with it.

## Direction

All package source is TypeScript. There is no build step for the framework
packages: Node 22 strips types when it imports `.ts` files, so the same files
run in tests, the CLI and the compiler without a `tsc`-emitted duplicate tree.
The generated mini-program code is still plain JavaScript; only the toolchain
runs as TypeScript.

Large files were split by responsibility rather than by size alone:

| Package | Module | Responsibility |
| --- | --- | --- |
| `@glaze/compiler` | `compile.ts` | public `compileComponent` entry, context construction, result assembly |
| | `parse.ts` | parse a component source and find the component function/props |
| | `ast.ts` | Babel AST helpers, text escaping, JSX attribute helpers |
| | `events.ts` | native/component event maps and bind/catch/capture suffix parsing |
| | `scope.ts` | loop scopes, accessor rewrites, expression hoisting, inline validation |
| | `attributes.ts` | `class`/`style` expression handling |
| | `control.ts` | `Show`, `Switch`/`Match`, `For`, `Repeat` |
| | `elements.ts` | JSX element/component dispatch, child and provider compilation |
| | `inline.ts` | static and loop-only component inlining |
| | `emit.ts` | generated JavaScript module assembly |
| | `types.ts` | shared AST/context/result types |
| `@glaze/build` | `build.ts` | one project build pass and component emission |
| | `config.ts` | config discovery/loading, source collection, import resolution |
| | `paths.ts` | route/output naming and project path validation |
| | `shared.ts` | shared runtime module and esbuild plugin setup |
| | `styles.ts` | portable WXSS checks |
| | `preprocess.ts` | SCSS/Less compilation for component and app styles |
| | `snippet.ts` | single-file snippet config parsing and standalone project generation |
| | `tailwind.ts` | optional Tailwind generator, WXML/JS classNameSet transforms |
| | `watch.ts` | debounced watch loop |
| | `cli.ts` | `glaze build` / `glaze watch` / `glaze snippet` entry |
| `@glaze/runtime` | `mini.ts` | mini-program component definition and lifecycle |
| | `data.ts` | data paths, value normalization, binding error reporting |
| | `list.ts` | keyed list diff/patch |
| | `styles.ts` | `class`/`style` object helpers |
| | `provider.ts` | inline Solid context provider bridge |
| | `types.ts` | runtime/public types |
| `@glaze/shared` | `strings.ts` | `kebabCase`, shared by compiler and build naming |

`glaze.config` discovery accepts `glaze.config.mts`, `.ts` and `.mjs`. The
example uses `.mts` because its CJS mini-program tests live in the same
package; `.mts` avoids adding `"type": "module"` to that package.

`@glaze/solid` was removed: it was an empty placeholder with exports pointing
at files that did not exist. Solid imports in sample code stay on `solid-js`;
the compiler owns JSX parsing, so no runtime renderer package is needed today.

## Trade-offs

- Node's type stripping understands TypeScript syntax but does not type-check.
  Type errors are caught by `pnpm typecheck`, not by running the CLI.
- `@glaze/compiler` and `@glaze/build` still have many implicit-`any`
  parameters from the original JavaScript. Their package `tsconfig.json`
  turns `strict` off so type checking catches concrete errors without a
  broad annotation rewrite. `@glaze/runtime` and `@glaze/shared` stay strict.
  Tightening the other two is follow-up work, not a behavior change.
- Splitting the compiler introduces import cycles between `elements`, `control`
  and `inline`. ESM handles them because the functions are called after module
  initialization; the alternative was a larger dispatcher object passed through
  every call, which made the call sites harder to read.
- Mini-program `app.js`, native comparison pages and the minidev test file stay
  JavaScript on purpose: they run in the mini-program runtime or its test
  runner, not in the Glaze toolchain.
- Cross-package helpers are intentionally small. `@glaze/shared` exists for
  naming logic both the compiler and builder need; it is not a general utility
  package.

## Validation

Commands run from the repository root:

```bash
pnpm -r test
pnpm -r --if-present typecheck
pnpm build
```

Results at the time of the split:

- `@glaze/runtime`: 14 passed, 0 failed
- `@glaze/compiler`: 62 passed, 0 failed
- `@glaze/build`: 16 passed, 0 failed
- `@glaze/shared`: 2 passed, 0 failed
- `pnpm build`: `3 pages, 10 components`
- minidev e2e (3 cases): all passed, about 16.8 s

The generated example output is still `examples/solid-todo/miniprogram`, built
from `examples/solid-todo/glaze.config.mts`.
