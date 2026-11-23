import type { GlazeConfig } from "@glaze/build"

const config: GlazeConfig = {
  source: 'src',
  output: 'miniprogram',
  pages: {
    'pages/index/index': 'Counter.tsx',
    'pages/bench/index': 'Bench.tsx',
    'pages/bench-fine/index': 'FineBench.tsx',
    'pages/bench-components/index': 'BenchComponents.tsx',
    'pages/bench-component-rows/index': 'ComponentRows.tsx',
    'pages/bench-component-rows-pure/index': 'PureComponentRows.tsx',
    'pages/bench-edges/index': 'BenchEdges.tsx',
    'pages/bench-scalars/index': 'ScalarBench.tsx',
    'pages/bench-grid/index': 'GridBench.tsx',
    'pages/bench-move/index': 'MoveBench.tsx',
    'pages/bench-props/index': 'PropsRows.tsx',
    'pages/bench-props-object/index': 'PropsRowsObject.tsx',
    'pages/reactive/index': 'ReactiveCases.tsx',
    'pages/tailwind/index': 'TailwindCase.tsx',
    'pages/context/index': 'ContextPage.tsx',
    'pages/async/index': 'AsyncPage.tsx',
  },
  subpackages: [
    { root: 'pkg', pages: { 'pages/sub/index': 'pkg/PkgPage.tsx' }, independent: true },
  ],
  static: ['static', { from: 'assets/static-logo.png', to: 'assets/static-logo.png' }],
  css: { tailwind: { input: 'src/tailwind.css' } },
  staticPages: [
    'pages/native/index',
    'pages/native-fine/index',
    'pages/native-fine-projected/index',
    'pages/native-components/index',
    'pages/native-component-rows/index',
    'pages/native-edges/index',
    'pages/native-scalars/index',
    'pages/native-grid/index',
    'pages/native-move/index',
    'pages/native-props/index',
    'pages/native-props-object/index',
  ],
}

export default config
