# Glaze

**Solid and Svelte, running natively on glass-easel.**

Glaze compiles modern web frameworks to native mini-program WXML and runs only
their reactive logic at runtime. No virtual DOM, no generic recursive template,
no `setData` for unrelated state.

The first target is **Solid 2**. Svelte 5 is planned on the same compiler.

## Status

Working spike: a Solid counter, static child inlining, a child component with
reactive props, `For` events, per-row `setData` patches, `glaze build`, and a
1000-row benchmark in the minidev simulator. First render and keyed reverse are
within a few percent of hand-written WXML in the same harness.

## Packages

| Package | Role |
| --- | --- |
| `@glaze/compiler` | Solid JSX to WXML + binding runtime |
| `@glaze/build` | `glaze build`: project and page output |
| `@glaze/runtime` | per-instance Solid root and binding bridge |
| `@glaze/solid` | future renderer experiments |
| `@glaze/vite-plugin` | future Vite integration |
| `examples/solid-todo` | counter, todo list and 1000-row benchmark |

## Documentation

- [Architecture](docs/architecture.md)
- [Compiler](docs/compiler.md)
- [Implementation plan](docs/plan.md)
- [Build](docs/build.md)
- [Running with minidev](docs/minidev.md)
- [Why external components do not work](docs/findings-external-component.md)

## License

MIT
