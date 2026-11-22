import type { GlazeConfig } from "@glaze/build"

const config: GlazeConfig = {
  source: 'src',
  output: 'miniprogram',
  pages: {
    'pages/index/index': 'Counter.tsx',
    'pages/bench/index': 'Bench.tsx',
    'pages/bench-components/index': 'BenchComponents.tsx',
    'pages/reactive/index': 'ReactiveCases.tsx',
    'pages/tailwind/index': 'TailwindCase.tsx',
    'pages/context/index': 'ContextPage.tsx',
    'pages/async/index': 'AsyncPage.tsx',
  },
  subpackages: [
    { root: 'pkg', pages: { 'pages/sub/index': 'pkg/PkgPage.tsx' }, independent: true },
  ],
  static: ['static'],
  css: { tailwind: { input: 'src/tailwind.css' } },
  staticPages: ['pages/native/index', 'pages/native-components/index'],
}

export default config
