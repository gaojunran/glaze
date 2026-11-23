import type { GlazeConfig } from '@glaze/build'

const config: GlazeConfig = {
  source: 'src',
  output: 'miniprogram',
  pages: {
    'pages/index/index': 'Counter.tsx',
    'pages/todo/index': 'TodoPage.tsx',
    'pages/async/index': 'AsyncPanel.tsx',
    'pages/context/index': 'ContextDemo.tsx',
  },
  static: ['static', { from: 'assets', to: 'assets' }],
  staticPages: ['pages/native/index'],
  pageConfig: {
    'pages/index/index': { navigationBarTitleText: 'Counter' },
  },
  runtime: { bindingGroupSize: 8 },
}

export default config
