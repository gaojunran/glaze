#!/usr/bin/env node

// Renders the committed microbenchmark results into PNG charts.
//
//   node bench/frameworks/chart.mjs
//   CHROME=/path/to/chrome node bench/frameworks/chart.mjs
//
// The script only needs Node and a Chrome/Chromium binary. It writes:
//   docs/assets/microbench-overview.png
//   docs/assets/page-runtime-prop-shape.png
//
// The source data is under bench/frameworks/results/. The PNGs are committed
// so the docs render without a browser or a network connection.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '../..')
const args = process.argv.slice(2)
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index === -1 ? fallback : args[index + 1]
}
const dataDir = path.resolve(repo, option('data-dir', 'bench/frameworks/results/2026-11-25'))
const outDir = path.resolve(repo, option('out-dir', 'docs/assets'))

const sources = [
  ['glaze', 'Glaze', 'microbench-glaze-component.jsonl'],
  ['native', 'Native WXML', 'microbench-native.jsonl'],
  ['uni', 'uni-app', 'microbench-uni-app.jsonl'],
  ['vue', 'Vue Mini', 'microbench-vue-mini.jsonl'],
  ['taro', 'Taro', 'microbench-taro.jsonl'],
]

const readJsonl = (file) =>
  readFileSync(path.join(dataDir, file), 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))

// Some older result files are pretty-printed objects without a separating
// newline per record. Accept both forms so the chart keeps working as the
// benchmark harness evolves.
const readJsonRecords = (file) => {
  const text = readFileSync(path.join(dataDir, file), 'utf8').trim()
  if (text.startsWith('[')) return JSON.parse(text)
  const parts = text.split(/}\s*{/)
  if (parts.length === 1) return [JSON.parse(text)]
  return parts.map((part, index) => {
    const open = index === 0 ? '' : '{'
    const close = index === parts.length - 1 ? '' : '}'
    return JSON.parse(`${open}${part}${close}`)
  })
}

