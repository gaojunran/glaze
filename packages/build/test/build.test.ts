import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  buildProject,
  outputNameForRelative,
} from '../src/build.ts'
import { buildSnippet, defaultSnippetOut, parseSnippetSource } from '../src/snippet.ts'

const exists = async (file) => {
  try {
    await access(file)
    return true
  } catch {
    return false
  }
}

async function createProject({ config, files = {}, configFile = 'glaze.config.mjs' }) {
  const project = await mkdtemp(path.join(tmpdir(), 'glaze-build-'))
  await writeFile(
    path.join(project, configFile),
    `export default ${JSON.stringify(config, null, 2)}\n`,
  )
  for (const [relative, content] of Object.entries(files)) {
    const file = path.join(project, relative)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, content)
  }
  return project
}

const writeProjectFile = async (project, relative, content) => {
  const file = path.join(project, relative)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, content)
}

const appShell = (project) => [
  writeProjectFile(project, 'src/app.js', 'App({})\n'),
  writeProjectFile(project, 'src/app.wxss', 'page { background: #fff; }\n'),
  writeProjectFile(
    project,
    'src/app.json',
    JSON.stringify({ componentFramework: 'glass-easel', window: {} }),
  ),
]

test('builds a page, its inlined child and a page wrapper', async () => {
  const project = await createProject({
    config: {
      source: 'src',
      output: 'miniprogram',
      pages: { 'pages/home/index': 'App.tsx' },
    },
    files: {
      'src/App.tsx': `import Child from './Child'

export default function App() {
  return <view class="page"><Child title="Hello" /></view>
}
`,
      'src/Child.tsx': `export default function Child(props) {
  return <text class="title">{props.title}</text>
}
`,
    },
  })
  await Promise.all(appShell(project))

  const result = await buildProject(project)

  assert.deepEqual(result.pages, ['pages/home/index'])
  assert.deepEqual(result.components, ['glaze-app'])

  const page = await readFile(
    path.join(project, 'miniprogram/pages/home/index.wxml'),
    'utf8',
  )
  assert.equal(page.trim(), '<glaze-page id="app" />')

  const wxml = await readFile(
    path.join(project, 'miniprogram/components/glaze-app/index.wxml'),
    'utf8',
  )
  assert.match(wxml, /<text class="title">/)
  assert.doesNotMatch(wxml, /<child/)

  const componentJson = JSON.parse(
    await readFile(
      path.join(project, 'miniprogram/components/glaze-app/index.json'),
      'utf8',
    ),
  )
  assert.equal(componentJson.styleIsolation, 'apply-shared')

  const bundlePath = path.join(project, 'miniprogram/components/glaze-app/index.js')
  const bundle = await readFile(bundlePath, 'utf8')
  assert.ok(bundle.length < 12 * 1024, `bundle should stay minified, got ${bundle.length}`)

  const sharedPath = path.join(project, 'miniprogram/glaze-runtime/index.js')
  assert.equal(await exists(sharedPath), true)
  const shared = await readFile(sharedPath, 'utf8')
  assert.ok(shared.length > 1024, 'shared runtime should contain the framework')
  const requires = [...bundle.matchAll(/require\("([^"]+)"\)/g)].map((match) => match[1])
  assert.ok(requires.length > 0, 'component bundle should require the shared runtime')
  for (const specifier of requires) {
    assert.equal(
      path.resolve(path.dirname(bundlePath), specifier),
      sharedPath,
      `unexpected shared path ${specifier}`,
    )
  }

  const appJson = JSON.parse(
    await readFile(path.join(project, 'miniprogram/app.json'), 'utf8'),
  )
  assert.deepEqual(appJson.pages, ['pages/home/index'])
})

test('resolves helper, JSON and type-only imports from the source file', async () => {
  const project = await createProject({
    config: {
      source: 'src',
      output: 'miniprogram',
      pages: { 'pages/home/index': 'App.tsx' },
    },
    files: {
      'src/App.tsx': `import { fmt } from './utils/format'
import data from './data.json'
import type { Label } from './types'

export default function App() {
  const label: Label = data.title
  return <view class="page">{fmt(label)}</view>
}
`,
      'src/utils/format.ts': `export const fmt = (value: string) => '<' + value + '>'
`,
      'src/data.json': `{ "title": "Hello" }\n`,
      'src/types.ts': `export type Label = string
`,
    },
  })
  await Promise.all(appShell(project))

  const result = await buildProject(project)
  assert.deepEqual(result.components, ['glaze-app'])

  const bundle = await readFile(
    path.join(project, 'miniprogram/components/glaze-app/index.js'),
    'utf8',
  )
  assert.match(bundle, /Hello/)
  assert.ok(bundle.length > 0)
})

test('rejects unsafe output paths without touching sources', async () => {
  const project = await createProject({
    config: {
      source: 'src',
      output: 'src/build',
      pages: { 'pages/home/index': 'App.tsx' },
    },
    files: {
      'src/App.tsx': `export default function App() {
  return <view>safe</view>
}
`,
    },
  })
  await Promise.all(appShell(project))
  const sourceBefore = await readFile(path.join(project, 'src/App.tsx'), 'utf8')

  await assert.rejects(
    () => buildProject(project),
    /Config "output" must not be inside "source"/,
  )
  assert.equal(await readFile(path.join(project, 'src/App.tsx'), 'utf8'), sourceBefore)

  await writeProjectFile(
    project,
    'glaze.config.mjs',
    `export default { source: 'src', output: '../outside', pages: { 'pages/home/index': 'App.tsx' } }\n`,
  )
  await assert.rejects(
    () => buildProject(project),
    /Config "output" must be a subdirectory of the project/,
  )

  await writeProjectFile(
    project,
    'glaze.config.mjs',
    `export default { source: '.', output: 'dist', pages: { 'pages/home/index': 'App.tsx' } }\n`,
  )
  await assert.rejects(
    () => buildProject(project),
    /Config "source" must be a subdirectory of the project/,
  )
})

test('preserves previous output when a later build fails', async () => {
  const config = {
    source: 'src',
    output: 'miniprogram',
    pages: { 'pages/home/index': 'App.tsx' },
  }
  const project = await createProject({
    config,
    files: {
      'src/App.tsx': `export default function App() {
  return <view>first</view>
}
`,
    },
  })
  await Promise.all(appShell(project))

  await buildProject(project)
  await writeProjectFile(project, 'miniprogram/marker.txt', 'keep me\n')

  await writeProjectFile(
    project,
    'glaze.config.mjs',
    `export default { source: 'src', output: 'miniprogram', pages: { 'pages/home/index': 'Missing.tsx' } }\n`,
  )
  await assert.rejects(() => buildProject(project), /Page source not found: Missing.tsx/)
  assert.equal(
    await readFile(path.join(project, 'miniprogram/marker.txt'), 'utf8'),
    'keep me\n',
  )

  await writeProjectFile(
    project,
    'glaze.config.mjs',
    `export default ${JSON.stringify(config)}\n`,
  )
  await writeProjectFile(
    project,
    'src/App.tsx',
    `export default function App( {
  return <view>broken</view>
}
`,
  )
  await assert.rejects(() => buildProject(project))
  assert.equal(
    await readFile(path.join(project, 'miniprogram/marker.txt'), 'utf8'),
    'keep me\n',
  )
  assert.equal(
    await readFile(
      path.join(project, 'miniprogram/components/glaze-app/index.wxml'),
      'utf8',
    ),
    '<view>first</view>',
  )
})

test('clean: false merges into output and keeps custom files', async () => {
  const project = await createProject({
    config: {
      source: 'src',
      output: 'miniprogram',
      clean: false,
      pages: { 'pages/home/index': 'App.tsx' },
    },
    files: {
      'src/App.tsx': `export default function App() {
  return <view>first</view>
}
`,
    },
  })
  await Promise.all(appShell(project))

  await buildProject(project)
  await writeProjectFile(project, 'miniprogram/custom.txt', 'keep\n')
  await writeProjectFile(
    project,
    'src/App.tsx',
    `export default function App() {
  return <view>second</view>
}
`,
  )

  await buildProject(project)
  assert.equal(
    await readFile(path.join(project, 'miniprogram/custom.txt'), 'utf8'),
    'keep\n',
  )
  assert.match(
    await readFile(
      path.join(project, 'miniprogram/components/glaze-app/index.wxml'),
      'utf8',
    ),
    /<view>second<\/view>/,
  )
})

test('compiles only TSX reachable from pages', async () => {
  const project = await createProject({
    config: {
      source: 'src',
      output: 'miniprogram',
      pages: { 'pages/home/index': 'App.tsx' },
    },
    files: {
      'src/App.tsx': `export default function App() {
  return <view>ok</view>
}
`,
      'src/Unused.tsx': `export default function Unused(props) {
  return <view {...props} />
}
`,
    },
  })
  await Promise.all(appShell(project))

  const result = await buildProject(project)
  assert.deepEqual(result.components, ['glaze-app'])
  assert.equal(
    await exists(path.join(project, 'miniprogram/components/glaze-unused')),
    false,
  )

  await writeProjectFile(
    project,
    'src/App.tsx',
    `import Unused from './Unused'

export default function App() {
  return <view><Unused /></view>
}
`,
  )
  await assert.rejects(() => buildProject(project), /Only object literals can be spread/)
})

test('rejects two source files that map to the same component name', async () => {
  const project = await createProject({
    config: {
      source: 'src',
      output: 'miniprogram',
      pages: { 'pages/home/index': 'App.tsx' },
    },
    files: {
      'src/App.tsx': `import FooBar from './FooBar'
import FooBarLower from './foo-bar'

export default function App() {
  return <view><FooBar /><FooBarLower /></view>
}
`,
      'src/FooBar.tsx': `export default function FooBar() {
  return <view><slot /></view>
}
`,
      'src/foo-bar.tsx': `export default function FooBarLower() {
  return <view><slot /></view>
}
`,
    },
  })
  await Promise.all(appShell(project))

  await assert.rejects(
    () => buildProject(project),
    (error) => {
      assert.match(error.message, /Output name collision "glaze-foo-bar"/)
      assert.match(error.message, /FooBar\.tsx/)
      assert.match(error.message, /foo-bar\.tsx/)
      return true
    },
  )
})

test('normalizes Windows separators in output names', () => {
  assert.equal(outputNameForRelative('pages\\FooBar.tsx'), 'glaze-pages-foo-bar')
  assert.equal(outputNameForRelative('pages/FooBar.tsx'), 'glaze-pages-foo-bar')
  assert.equal(outputNameForRelative('foo-bar.tsx'), 'glaze-foo-bar')
})

test('rejects WXSS @import and relative url() but accepts portable URLs', async () => {
  const project = await createProject({
    config: {
      source: 'src',
      output: 'miniprogram',
      pages: { 'pages/home/index': 'App.tsx' },
    },
    files: {
      'src/App.tsx': `export default function App() {
  return <view>styled</view>
}
`,
      'src/App.wxss': `@import './shared.wxss';\n`,
    },
  })
  await Promise.all(appShell(project))

  await assert.rejects(
    () => buildProject(project),
    /WXSS @import is not supported.*App\.wxss/,
  )

  await writeProjectFile(project, 'src/App.wxss', `.page { background: url('./bg.png'); }\n`)
  await assert.rejects(
    () => buildProject(project),
    /WXSS url\(\) must be absolute.*App\.wxss/,
  )

  await writeProjectFile(
    project,
    'src/App.wxss',
    `.page {
  background: url('/images/bg.png');
  mask: url('data:image/png;base64,AAAA');
  color: red;
}
`,
  )
  await buildProject(project)
  const wxss = await readFile(
    path.join(project, 'miniprogram/components/glaze-app/index.wxss'),
    'utf8',
  )
  assert.match(wxss, /url\('\/images\/bg\.png'\)/)
})

test('dedupes staticPages routes and skips wrappers for them', async () => {
  const project = await createProject({
    config: {
      source: 'src',
      output: 'miniprogram',
      pages: { 'pages/home/index': 'App.tsx' },
      staticPages: ['pages/home/index', 'pages/native/index', 'pages/native/index'],
    },
    files: {
      'src/App.tsx': `export default function App() {
  return <view>home</view>
}
`,
    },
  })
  await Promise.all(appShell(project))

  const result = await buildProject(project)
  assert.deepEqual(result.pages, ['pages/home/index'])

  const appJson = JSON.parse(
    await readFile(path.join(project, 'miniprogram/app.json'), 'utf8'),
  )
  assert.deepEqual(appJson.pages, ['pages/home/index', 'pages/native/index'])
  assert.equal(await exists(path.join(project, 'miniprogram/pages/home/index.wxml')), false)
})

test('warns about missing app.js and app.wxss', async () => {
  const project = await createProject({
    config: {
      source: 'src',
      output: 'miniprogram',
      pages: { 'pages/home/index': 'App.tsx' },
    },
    files: {
      'src/App.tsx': `export default function App() {
  return <view>warn</view>
}
`,
    },
  })

  const warnings = []
  const originalWarn = console.warn
  console.warn = (message) => warnings.push(String(message))
  try {
    await buildProject(project)
  } finally {
    console.warn = originalWarn
  }
  assert.ok(warnings.some((message) => message.includes('app.js is missing')))
  assert.ok(warnings.some((message) => message.includes('app.wxss is missing')))

  await Promise.all(appShell(project))
  const second = []
  console.warn = (message) => second.push(String(message))
  try {
    await buildProject(project)
  } finally {
    console.warn = originalWarn
  }
  assert.deepEqual(second, [])
})

test('reloads a changed config on the next build', async () => {
  const project = await createProject({
    config: {
      source: 'src',
      output: 'miniprogram',
      pages: { 'pages/home/index': 'App.tsx' },
    },
    files: {
      'src/App.tsx': `export default function App() {
  return <view>reload</view>
}
`,
    },
  })
  await Promise.all(appShell(project))

  await buildProject(project)
  await writeProjectFile(
    project,
    'glaze.config.mjs',
    `export default { source: 'src', output: 'dist', pages: { 'pages/home/index': 'App.tsx' } }\n`,
  )

  const result = await buildProject(project)
  assert.equal(result.outputDir, path.join(project, 'dist'))
  assert.equal(await exists(path.join(project, 'dist/app.json')), true)
  assert.equal(await exists(path.join(project, 'miniprogram/app.json')), true)
})

test('rejects namespace imports from the shared runtime', async () => {
  const project = await createProject({
    config: {
      source: 'src',
      output: 'miniprogram',
      pages: { 'pages/home/index': 'App.tsx' },
    },
    files: {
      'src/App.tsx': `import * as solid from 'solid-js'

export default function App() {
  return <view>{solid}</view>
}
`,
    },
  })
  await Promise.all(appShell(project))

  await assert.rejects(
    () => buildProject(project),
    /Shared import from "solid-js" must use named imports/,
  )
})

test('rejects a static file that collides with the shared runtime', async () => {
  const project = await createProject({
    config: {
      source: 'src',
      output: 'miniprogram',
      pages: { 'pages/home/index': 'App.tsx' },
      static: ['static'],
    },
    files: {
      'src/App.tsx': `export default function App() {
  return <view>home</view>
}
`,
      'src/static/glaze-runtime/index.js': 'module.exports = {}\n',
    },
  })
  await Promise.all(appShell(project))

  await assert.rejects(
    () => buildProject(project),
    /Output file collision: glaze-runtime\/index\.js/,
  )
})

test('CLI prints help and rejects a missing or unknown command', () => {
  const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url))

  const help = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' })
  assert.equal(help.status, 0)
  assert.match(help.stdout, /Usage: glaze/)

  const missing = spawnSync(process.execPath, [cli], { encoding: 'utf8' })
  assert.equal(missing.status, 1)
  assert.match(missing.stderr, /Missing command/)

  const unknown = spawnSync(process.execPath, [cli, 'nope'], { encoding: 'utf8' })
  assert.equal(unknown.status, 1)
  assert.match(unknown.stderr, /Unknown command: nope/)
})

