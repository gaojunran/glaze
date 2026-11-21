export default {
  source: 'src',
  output: 'miniprogram',
  pages: {
    'pages/index/index': 'Counter.tsx',
    'pages/bench/index': 'Bench.tsx',
  },
  static: ['static'],
  staticPages: ['pages/native/index'],
}