const median = (values) => {
  const sorted = values.filter((value) => typeof value === 'number' && !Number.isNaN(value)).sort((a, b) => a - b)
  if (sorted.length === 0) return null
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

const extent = (values) => {
  const sorted = values.filter((value) => typeof value === 'number' && !Number.isNaN(value)).sort((a, b) => a - b)
  return sorted.length === 0 ? null : [sorted[0], sorted[sorted.length - 1]]
}

const caseValues = (rows, caseName, metric) => {
  const row = rows.find((item) => item.case === caseName)
  if (!row) return []
  return row.runs.map((run) => run[metric]).filter((value) => typeof value === 'number')
}

const format = (value, digits = 1) => (value == null ? '—' : Number(value.toFixed(digits)).toString())

const suite = Object.fromEntries(
  sources.map(([key, label, file]) => {
    const rows = readJsonl(file)
    return [key, { label, rows }]
  }),
)

// Rows measured with the page root. They replace the component-root value in
// the Glaze column only; the table note marks the affected rows with a dagger.
const pageRootBulk = Object.fromEntries(
  readJsonRecords('page-root-bulk-cases.jsonl').map((row) => [row.label, row.runs]),
)

const overviewRows = [
  { group: 'flat · 1000 rows', label: 'update title', case: 'flat', metric: 'update' },
  { group: 'flat · 1000 rows', label: 'bump counter', case: 'flat', metric: 'bump' },
  { group: 'flat · 1000 rows', label: 'reverse', case: 'flat', metric: 'reverse' },
  { group: 'fine · 5000 rows', label: 'update 1 row', case: 'fine', metric: 'update' },
  { group: 'fine · 5000 rows', label: 'bump 1 row', case: 'fine', metric: 'bump' },
  { group: 'fine · 5000 rows', label: 'toggle 1 row', case: 'fine', metric: 'toggle' },
  { group: 'fine · 5000 rows', label: 'update 10 rows', case: 'fine', metric: 'u10' },
  { group: 'fine · 5000 rows', label: 'update 100 rows', case: 'fine', metric: 'u100' },
  { group: 'fine · 5000 rows', label: 'update 500 rows', case: 'fine', metric: 'u500' },
  { group: 'fine · 5000 rows', label: 'insert head', case: 'fine', metric: 'insert' },
  { group: 'fine · 5000 rows', label: 'insert middle', case: 'fine', metric: 'insert-mid' },
  { group: 'fine · 5000 rows', label: 'insert tail', case: 'fine', metric: 'insert-tail' },
  { group: 'fine · 5000 rows', label: 'delete head', case: 'fine', metric: 'delete' },
  { group: 'fine · 5000 rows', label: 'delete middle', case: 'fine', metric: 'delete-mid' },
  { group: 'fine · 5000 rows', label: 'delete tail', case: 'fine', metric: 'delete-tail' },
  { group: 'fine · 5000 rows', label: 'mixed handler', case: 'fine', metric: 'mixed' },
  { group: 'fine · 5000 rows', label: 'no-op write', case: 'fine', metric: 'noop' },
  { group: 'fine · 5000 rows', label: 'reverse 5000', case: 'fine', metric: 'reverse' },
  { group: 'component boundaries', label: 'components update 1', case: 'components', metric: 'update' },
  { group: 'component boundaries', label: 'components update all 500', case: 'components', metric: 'updateAll' },
  { group: 'component boundaries', label: 'components update 10', case: 'components', metric: 'u10' },
  { group: 'component boundaries', label: 'components update 100', case: 'components', metric: 'u100' },
  { group: 'component boundaries', label: 'props update 1', case: 'props', metric: 'update' },
  { group: 'component boundaries', label: 'props update all 500', case: 'props', metric: 'updateAll' },
  { group: 'component boundaries', label: 'props-object update 1', case: 'props-object', metric: 'update' },
  { group: 'component boundaries', label: 'props-object update all 500', case: 'props-object', metric: 'updateAll' },
  { group: 'component boundaries', label: 'pure inline update all 500', case: 'pure', metric: 'updateAll' },
  { group: 'reactive and layout', label: 'scalars fan-out', case: 'scalars', metric: 'bump' },
  { group: 'reactive and layout', label: 'grid cell', case: 'grid', metric: 'cell' },
  { group: 'reactive and layout', label: 'grid row', case: 'grid', metric: 'row' },
  { group: 'reactive and layout', label: 'move deep', case: 'move', metric: 'deep' },
  { group: 'reactive and layout', label: 'move rotate', case: 'move', metric: 'rotate' },
]

const shadeFor = (ratio) => {
  if (ratio == null) return '#f9fafb'
  if (ratio <= 1.2) return '#d1fae5'
  if (ratio <= 2) return '#fef3c7'
  if (ratio <= 4) return '#fed7aa'
  return '#fecaca'
}

const htmlEscape = (value) =>
  String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])

const pageCss = `
  :root {
    color-scheme: light;
    font-family: "Inter", "Helvetica Neue", Arial, sans-serif;
    color: #111827;
    background: #ffffff;
  }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 42px 48px 36px; background: #fff; }
  h1 { margin: 0; font-size: 26px; line-height: 1.15; letter-spacing: -0.02em; }
  h2 { margin: 0; font-size: 18px; line-height: 1.2; letter-spacing: -0.01em; }
  p { margin: 0; }
  .muted { color: #6b7280; }
  .subtle { color: #9ca3af; }
  .small { font-size: 11px; }
  .tiny { font-size: 10px; }
  .mono { font-variant-numeric: tabular-nums; }
`

