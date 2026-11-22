import type { GlazeConfig } from "@glaze/build"

const config: GlazeConfig = {
  source: 'src',
  output: 'miniprogram',
  pages: {
    'pages/index/index': 'Counter.tsx',
    'pages/bench/index': 'Bench.tsx',
    'pages/bench-components/index': 'BenchComponents.tsx',
  },
  static: ['static'],
  staticPages: ['pages/native/index', 'pages/native-components/index'],
}

export default config