test('loads a TypeScript config file', async () => {
  const project = await createProject({
    configFile: 'glaze.config.mts',
    config: {
      source: 'src',
      output: 'miniprogram',
      pages: { 'pages/home/index': 'App.tsx' },
    },
    files: {
      'src/App.tsx': `export default function App() {\n  return <view>ts config</view>\n}\n`,
    },
  })
  await Promise.all(appShell(project))
  const result = await buildProject(project)
  assert.deepEqual(result.pages, ['pages/home/index'])
  assert.equal(await exists(path.join(project, 'miniprogram/app.json')), true)
})

test('rejects a non-positive binding group size', async () => {
  const project = await createProject({
    config: {
      source: 'src',
      output: 'miniprogram',
      runtime: { bindingGroupSize: 0 },
      pages: { 'pages/home/index': 'App.tsx' },
    },
    files: {
      'src/App.tsx': 'export default function App() { return <view /> }\n',
    },
  })
  await Promise.all(appShell(project))
  await assert.rejects(buildProject(project), /runtime\.bindingGroupSize/)
})

test('passes bindingGroupSize into the emitted component', async () => {
  const project = await createProject({
    config: {
      source: 'src',
      output: 'miniprogram',
      runtime: { bindingGroupSize: 2 },
      pages: { 'pages/home/index': 'App.tsx' },
    },
    files: {
      'src/App.tsx': `import { createSignal } from 'solid-js'
export default function App() {
  const [count] = createSignal(0)
  return <text>{count()}</text>
}
`,
    },
  })
  await Promise.all(appShell(project))
  await buildProject(project)
  const generated = await readFile(
    path.join(project, 'miniprogram/components/glaze-app/index.js'),
    'utf8',
  )
  assert.match(generated, /bindingGroupSize:2/)
})