const overviewHtml = () => {
  const metrics = overviewRows.map((row) => {
    const pageRoot = pageRootBulk[row.label]
    return {
      ...row,
      pageRoot: pageRoot != null,
      values: Object.fromEntries(
        Object.entries(suite).map(([key, value]) => [
          key,
          key === 'glaze' && pageRoot
            ? median(pageRoot)
            : median(caseValues(value.rows, row.case, row.metric)),
        ]),
      ),
    }
  })
  const nativeValues = Object.fromEntries(metrics.map((row) => [row.label, row.values.native]))
  const groupStarts = new Set(metrics.map((row) => row.group))
  const rows = metrics
    .map((row, index, list) => {
      const previous = list[index - 1]
      const groupClass = !previous || previous.group !== row.group ? 'group-start' : ''
      const cells = sources
        .map(([key, label]) => {
          const value = row.values[key]
          const ratio = value != null && nativeValues[row.label] ? value / nativeValues[row.label] : null
          return `<td style="background:${shadeFor(ratio)}" class="mono" title="${htmlEscape(label)}: ${format(value)} ms${ratio ? ` (${ratio.toFixed(1)}× native)` : ''}">${format(value)}</td>`
        })
        .join('')
      return `<tr class="${groupClass}"><th scope="row">${htmlEscape(row.label)}${row.pageRoot ? ' †' : ''}</th>${cells}</tr>`
    })
    .join('')
  const groupRows = [...groupStarts]
    .map((group) => {
      const count = metrics.filter((row) => row.group === group).length
      return `<span class="group-key"><i></i>${htmlEscape(group)} <em>${count}</em></span>`
    })
    .join('')
  return `<!doctype html><html><head><meta charset="utf-8"><style>${pageCss}
    .head { display:flex; align-items:flex-end; justify-content:space-between; gap:24px; margin-bottom: 20px; }
    .head p { margin-top: 7px; font-size: 13px; }
    .badge { display:inline-flex; align-items:center; gap:7px; border:1px solid #e5e7eb; border-radius:999px; padding:5px 10px; color:#4b5563; font-size:11px; white-space:nowrap; }
    .badge b { color:#111827; font-weight:600; }
    .legend { display:flex; flex-wrap:wrap; gap:16px; align-items:center; margin: 0 0 14px; font-size:11px; color:#4b5563; }
    .scale { display:flex; align-items:center; gap:7px; margin-left:auto; }
    .scale i { width:13px; height:10px; border-radius:2px; display:inline-block; }
    .group-key { display:inline-flex; align-items:center; gap:6px; color:#374151; }
    .group-key i { width:6px; height:6px; border-radius:50%; background:#9ca3af; display:inline-block; }
    .group-key em { font-style:normal; color:#9ca3af; }
    table { border-collapse:separate; border-spacing:0; width:100%; font-size:12px; }
    thead th { padding:8px 10px; text-align:right; color:#6b7280; font-size:11px; font-weight:600; white-space:nowrap; }
    thead th:first-child { text-align:left; width:27%; }
    tbody th { padding:8px 10px; text-align:left; font-weight:500; color:#374151; white-space:nowrap; }
    tbody td { padding:8px 10px; text-align:right; border-left:1px solid rgba(255,255,255,.72); }
    tbody tr.group-start th, tbody tr.group-start td { border-top:1px solid #e5e7eb; }
    tbody tr:hover th { color:#111827; }
    tbody tr:hover td { box-shadow: inset 0 0 0 1px rgba(17,24,39,.06); }
    .foot { display:flex; justify-content:space-between; gap:18px; margin-top:14px; font-size:10px; color:#9ca3af; line-height:1.45; }
  </style></head><body>
    <div class="head">
      <div><h1>Microbenchmark overview</h1><p class="muted">Median of three real-tap runs per cell · minidev simulator · lower is better</p></div>
      <div class="badge"><b>ms</b> · color = ratio to Native</div>
    </div>
    <div class="legend">${groupRows}
      <span class="scale">Native baseline
        <i style="background:#d1fae5"></i>≤1.2×
        <i style="background:#fef3c7"></i>≤2×
        <i style="background:#fed7aa"></i>≤4×
        <i style="background:#fecaca"></i>&gt;4×
      </span>
    </div>
    <table>
      <thead><tr><th>Workload</th>${sources.map(([, label]) => `<th>${htmlEscape(label)}</th>`).join('')}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="foot"><span>Source: bench/frameworks/results/2026-11-25 · values are medians; not browser wall clock. First render is omitted because the minidev route/simulator noise dominates it.</span><span>† Glaze page root; other Glaze rows use the component root. Native and Glaze use the same fixture shape; Vue Mini and Taro are not precise-probed.</span></div>
  </body></html>`
}

