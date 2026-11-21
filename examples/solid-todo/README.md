# solid-todo example

A Solid counter, a todo list with a `TodoItem` child component, and a 1000-row
benchmark compiled to mini-program WXML by `@glaze/compiler`.

## Build

```bash
cd ../..
node packages/compiler/src/build-example.mjs
```

This generates `miniprogram/components/glaze-counter` and
`miniprogram/components/glaze-bench`.

## Run

```bash
cd ~/Playground/minibuild
target/debug/minidev sim build --project ~/Projects/glaze/examples/solid-todo --out ~/Projects/glaze/.tmp/sim
target/debug/minidev sim serve --dist ~/Projects/glaze/.tmp/sim --browser <chrome> --port 9422
target/debug/minidev test --project ~/Projects/glaze/examples/solid-todo --browser <chrome>
```

Pages:

- `pages/index/index` — counter, `Show`, keyed `For`, `TodoItem` props;
- `pages/bench/index` — 1000 rows compiled from Solid;
- `pages/native/index` — the same 1000 rows in hand-written WXML.

## Benchmark

With `sim serve` running on port 9422:

```bash
NODE_PATH=~/Playground/minibuild/sdk node bench/compare.cjs
```