test('compiles component and app SCSS through the build', async () => {
  const project = await createProject({
    config: {
      source: 'src',
      output: 'miniprogram',
      pages: { 'pages/home/index': 'App.tsx' },
    },
    files: {
      'src/app.js': 'App({})\n',
      'src/app.json': JSON.stringify({ componentFramework: 'glass-easel', window: {} }),
      'src/app.scss': `$bg: #fefefe;\npage { background: $bg; }\n`,
      'src/_vars.scss': '$brand: #123456;\n',
      'src/App.tsx': `export default function App() {\n  return <view class="title">scss</view>\n}\n`,
      'src/App.scss': `@use './vars' as *;\n.title { color: $brand; }\n`,
    },
  })

  const warnings = []
  const originalWarn = console.warn
  console.warn = (message) => warnings.push(String(message))
  try {
    await buildProject(project)
  } finally {
    console.warn = originalWarn
  }

  assert.equal(warnings.some((message) => message.includes('app.wxss is missing')), false)
  const appWxss = await readFile(path.join(project, 'miniprogram/app.wxss'), 'utf8')
  assert.match(appWxss, /page\s*\{\s*background: #fefefe;/)
  const componentWxss = await readFile(
    path.join(project, 'miniprogram/components/glaze-app/index.wxss'),
    'utf8',
  )
  assert.match(componentWxss, /\.title\s*\{\s*color: #123456;/)
})

test('compiles component and app Less through the build', async () => {
  const project = await createProject({
    config: {
      source: 'src',
      output: 'miniprogram',
      pages: { 'pages/home/index': 'App.tsx' },
    },
    files: {
      'src/app.js': 'App({})\n',
      'src/app.json': JSON.stringify({ componentFramework: 'glass-easel', window: {} }),
      'src/app.less': `@bg: #fafafa;\npage { background: @bg; }\n`,
      'src/vars.less': '@brand: #654321;\n',
      'src/App.tsx': `export default function App() {\n  return <view class="title">less</view>\n}\n`,
      'src/App.less': `@import './vars.less';\n.title { color: @brand; }\n`,
    },
  })

  await buildProject(project)

  const appWxss = await readFile(path.join(project, 'miniprogram/app.wxss'), 'utf8')
  assert.match(appWxss, /page\s*\{\s*background: #fafafa;/)
  const componentWxss = await readFile(
    path.join(project, 'miniprogram/components/glaze-app/index.wxss'),
    'utf8',
  )
  assert.match(componentWxss, /\.title\s*\{\s*color: #654321;/)
})

test('generates Tailwind app.wxss and escapes generated WXML classes', async () => {
  const project = await createProject({
    config: {
      source: 'src',
      output: 'miniprogram',
      pages: { 'pages/home/index': 'App.tsx' },
      css: { tailwind: { input: 'src/tailwind.css', safelist: ['text-[40rpx]'] } },
    },
    files: {
      'src/tailwind.css': `@import "tailwindcss" source(none);\n@source "./**/*.{tsx,ts}";\n`,
      'src/App.tsx': `import { createSignal } from 'solid-js'
export default function App() {
  const [big] = createSignal(false)
  return <view class="p-4 bg-red-500"><text class="text-[20rpx]">hello</text><text class={big() ? 'text-[30rpx]' : 'text-[20rpx]'}>dynamic</text></view>
}
`,
    },
  })
  await Promise.all(appShell(project))

  await buildProject(project)

  const appWxss = await readFile(path.join(project, 'miniprogram/app.wxss'), 'utf8')
  assert.match(appWxss, /\.p-4\s*\{/)
  assert.match(appWxss, /\.text-_b20rpx_B\s*\{/)
  assert.match(appWxss, /\.text-_b40rpx_B\s*\{/)
  assert.match(appWxss, /page\s*\{\s*background: #fff;/)

  const wxml = await readFile(
    path.join(project, 'miniprogram/components/glaze-app/index.wxml'),
    'utf8',
  )
  assert.match(wxml, /class="p-4 bg-red-500"/)
  assert.match(wxml, /text-_b20rpx_B/)
  assert.doesNotMatch(wxml, /text-\[20rpx\]/)
  const bundle = await readFile(
    path.join(project, 'miniprogram/components/glaze-app/index.js'),
    'utf8',
  )
  assert.match(bundle, /text-_b30rpx_B/)
  assert.match(bundle, /text-_b20rpx_B/)
})

test('rejects Tailwind without an input stylesheet', async () => {
  const project = await createProject({
    config: {
      source: 'src',
      output: 'miniprogram',
      pages: { 'pages/home/index': 'App.tsx' },
      css: { tailwind: { input: 'src/missing.css' } },
    },
    files: {
      'src/App.tsx': 'export default function App() { return <view /> }\n',
    },
  })
  await Promise.all(appShell(project))
  await assert.rejects(buildProject(project), /Tailwind input stylesheet not found/)
})


test('parses snippet config and removes it from the component source', () => {
  const parsed = parseSnippetSource(`import type { X } from './x'
export const glaze = {
  page: { route: '/pages/demo/index' },
  app: { window: { navigationBarTitleText: 'Demo' } },
  tailwind: { safelist: ['p-4'] },
} satisfies { tailwind?: unknown }
export default function Page() {
  return <view class="p-4">demo</view>
}
`)

  assert.deepEqual(parsed.config.page, { route: '/pages/demo/index' })
  assert.deepEqual(parsed.config.tailwind, { safelist: ['p-4'] })
  assert.doesNotMatch(parsed.code, /export const glaze/)
  assert.match(parsed.code, /export default function Page/)
})

test('rejects snippet files without a static glaze export', () => {
  assert.throws(
    () => parseSnippetSource('export default function Page() { return <view /> }'),
    /must export a static `glaze` object/,
  )
  assert.throws(
    () =>
      parseSnippetSource(
        'export const glaze = makeConfig()\nexport default function Page() { return <view /> }',
      ),
    /static JSON value/,
  )
})

test('builds a standalone project from one snippet TSX', async () => {
  const project = await mkdtemp(path.join(tmpdir(), 'glaze-snippet-test-'))
  const source = path.join(project, 'Page.tsx')
  const out = path.join(project, 'out')
  await writeFile(
    source,
    `import { createSignal } from 'solid-js'
export const glaze = {
  project: { appid: 'wx1234567890', projectname: 'Single file' },
  app: { window: { navigationBarTitleText: 'Single file' } },
  page: { route: 'pages/demo/index', config: { navigationBarTitleText: 'Demo title' } },
  tailwind: true,
}
export default function Page() {
  const [count] = createSignal(0)
  return <view class="p-4"><text>{count()}</text></view>
}
`,
  )

  const result = await buildSnippet(source, { out })

  assert.equal(result.outDir, out)
  assert.equal(result.route, 'pages/demo/index')
  assert.deepEqual(result.pages, ['pages/demo/index'])

  const projectConfig = JSON.parse(
    await readFile(path.join(out, 'project.config.json'), 'utf8'),
  )
  assert.equal(projectConfig.miniprogramRoot, 'miniprogram/')
  assert.equal(projectConfig.compileType, 'miniprogram')
  assert.equal(projectConfig.appid, 'wx1234567890')

  const appJson = JSON.parse(await readFile(path.join(out, 'miniprogram/app.json'), 'utf8'))
  assert.deepEqual(appJson.pages, ['pages/demo/index'])
  assert.equal(appJson.componentFramework, 'glass-easel')
  assert.equal(appJson.window.glassEaselWebview, true)
  assert.equal(appJson.window.navigationBarTitleText, 'Single file')

  const pageJson = JSON.parse(
    await readFile(path.join(out, 'miniprogram/pages/demo/index.json'), 'utf8'),
  )
  assert.equal(pageJson.navigationBarTitleText, 'Demo title')

  const appWxss = await readFile(path.join(out, 'miniprogram/app.wxss'), 'utf8')
  assert.match(appWxss, /\.p-4\s*\{/)

  assert.equal(
    defaultSnippetOut('/tmp/HelloWorld.tsx'),
    path.resolve(process.cwd(), 'hello-world-snippet'),
  )
})

test('refuses to replace an existing snippet output without force', async () => {
  const project = await mkdtemp(path.join(tmpdir(), 'glaze-snippet-test-'))
  const source = path.join(project, 'Page.tsx')
  const out = path.join(project, 'out')
  await writeFile(
    source,
    `export const glaze = { page: { route: 'pages/index/index' } }
export default function Page() { return <view>demo</view> }
`,
  )
  await buildSnippet(source, { out })
  await assert.rejects(() => buildSnippet(source, { out }), /Pass --force/)
})

test('CLI snippet defaults its output next to the current directory', async () => {
  const project = await mkdtemp(path.join(tmpdir(), 'glaze-snippet-cli-'))
  await writeFile(
    path.join(project, 'Page.tsx'),
    `export const glaze = { page: { route: 'pages/index/index' } }
export default function Page() { return <view>cli</view> }
`,
  )
  const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url))
  const run = spawnSync(process.execPath, [cli, 'snippet', 'Page.tsx'], {
    cwd: project,
    encoding: 'utf8',
  })
  assert.equal(run.status, 0, run.stderr)
  assert.match(run.stdout, /glaze snippet: 1 page, 1 components/)
  assert.equal(await exists(path.join(project, 'page-snippet/project.config.json')), true)
})
