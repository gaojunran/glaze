# solid-todo example

A Solid counter, a todo list with a `TodoItem` child component, and a 1000-row
benchmark compiled to mini-program WXML by `@glaze/compiler`.

## Build

```bash
pnpm build
```

This writes the whole `miniprogram` directory from `src`, using
`glaze.config.mjs`. The output is generated and git-ignored.

Source layout:

- `src/Counter.tsx` — page `pages/index/index`;
- `src/Bench.tsx` — page `pages/bench/index`;
- `src/TodoItem.tsx` — component boundary inside `For`;
- `src/Card.tsx` — inlined wrapper with a default slot;
- `src/Header.tsx` — always inlined;
- `src/static/pages/native` — hand-written comparison page.

## Run

```bash
cd ~/Playground/minibuild
target/debug/minidev sim build --project ~/Projects/glaze/examples/solid-todo --out ~/Projects/glaze/.tmp/sim
target/debug/minidev sim serve --dist ~/Projects/glaze/.tmp/sim --browser <chrome> --port 9422
target/debug/minidev test --project ~/Projects/glaze/examples/solid-todo --browser <chrome>
```

Pages:

- `pages/index/index` — counter, inlined `Header`, `Show`, keyed `For`,
  `TodoItem` props;
- `pages/bench/index` — 1000 rows compiled from Solid, including reverse;
- `pages/native/index` — the same 1000 rows in hand-written WXML.

## Benchmark

With `sim serve` running on port 9422:

```bash
NODE_PATH=~/Playground/minibuild/sdk node bench/compare.cjs
```