const propShapeHtml = () => {
  const series = [
    ['glaze', 'Glaze component root', '#f59e0b'],
    ['page', 'Glaze page root', '#2563eb'],
    ['native', 'Native WXML page', '#10b981'],
    ['uni', 'uni-app', '#8b5cf6'],
  ]
  const files = {
    glaze: 'prop-shape-glaze-component.jsonl',
    page: 'prop-shape-glaze-page.jsonl',
    native: 'prop-shape-native.jsonl',
    uni: 'prop-shape-uni-app.jsonl',
  }
  const values = {}
  for (const [key, file] of Object.entries(files)) {
    const rows = readJsonRecords(file)
    values[key] = new Map()
    for (const row of rows) {
      const match = /props-(\d+)/.exec(row.route ?? '')
      if (!match) continue
      const numbers = row.runs.map((run) => run.updateAll).filter((value) => typeof value === 'number')
      values[key].set(Number(match[1]), {
        median: median(numbers),
        min: extent(numbers)?.[0],
        max: extent(numbers)?.[1],
      })
    }
  }
  const counts = [1, 2, 4, 8, 16]
  const at16 = (key) => format(values[key].get(16)?.median)
  const maxValue = 100
  const groups = counts
    .map((count, index) => {
      const bars = series
        .map(([key, label, color]) => {
          const value = values[key].get(count)
          const height = value ? (value.median / maxValue) * 300 : 0
          const top = 300 - height
          const minY = value ? 300 - (value.min / maxValue) * 300 : 300
          const maxY = value ? 300 - (value.max / maxValue) * 300 : 300
          return `<div class="bar-wrap" title="${htmlEscape(label)}: ${format(value?.median)} ms (${format(value?.min)}–${format(value?.max)})">
            <div class="bar" style="height:${height}px;background:${color}"></div>
            <div class="whisker" style="top:${maxY}px;height:${Math.max(0, minY - maxY)}px;border-color:${color}"></div>
            <div class="value mono" style="bottom:${Math.max(height + 8, 12)}px">${format(value?.median)}</div>
          </div>`
        })
        .join('')
      return `<div class="group"><div class="bars">${bars}</div><div class="xlabel">${count} prop${count === 1 ? '' : 's'}</div></div>`
    })
    .join('')
  const grid = [0, 20, 40, 60, 80, 100]
    .map((value) => `<div class="gridline" style="bottom:${(value / maxValue) * 300}px"><span>${value}</span></div>`)
    .join('')
  const legend = series
    .map(([key, label, color]) => `<span class="key"><i style="background:${color}"></i>${htmlEscape(label)}</span>`)
    .join('')
  return `<!doctype html><html><head><meta charset="utf-8"><style>${pageCss}
    h1 { font-size: 26px; }
    .head { display:flex; justify-content:space-between; align-items:flex-end; gap:24px; margin-bottom:18px; }
    .head p { margin-top:7px; font-size:13px; }
    .chart { position:relative; display:flex; align-items:flex-start; height:340px; padding:8px 8px 0 44px; border-bottom:1px solid #e5e7eb; }
    .gridline { position:absolute; left:44px; right:8px; border-top:1px solid #f3f4f6; color:#9ca3af; font-size:10px; }
    .gridline span { position:absolute; left:-36px; top:-7px; width:26px; text-align:right; }
    .group { flex:1; display:flex; flex-direction:column; justify-content:flex-end; height:100%; min-width:0; }
    .bars { display:flex; align-items:flex-end; justify-content:center; gap:5px; height:300px; z-index:1; }
    .bar-wrap { position:relative; width:28px; height:300px; display:flex; align-items:flex-end; justify-content:center; }
    .bar { width:23px; border-radius:3px 3px 1px 1px; position:relative; z-index:2; }
    .whisker { position:absolute; left:50%; width:1px; z-index:3; opacity:.75; }
    .whisker::before, .whisker::after { content:""; position:absolute; left:-3px; width:7px; border-top:1px solid currentColor; }
    .whisker::before { top:0; } .whisker::after { bottom:0; }
    .value { position:absolute; left:50%; transform:translateX(-50%); font-size:9px; color:#374151; white-space:nowrap; z-index:4; }
    .xlabel { text-align:center; padding-top:11px; font-size:11px; color:#4b5563; }
    .keys { display:flex; gap:17px; flex-wrap:wrap; margin:20px 0 0 44px; font-size:11px; color:#4b5563; }
    .key { display:inline-flex; align-items:center; gap:6px; }
    .key i { width:10px; height:10px; border-radius:2px; display:inline-block; }
    .note { margin-top:18px; padding:10px 14px; background:#eff6ff; color:#1e40af; font-size:12px; border-radius:6px; }
    .foot { margin-top:14px; font-size:10px; color:#9ca3af; line-height:1.45; }
  </style></head><body>
    <div class="head"><div><h1>500 real child components: updating every row</h1><p class="muted">Glaze page root removes the &lt;glaze-page&gt; component layer · lower is better</p></div></div>
    <div class="chart">${grid}${groups}</div>
    <div class="keys">${legend}<span class="subtle">ms · median + min–max</span></div>
    <div class="note">At 16 props: component root ${at16('glaze')} ms → page root ${at16('page')} ms; native ${at16('native')} ms, uni-app ${at16('uni')} ms.</div>
    <div class="foot">Precise in-appservice setData from a real tap · 3 runs per bar · minidev simulator, not a phone · source: bench/frameworks/results/2026-11-25.</div>
  </body></html>`
}

