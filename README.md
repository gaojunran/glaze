# Glaze

**Solid and Svelte, running natively on glass-easel.**

Glaze renders modern web frameworks directly into glass-easel nodes. There is no
WXML compilation in the hot path, no `setData` for internal state, and no DOM
shim.

The first target is **Solid 2**. Svelte 5 is planned on top of the same adapter.

## Status

Early. The first milestone is a Solid counter and todo running in a real
mini-program through the minidev simulator. Svelte is not implemented yet.

## Packages

| Package | Role |
| --- | --- |
| `@glaze/runtime` | glass-easel boundary, template engine, props and events bridge |
| `@glaze/solid` | Solid 2 renderer for glass-easel |
| `@glaze/vite-plugin` | build integration for mini-program output |
| `examples/solid-todo` | end-to-end example |

## Documentation

- [Implementation plan](docs/plan.md)
- [Architecture](docs/architecture.md)
- [Running with minidev](docs/minidev.md)

## License

MIT
