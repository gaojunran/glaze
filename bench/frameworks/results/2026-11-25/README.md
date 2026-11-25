# Benchmark results — 2026-11-25

Raw inputs for `bench/frameworks/chart.mjs`. They are the JSONL emitted by
`bench/frameworks/run.mjs --precise`; each record contains the three runs used
for the median. The data is committed so the docs chart does not depend on
`/tmp` or a live simulator.

| File | Contents |
| --- | --- |
| `microbench-glaze-component.jsonl` | Glaze with the component root, all microbench pages |
| `microbench-glaze-page.jsonl` | Glaze with the page root experiment (all pages direct) |
| `microbench-native.jsonl` | Native WXML pages |
| `microbench-uni-app.jsonl` | uni-app Vue 3 |
| `microbench-vue-mini.jsonl` | Vue Mini |
| `microbench-taro.jsonl` | Taro |
| `page-root-component-cases.jsonl` | Page root results for components, props and props-object |
| `page-root-list-cases.jsonl` | Page root results for the move and fine list pages |
| `prop-shape-glaze-component.jsonl` | Glaze component root, 500 child prop-shape pages |
| `prop-shape-glaze-page.jsonl` | Glaze page root, 500 child prop-shape pages |
| `prop-shape-native.jsonl` | Native WXML prop-shape pages |
| `prop-shape-uni-app.jsonl` | uni-app prop-shape pages |

The overview chart uses the first six files; the page-root chart uses the four
`prop-shape-*` files. `microbench-glaze-page.jsonl` is kept as the source for
the page-root trade-off (list pages regress because Page has no splice API),
even though the current docs chart focuses on the component-boundary case.

Regenerate with:

```bash
node bench/frameworks/chart.mjs
```

The chart renderer needs a Chrome/Chromium binary. It auto-detects the
Playwright cache; otherwise set `CHROME=/path/to/chrome`.