const chromeCandidates = () => {
  const explicit = process.env.CHROME
  if (explicit) return [explicit]
  const candidates = ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable']
  const cache = path.join(homedir(), '.cache', 'ms-playwright')
  try {
    for (const entry of readdirSync(cache)) {
      const dir = path.join(cache, entry)
      for (const name of ['chrome-headless-shell-linux64/chrome-headless-shell', 'chrome-linux/chrome']) {
        const candidate = path.join(dir, name)
        if (existsSync(candidate)) candidates.push(candidate)
      }
    }
  } catch {
    // No Playwright cache; use the system candidates.
  }
  return candidates
}

const findChrome = () => {
  const candidate = chromeCandidates().find((file) => existsSync(file))
  if (!candidate) {
    throw new Error(
      'No Chrome/Chromium found. Set CHROME=/path/to/chrome (the Playwright cache under ~/.cache/ms-playwright is also detected).',
    )
  }
  return candidate
}

const render = (html, filename, width, height, chrome) => {
  const temp = mkdtempSync(path.join(tmpdir(), 'glaze-chart-'))
  const htmlPath = path.join(temp, 'chart.html')
  const pngPath = path.join(outDir, filename)
  try {
    writeFileSync(htmlPath, html)
    const result = spawnSync(
      chrome,
      [
        '--headless',
        '--disable-gpu',
        '--no-sandbox',
        '--hide-scrollbars',
        '--no-first-run',
        '--disable-dev-shm-usage',
        `--force-device-scale-factor=1`,
        `--window-size=${width},${height}`,
        `--screenshot=${pngPath}`,
        `file://${htmlPath}`,
      ],
      { encoding: 'utf8', timeout: 120_000 },
    )
    if (result.status !== 0 || !existsSync(pngPath)) {
      throw new Error(`Chrome failed to render ${filename}\n${result.stderr || result.stdout || result.error || ''}`)
    }
    console.log(`wrote ${path.relative(repo, pngPath)}`)
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}

const main = () => {
  mkdirSync(outDir, { recursive: true })
  const chrome = findChrome()
  render(overviewHtml(), 'microbench-overview.png', 1180, 1240, chrome)
  render(propShapeHtml(), 'page-runtime-prop-shape.png', 960, 540, chrome)
}

main()
