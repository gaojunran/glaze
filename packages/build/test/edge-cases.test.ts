import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { buildProject } from '../src/build.ts'
import { buildSnippet, defaultSnippetOut, parseSnippetSource } from '../src/snippet.ts'
import { watchProject } from '../src/index.ts'

const exists = async (file) => {
  try {
    await access(file)
    return true
  } catch {
    return false
  }
}

async function createProject({ config, files = {}, configFile = 'glaze.config.mjs' }) {
  const project = await mkdtemp(path.join(tmpdir(), 'glaze-edge-'))
  await writeProjectFile(
    project,
    configFile,
    `export default ${JSON.stringify(config, null, 2)}\n`,
  )
  for (const [relative, content] of Object.entries(files)) {
    await writeProjectFile(project, relative, content)
  }
  return project
}

async function writeProjectFile(project, relative, content) {
  const file = path.join(project, relative)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, content)
}

const appShell = (project) =>
  Promise.all([
    writeProjectFile(project, 'src/app.js', 'App({})\n'),
    writeProjectFile(project, 'src/app.wxss', 'page { background: #fff; }\n'),
    writeProjectFile(
      project,
      'src/app.json',
      JSON.stringify({ componentFramework: 'glass-easel', window: {} }),
    ),
  ])

const sorted = (values) => [...values].sort()

async function waitUntil(predicate, timeout = 8000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await predicate()) return true
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return false
}

const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'))

// ---------------------------------------------------------------------------
// Config validation
// ---------------------------------------------------------------------------

test('defaults source and output when the config omits them', async () => {
  const project = await createProject({
    config: { pages: { 'pages/home/index': 'App.tsx' } },
    files: {
      'src/App.tsx': 'export default function App() { return <view>defaults</view> }\n',
    },
  })
  await appShell(project)

  const result = await buildProject(project)
  assert.equal(result.outputDir, path.join(project, 'miniprogram'))
  assert.equal(await exists(path.join(project, 'miniprogram/app.json')), true)
})

test('rejects a missing source directory', async () => {
  const project = await createProject({
    config: {
      source: 'missing-src',
      output: 'miniprogram',
      pages: { 'pages/home/index': 'App.tsx' },
    },
  })
  await assert.rejects(
    () => buildProject(project),
    /Config "source" directory not found: missing-src/,
  )
})

test('rejects an output that resolves to the project root', async () => {
  const project = await createProject({
    config: { source: 'src', output: '.', pages: { 'pages/home/index': 'App.tsx' } },
    files: { 'src/App.tsx': 'export default function App() { return <view /> }\n' },
  })
  await appShell(project)
  await assert.rejects(
    () => buildProject(project),
    /Config "output" must be a subdirectory of the project/,
  )
})

test('rejects an output equal to the source directory', async () => {
  const project = await createProject({
    config: { source: 'src', output: 'src', pages: { 'pages/home/index': 'App.tsx' } },
    files: { 'src/App.tsx': 'export default function App() { return <view /> }\n' },
  })
  await appShell(project)
  await assert.rejects(
    () => buildProject(project),
    /Config "output" must not be the same directory as "source"/,
  )
})

test('rejects an output that contains the staging directory', async () => {
  const project = await createProject({
    config: { source: 'src', output: '.tmp', pages: { 'pages/home/index': 'App.tsx' } },
    files: { 'src/App.tsx': 'export default function App() { return <view /> }\n' },
  })
  await appShell(project)
  await assert.rejects(
    () => buildProject(project),
    /must not contain the build staging directory/,
  )
})

test('rejects a source nested inside the output', async () => {
  const project = await createProject({
    config: {
      source: 'dist/src',
      output: 'dist',
      pages: { 'pages/home/index': 'App.tsx' },
    },
    files: {
      'dist/src/App.tsx': 'export default function App() { return <view /> }\n',
    },
  })
  await assert.rejects(
    () => buildProject(project),
    /Config "source" must not be inside "output"/,
  )
})

test('rejects a negative binding group size', async () => {
  const project = await createProject({
    config: {
      source: 'src',
      output: 'miniprogram',
      runtime: { bindingGroupSize: -1 },
      pages: { 'pages/home/index': 'App.tsx' },
    },
    files: { 'src/App.tsx': 'export default function App() { return <view /> }\n' },
  })
  await appShell(project)
  await assert.rejects(
    () => buildProject(project),
    /Config "runtime.bindingGroupSize" must be a positive integer/,
  )
})

test('rejects a fractional binding group size', async () => {
  const project = await createProject({
    config: {
      source: 'src',
      output: 'miniprogram',
      runtime: { bindingGroupSize: 1.5 },
      pages: { 'pages/home/index': 'App.tsx' },
    },
    files: { 'src/App.tsx': 'export default function App() { return <view /> }\n' },
  })
  await appShell(project)
  await assert.rejects(
    () => buildProject(project),
    /Config "runtime.bindingGroupSize" must be a positive integer/,
  )
})

test('rejects a string binding group size', async () => {
  const project = await createProject({
    config: {
      source: 'src',
      output: 'miniprogram',
      runtime: { bindingGroupSize: '4' },
      pages: { 'pages/home/index': 'App.tsx' },
    },
    files: { 'src/App.tsx': 'export default function App() { return <view /> }\n' },
  })
  await appShell(project)
  await assert.rejects(
    () => buildProject(project),
    /Config "runtime.bindingGroupSize" must be a positive integer/,
  )
})

test('rejects a static entry that is not a string or object', async () => {
  const project = await createProject({
    config: {
      source: 'src',
      output: 'miniprogram',
      pages: { 'pages/home/index': 'App.tsx' },
      static: [42],
    },
    files: { 'src/App.tsx': 'export default function App() { return <view /> }\n' },
  })
  await appShell(project)
  await assert.rejects(
    () => buildProject(project),
    /Static entries must be a string or an object with "from"/,
  )
})

test('rejects a static entry without a usable from path', async () => {
  const project = await createProject({
    config: {
      source: 'src',
      output: 'miniprogram',
      pages: { 'pages/home/index': 'App.tsx' },
      static: [{}],
    },
    files: { 'src/App.tsx': 'export default function App() { return <view /> }\n' },
  })
  await appShell(project)
  await assert.rejects(
    () => buildProject(project),
    /Static asset "from" must be a non-empty relative path/,
  )
})

test('rejects a static entry that names the source root', async () => {
  const project = await createProject({
    config: {
      source: 'src',
      output: 'miniprogram',
      pages: { 'pages/home/index': 'App.tsx' },
      static: ['.'],
    },
    files: { 'src/App.tsx': 'export default function App() { return <view /> }\n' },
  })
  await appShell(project)
  await assert.rejects(
    () => buildProject(project),
    /Static asset "from" must name a subdirectory or file: \./,
  )
})

test('rejects a static source outside the source directory', async () => {
  const project = await createProject({
    config: {
      source: 'src',
      output: 'miniprogram',
      pages: { 'pages/home/index': 'App.tsx' },
      static: ['../outside'],
    },
    files: { 'src/App.tsx': 'export default function App() { return <view /> }\n' },
  })
  await appShell(project)
  await assert.rejects(
    () => buildProject(project),
    /Static asset source must be inside "source": \.\.\/outside/,
  )
})

test('rejects a static target that escapes the output', async () => {
  const project = await createProject({
    config: {
      source: 'src',
      output: 'miniprogram',
      pages: { 'pages/home/index': 'App.tsx' },
      static: [{ from: 'assets', to: '../assets' }],
    },
    files: {
      'src/App.tsx': 'export default function App() { return <view /> }\n',
      'src/assets/logo.png': 'png',
    },
  })
  await appShell(project)
  await assert.rejects(
    () => buildProject(project),
    /Static asset target must be a relative path: \.\.\/assets/,
  )
})

test('rejects a static entry for a missing subpackage', async () => {
  const project = await createProject({
    config: {
      source: 'src',
      output: 'miniprogram',
      pages: { 'pages/home/index': 'App.tsx' },
      static: [{ from: 'assets', subpackage: 'nope' }],
    },
    files: {
      'src/App.tsx': 'export default function App() { return <view /> }\n',
      'src/assets/logo.png': 'png',
    },
  })
  await appShell(project)
  await assert.rejects(
    () => buildProject(project),
    /Static asset subpackage does not exist: nope/,
  )
})

test('rejects tailwind without a configured input', async () => {
  const project = await createProject({
    config: {
      source: 'src',
      output: 'miniprogram',
      pages: { 'pages/home/index': 'App.tsx' },
      css: { tailwind: {} },
    },
    files: { 'src/App.tsx': 'export default function App() { return <view /> }\n' },
  })
  await appShell(project)
  await assert.rejects(
    () => buildProject(project),
    /Config "css.tailwind.input" must be a stylesheet path/,
  )
})

test('rejects a tailwind input outside the project', async () => {
  const project = await createProject({
    config: {
      source: 'src',
      output: 'miniprogram',
      pages: { 'pages/home/index': 'App.tsx' },
      css: { tailwind: { input: '../tailwind.css' } },
    },
    files: { 'src/App.tsx': 'export default function App() { return <view /> }\n' },
  })
  await appShell(project)
  await assert.rejects(
    () => buildProject(project),
    /Config "css.tailwind.input" must be inside the project: \.\.\/tailwind\.css/,
  )
})

test('rejects a tailwind safelist with non-string entries', async () => {
  const project = await createProject({
    config: {
      source: 'src',
      output: 'miniprogram',
      pages: { 'pages/home/index': 'App.tsx' },
      css: { tailwind: { input: 'src/tailwind.css', safelist: [1] } },
    },
    files: {
      'src/App.tsx': 'export default function App() { return <view /> }\n',
      'src/tailwind.css': '@import "tailwindcss" source(none);\n',
    },
  })
  await appShell(project)
  await assert.rejects(
    () => buildProject(project),
    /Config "css.tailwind.safelist" must be an array of class names/,
  )
})

// ---------------------------------------------------------------------------
// Route and subpackage normalization
// ---------------------------------------------------------------------------

test('normalizes a subpackage root before writing app.json', async () => {
  const project = await createProject({
    config: {
      source: 'src',
      output: 'miniprogram',
      pages: { 'pages/home/index': 'App.tsx' },
      subpackages: [
        { root: './pkg/', pages: { 'pages/sub/index': 'pkg/Sub.tsx' } },
      ],
    },
    files: {
      'src/App.tsx': 'export default function App() { return <view /> }\n',
      'src/pkg/Sub.tsx': 'export default function Sub() { return <view>sub</view> }\n',
    },
  })
  await appShell(project)

  const result = await buildProject(project)
  assert.deepEqual(result.pages, ['pages/home/index', 'pkg/pages/sub/index'])
  const appJson = await readJson(path.join(project, 'miniprogram/app.json'))
  assert.deepEqual(appJson.subPackages, [{ root: 'pkg', pages: ['pages/sub/index'] }])
  assert.equal(await exists(path.join(project, 'miniprogram/pkg/pages/sub/index.wxml')), true)
})

test('rejects subpackage roots that normalize to the same value', async () => {
  const project = await createProject({
    config: {
      source: 'src',
      output: 'miniprogram',
      pages: { 'pages/home/index': 'App.tsx' },
      subpackages: [
        { root: 'pkg', pages: { 'pages/a/index': 'pkg/A.tsx' } },
        { root: './pkg', pages: { 'pages/b/index': 'pkg/B.tsx' } },
      ],
    },
    files: {
      'src/App.tsx': 'export default function App() { return <view /> }\n',
      'src/pkg/A.tsx': 'export default function A() { return <view /> }\n',
      'src/pkg/B.tsx': 'export default function B() { return <view /> }\n',
    },
  })
  await appShell(project)
  await assert.rejects(() => buildProject(project), /Duplicate subpackage root: pkg/)
})

test('rejects an empty subpackage root', async () => {
  const project = await createProject({
    config: {
      source: 'src',
      output: 'miniprogram',
      pages: { 'pages/home/index': 'App.tsx' },
      subpackages: [{ root: '', pages: { 'pages/sub/index': 'Sub.tsx' } }],
    },
    files: {
      'src/App.tsx': 'export default function App() { return <view /> }\n',
      'src/Sub.tsx': 'export default function Sub() { return <view /> }\n',
    },
  })
  await appShell(project)
  await assert.rejects(
    () => buildProject(project),
    /Config "subpackages\[\]\.root" must not be empty/,
  )
})

test('rejects a subpackage root that escapes the project', async () => {
  const project = await createProject({
    config: {
      source: 'src',
      output: 'miniprogram',
      pages: { 'pages/home/index': 'App.tsx' },
      subpackages: [{ root: '../pkg', pages: { 'pages/sub/index': 'Sub.tsx' } }],
    },
    files: {
      'src/App.tsx': 'export default function App() { return <view /> }\n',
      'src/Sub.tsx': 'export default function Sub() { return <view /> }\n',
    },
  })
  await appShell(project)
  await assert.rejects(
    () => buildProject(project),
    /Config "subpackages\[\]\.root" must be a relative package root: \.\.\/pkg/,
  )
})

test('rejects a subpackage without pages', async () => {
  const project = await createProject({
    config: {
      source: 'src',
      output: 'miniprogram',
      pages: { 'pages/home/index': 'App.tsx' },
      subpackages: [{ root: 'pkg', pages: {} }],
    },
    files: { 'src/App.tsx': 'export default function App() { return <view /> }\n' },
  })
  await appShell(project)
  await assert.rejects(
    () => buildProject(project),
    /Subpackage "pkg" does not declare any pages/,
  )
})

test('rejects a project whose pages are all in subpackages', async () => {
  const project = await createProject({
    config: {
      source: 'src',
      output: 'miniprogram',
      pages: {},
      subpackages: [{ root: 'pkg', pages: { 'pages/sub/index': 'pkg/Sub.tsx' } }],
    },
    files: {
      'src/pkg/Sub.tsx': 'export default function Sub() { return <view /> }\n',
    },
  })
  await appShell(project)
  await assert.rejects(() => buildProject(project), /At least one main-package page is required/)
})

test('rejects duplicate page routes after normalization', async () => {
  const project = await createProject({
    config: {
      source: 'src',
      output: 'miniprogram',
      pages: {
        'pages/home/index': 'App.tsx',
        './pages/home/index.wxml': 'Other.tsx',
      },
    },
    files: {
      'src/App.tsx': 'export default function App() { return <view /> }\n',
      'src/Other.tsx': 'export default function Other() { return <view /> }\n',
    },
  })
  await appShell(project)
  await assert.rejects(() => buildProject(project), /Duplicate page route: pages\/home\/index/)
})

test('normalizes a page route suffix and leading slash', async () => {
  const project = await createProject({
    config: {
      source: 'src',
      output: 'miniprogram',
      pages: { '/pages/home/index.wxml': 'App.tsx' },
    },
    files: {
      'src/App.tsx': 'export default function App() { return <view>normalized</view> }\n',
    },
  })
  await appShell(project)

  const result = await buildProject(project)
  assert.deepEqual(result.pages, ['pages/home/index'])
  assert.equal(await exists(path.join(project, 'miniprogram/pages/home/index.wxml')), true)
  const appJson = await readJson(path.join(project, 'miniprogram/app.json'))
  assert.deepEqual(appJson.pages, ['pages/home/index'])
})

test('rejects pageConfig for a route that matches no page', async () => {
  const project = await createProject({
    config: {
      source: 'src',
      output: 'miniprogram',
      pages: { 'pages/home/index': 'App.tsx' },
      pageConfig: { 'pages/unknown/index': { navigationBarTitleText: 'x' } },
    },
    files: { 'src/App.tsx': 'export default function App() { return <view /> }\n' },
  })
  await appShell(project)
  await assert.rejects(
    () => buildProject(project),
    /Page config route "pages\/unknown\/index" does not match any page/,
  )
})

test('rejects a pageConfig entry that is not an object', async () => {
  const project = await createProject({
    config: {
      source: 'src',
      output: 'miniprogram',
      pages: { 'pages/home/index': 'App.tsx' },
      pageConfig: { 'pages/home/index': [] },
    },
    files: { 'src/App.tsx': 'export default function App() { return <view /> }\n' },
  })
  await appShell(project)
  await assert.rejects(
    () => buildProject(project),
    /Page config for "pages\/home\/index" must be an object/,
  )
})

test('rejects pageConfig usingComponents that is not an object', async () => {
  const project = await createProject({
    config: {
      source: 'src',
      output: 'miniprogram',
      pages: { 'pages/home/index': 'App.tsx' },
      pageConfig: { 'pages/home/index': { usingComponents: [] } },
    },
    files: { 'src/App.tsx': 'export default function App() { return <view /> }\n' },
  })
  await appShell(project)
  await assert.rejects(
    () => buildProject(project),
    /Page config for "pages\/home\/index" must be an object/,
  )
})

test('rejects a subpackage page whose file lives in the main package', async () => {
  const project = await createProject({
    config: {
      source: 'src',
      output: 'miniprogram',
      pages: { 'pages/home/index': 'App.tsx' },
      subpackages: [{ root: 'pkg', pages: { 'pages/sub/index': 'Sub.tsx' } }],
    },
    files: {
      'src/App.tsx': 'export default function App() { return <view /> }\n',
      'src/Sub.tsx': 'export default function Sub() { return <view /> }\n',
    },
  })
  await appShell(project)
  await assert.rejects(
    () => buildProject(project),
    /Page "pkg\/pages\/sub\/index" must live inside subpackage "pkg"/,
  )
})

test('rejects a main page whose file lives in a subpackage', async () => {
  const project = await createProject({
    config: {
      source: 'src',
      output: 'miniprogram',
      pages: { 'pages/home/index': 'pkg/App.tsx' },
      subpackages: [{ root: 'pkg', pages: { 'pages/sub/index': 'pkg/Sub.tsx' } }],
    },
    files: {
      'src/pkg/App.tsx': 'export default function App() { return <view /> }\n',
      'src/pkg/Sub.tsx': 'export default function Sub() { return <view /> }\n',
    },
  })
  await appShell(project)
  await assert.rejects(
    () => buildProject(project),
    /Page "pages\/home\/index" must live inside the main package/,
  )
})

// ---------------------------------------------------------------------------
// Output shape
// ---------------------------------------------------------------------------

test('writes the four page wrapper files', async () => {
  const project = await createProject({
    config: {
      source: 'src',
      output: 'miniprogram',
      pages: { 'pages/home/index': 'App.tsx' },
    },
    files: {
      'src/App.tsx': `const usePageEvent = (name: string) => () => name
const onPageEvent = (name: string, handler: () => unknown) => handler()

export default function App() {
  usePageEvent('scroll')()
  onPageEvent('shareAppMessage', () => ({ title: 'shared' }))
  return <view>wrapper</view>
}
`,
    },
  })
  await appShell(project)
  await buildProject(project)

  const pageDir = path.join(project, 'miniprogram/pages/home/index')
  const pageScript = await readFile(`${pageDir}.js`, 'utf8')
  assert.match(pageScript, /^function dispatchGlazePageEvent/)
  assert.match(pageScript, /onPageScroll\(event\)/)
  assert.match(pageScript, /onShareAppMessage\(event\)/)
  assert.match(pageScript, /__glazePageEvent/)
  assert.match(pageScript, /onLoad\(query\)/)
  assert.match(pageScript, /nextGlazePageId/)

  let pageOptions
  runInNewContext(pageScript, {
    Page: (options) => {
      pageOptions = options
    },
  })
  const calls = []
  const root = {
    __glazePageEvent(name, payload) {
      calls.push([name, payload])
      return name === 'shareAppMessage' ? { title: 'shared' } : undefined
    },
  }
  const pageData = {}
  const page = {
    selectComponent: (selector) => (selector === '#app' ? root : null),
    setData(data) {
      Object.assign(pageData, data)
    },
  }
  pageOptions.onLoad.call(page, { from: 'scan' })
  assert.equal(pageData.__glazePage.query.from, 'scan')
  assert.ok(pageData.__glazePage.id)
  pageOptions.onPageScroll.call(page, { scrollTop: 7 })
  assert.deepEqual(calls[0], ['scroll', { scrollTop: 7 }])
  assert.deepEqual(
    pageOptions.onShareAppMessage.call(page, { from: 'menu' }),
    { title: 'shared' },
  )
  assert.equal(await readFile(`${pageDir}.wxss`, 'utf8'), '')
  assert.equal(
    await readFile(`${pageDir}.wxml`, 'utf8'),
    '<glaze-page id="app" glazepage="{{__glazePage}}" />\n',
  )
  const pageJson = await readJson(`${pageDir}.json`)
  assert.deepEqual(pageJson.usingComponents, {
    'glaze-page': '/components/glaze-app/index',
  })
})

test('page context reaches only boundaries whose subtree uses page hooks', async () => {
  const project = await createProject({
    config: {
      source: 'src',
      output: 'miniprogram',
      pages: { 'pages/home/index': 'App.tsx' },
    },
    files: {
      'src/App.tsx': `
        import Hooked from './Hooked'
        import Plain from './Plain'
        export default function App() { return <view><Hooked /><Plain /></view> }
      `,
      'src/Hooked.tsx': `
        import { usePageEvent, usePageOptions } from '@glaze/runtime'
        export default function Hooked() {
          usePageEvent('scroll')
          usePageOptions()
          return <view>hooked</view>
        }
      `,
      'src/Plain.tsx': `
        export default function Plain() {
          return <view><slot name="label" /></view>
        }
      `,
    },
  })
  await appShell(project)
  await buildProject(project)

  const pageDir = path.join(project, 'miniprogram/pages/home/index')
  const pageScript = await readFile(`${pageDir}.js`, 'utf8')
  assert.match(pageScript, /onPageScroll\(event\)/)
  assert.match(pageScript, /onLoad\(query\)/)
  assert.equal(
    await readFile(`${pageDir}.wxml`, 'utf8'),
    '<glaze-page id="app" glazepage="{{__glazePage}}" />\n',
  )

  const rootDir = path.join(project, 'miniprogram/components/glaze-app')
  const rootWxml = await readFile(`${rootDir}/index.wxml`, 'utf8')
  assert.equal((rootWxml.match(/glazepage="\{\{glazepage\}\}"/g) ?? []).length, 1)
  const rootConfig = await readFile(`${rootDir}/index.js`, 'utf8')
  assert.match(rootConfig, /pageContext:!0/)
  assert.match(rootConfig, /pageRoot:!0/)

  const hookedConfig = await readFile(
    path.join(project, 'miniprogram/components/glaze-hooked/index.js'),
    'utf8',
  )
  assert.match(hookedConfig, /pageContext:!0/)
  assert.doesNotMatch(hookedConfig, /pageRoot:!0/)
  const plainConfig = await readFile(
    path.join(project, 'miniprogram/components/glaze-plain/index.js'),
    'utf8',
  )
  assert.doesNotMatch(plainConfig, /pageContext:!0/)
})

test('writes a component JSON without options when there are no named slots', async () => {
  const project = await createProject({
    config: {
      source: 'src',
      output: 'miniprogram',
      pages: { 'pages/home/index': 'App.tsx' },
    },
    files: {
      'src/App.tsx': `import Child from './Child'
export default function App() {
  return <view><Child /></view>
}
`,
      'src/Child.tsx': `export default function Child() {
  return <view><slot /><text>child</text></view>
}
`,
    },
  })
  await appShell(project)
  await buildProject(project)

  const componentJson = await readJson(
    path.join(project, 'miniprogram/components/glaze-child/index.json'),
  )
  assert.deepEqual(componentJson, {
    component: true,
    styleIsolation: 'apply-shared',
    usingComponents: {},
  })
})

test('enables multipleSlots for a component with named slots', async () => {
  const project = await createProject({
    config: {
      source: 'src',
      output: 'miniprogram',
      pages: { 'pages/home/index': 'App.tsx' },
    },
    files: {
      'src/App.tsx': `import Card from './Card'
export default function App() {
  return <Card><text slot="header">title</text><text>body</text></Card>
}
`,
      'src/Card.tsx': `export default function Card() {
  return <view><slot name="header" /><slot /><text>card</text></view>
}
`,
    },
  })
  await appShell(project)
  await buildProject(project)

  const cardJson = await readJson(
    path.join(project, 'miniprogram/components/glaze-card/index.json'),
  )
  assert.deepEqual(cardJson.options, { multipleSlots: true })
  assert.equal(cardJson.usingComponents['glaze-page'], undefined)
  const appJson = await readJson(
    path.join(project, 'miniprogram/components/glaze-app/index.json'),
  )
  assert.equal(appJson.options, undefined)
  assert.equal(appJson.usingComponents.card, '/components/glaze-card/index')
})

test('reuses one generated component from two parent components', async () => {
  const project = await createProject({
    config: {
      source: 'src',
      output: 'miniprogram',
      pages: { 'pages/home/index': 'App.tsx', 'pages/about/index': 'Other.tsx' },
    },
    files: {
      'src/App.tsx': `import Shared from './Shared'
export default function App() {
  return <view><Shared /></view>
}
`,
      'src/Other.tsx': `import Shared from './Shared'
export default function Other() {
  return <view><Shared /></view>
}
`,
      'src/Shared.tsx': `export default function Shared() {
  return <view><slot /><text>shared</text></view>
}
`,
    },
  })
  await appShell(project)

  const result = await buildProject(project)
  assert.deepEqual(sorted(result.components), [
    'glaze-app',
    'glaze-other',
    'glaze-shared',
  ])

  const shared = await readdir(path.join(project, 'miniprogram/components'))
  assert.deepEqual(sorted(shared), ['glaze-app', 'glaze-other', 'glaze-shared'])
  for (const page of ['pages/home/index', 'pages/about/index']) {
    const pageJson = await readJson(path.join(project, 'miniprogram', `${page}.json`))
    const wrapper = path.basename(path.dirname(page)) === 'home' ? 'glaze-app' : 'glaze-other'
    assert.equal(pageJson.usingComponents['glaze-page'], `/components/${wrapper}/index`)
  }
  const appJson = await readJson(
    path.join(project, 'miniprogram/components/glaze-app/index.json'),
  )
  assert.equal(appJson.usingComponents.shared, '/components/glaze-shared/index')
})

test('builds multiple pages with independent wrappers', async () => {
  const project = await createProject({
    config: {
      source: 'src',
      output: 'miniprogram',
      pages: {
        'pages/home/index': 'App.tsx',
        'pages/about/index': 'About.tsx',
      },
    },
    files: {
      'src/App.tsx': 'export default function App() { return <view>home</view> }\n',
      'src/About.tsx': 'export default function About() { return <view>about</view> }\n',
    },
  })
  await appShell(project)
  await buildProject(project)

  const appJson = await readJson(path.join(project, 'miniprogram/app.json'))
  assert.deepEqual(appJson.pages, ['pages/home/index', 'pages/about/index'])
  const home = await readJson(path.join(project, 'miniprogram/pages/home/index.json'))
  const about = await readJson(path.join(project, 'miniprogram/pages/about/index.json'))
  assert.equal(home.usingComponents['glaze-page'], '/components/glaze-app/index')
  assert.equal(about.usingComponents['glaze-page'], '/components/glaze-about/index')
  assert.match(
    await readFile(
      path.join(project, 'miniprogram/components/glaze-about/index.wxml'),
      'utf8',
    ),
    />about</,
  )
})

test('rejects two component names that kebab to the same tag', async () => {
  const project = await createProject({
    config: {
      source: 'src',
      output: 'miniprogram',
      pages: { 'pages/home/index': 'App.tsx' },
    },
    files: {
      'src/App.tsx': `import FooBar from './FooBar'
import FooBAR from './nested/FooBAR'

export default function App() {
  return <view><FooBar /><FooBAR /></view>
}
`,
      'src/FooBar.tsx': `export default function FooBar() {
  return <view><slot /><text>a</text></view>
}
`,
      'src/nested/FooBAR.tsx': `export default function FooBAR() {
  return <view><slot /><text>b</text></view>
}
`,
    },
  })
  await appShell(project)
  await assert.rejects(
    () => buildProject(project),
    /Duplicate component tag "foo-bar" in .*App\.tsx/,
  )
})

test('writes classic subpackage paths and shares the main runtime', async () => {
  const project = await createProject({
    config: {
      source: 'src',
      output: 'miniprogram',
      pages: { 'pages/home/index': 'App.tsx' },
      subpackages: [
        { root: 'pkg', pages: { 'pages/sub/index': 'pkg/Sub.tsx' }, independent: false },
      ],
    },
    files: {
      'src/App.tsx': 'export default function App() { return <view>main</view> }\n',
      'src/pkg/Sub.tsx': `import Child from './Child'
export default function Sub() {
  return <view><Child /></view>
}
`,
      'src/pkg/Child.tsx': `export default function Child() {
  return <view><slot /><text>child</text></view>
}
`,
    },
  })
  await appShell(project)
  await buildProject(project)

  const appJson = await readJson(path.join(project, 'miniprogram/app.json'))
  assert.deepEqual(appJson.subPackages, [{ root: 'pkg', pages: ['pages/sub/index'] }])
  const pageJson = await readJson(
    path.join(project, 'miniprogram/pkg/pages/sub/index.json'),
  )
  assert.equal(
    pageJson.usingComponents['glaze-page'],
    '/pkg/components/glaze-pkg-sub/index',
  )
  const componentJson = await readJson(
    path.join(project, 'miniprogram/pkg/components/glaze-pkg-sub/index.json'),
  )
  assert.equal(
    componentJson.usingComponents.child,
    '/pkg/components/glaze-pkg-child/index',
  )
  assert.equal(await exists(path.join(project, 'miniprogram/pkg/glaze-runtime')), false)
})

test('lets the generated glaze-page component win over pageConfig', async () => {
  const project = await createProject({
    config: {
      source: 'src',
      output: 'miniprogram',
      pages: { 'pages/home/index': 'App.tsx' },
      pageConfig: {
        'pages/home/index': {
          navigationBarTitleText: 'Home',
          usingComponents: {
            badge: '/components/badge/index',
            'glaze-page': '/components/custom/index',
          },
        },
      },
    },
    files: {
      'src/App.tsx': 'export default function App() { return <view /> }\n',
    },
  })
  await appShell(project)
  await buildProject(project)

  const pageJson = await readJson(
    path.join(project, 'miniprogram/pages/home/index.json'),
  )
  assert.equal(pageJson.navigationBarTitleText, 'Home')
  assert.equal(pageJson.usingComponents.badge, '/components/badge/index')
  assert.equal(pageJson.usingComponents['glaze-page'], '/components/glaze-app/index')
})

test('accepts pageConfig for a static page without writing a wrapper', async () => {
  const project = await createProject({
    config: {
      source: 'src',
      output: 'miniprogram',
      pages: { 'pages/home/index': 'App.tsx' },
      staticPages: ['pages/native/index'],
      pageConfig: { 'pages/native/index': { navigationBarTitleText: 'Native' } },
    },
    files: {
      'src/App.tsx': 'export default function App() { return <view /> }\n',
    },
  })
  await appShell(project)
  await buildProject(project)

  const appJson = await readJson(path.join(project, 'miniprogram/app.json'))
  assert.deepEqual(appJson.pages, ['pages/home/index', 'pages/native/index'])
  assert.equal(
    await exists(path.join(project, 'miniprogram/pages/native/index.json')),
    false,
  )
})

test('copies a static file to an explicit target file name', async () => {
  const project = await createProject({
    config: {
      source: 'src',
      output: 'miniprogram',
      pages: { 'pages/home/index': 'App.tsx' },
      static: [{ from: 'icon.png', to: 'images/app.png' }],
    },
    files: {
      'src/App.tsx': 'export default function App() { return <view /> }\n',
      'src/icon.png': 'icon-bytes',
    },
  })
  await appShell(project)
  await buildProject(project)

  assert.equal(
    await readFile(path.join(project, 'miniprogram/images/app.png'), 'utf8'),
    'icon-bytes',
  )
  assert.equal(await exists(path.join(project, 'miniprogram/icon.png')), false)
})

test('copies a static directory to a renamed directory and rewrites WXSS urls', async () => {
  const project = await createProject({
    config: {
      source: 'src',
      output: 'miniprogram',
      pages: { 'pages/home/index': 'App.tsx' },
      static: [{ from: 'assets', to: 'img' }],
    },
    files: {
      'src/App.tsx': `export default function App() {
  return <view class="page">asset</view>
}
`,
      'src/App.wxss': `.page { background: url('./assets/bg.png'); }\n`,
      'src/assets/bg.png': 'png',
    },
  })
  await appShell(project)
  await buildProject(project)

  assert.equal(await exists(path.join(project, 'miniprogram/img/bg.png')), true)
  const wxss = await readFile(
    path.join(project, 'miniprogram/components/glaze-app/index.wxss'),
    'utf8',
  )
  assert.match(wxss, /url\('\.\.\/\.\.\/img\/bg\.png'\)/)
})

test('preserves query and hash suffixes when rewriting a WXSS url', async () => {
  const project = await createProject({
    config: {
      source: 'src',
      output: 'miniprogram',
      pages: { 'pages/home/index': 'App.tsx' },
      static: [{ from: 'assets', to: 'assets' }],
    },
    files: {
      'src/App.tsx': `export default function App() {
  return <view class="page">asset</view>
}
`,
      'src/App.wxss': `.page { background: url('./assets/bg.png?v=1#frag'); }\n`,
      'src/assets/bg.png': 'png',
    },
  })
  await appShell(project)
  await buildProject(project)

  const wxss = await readFile(
    path.join(project, 'miniprogram/components/glaze-app/index.wxss'),
    'utf8',
  )
  assert.match(wxss, /url\('\.\.\/\.\.\/assets\/bg\.png\?v=1#frag'\)/)
})

test('the default clean build removes stale output files', async () => {
  const project = await createProject({
    config: {
      source: 'src',
      output: 'miniprogram',
      pages: { 'pages/home/index': 'App.tsx' },
    },
    files: {
      'src/App.tsx': 'export default function App() { return <view>clean</view> }\n',
    },
  })
  await appShell(project)

  await buildProject(project)
  await writeProjectFile(project, 'miniprogram/stale.txt', 'stale\n')
  await buildProject(project)

  assert.equal(await exists(path.join(project, 'miniprogram/stale.txt')), false)
  assert.equal(await exists(path.join(project, 'miniprogram/app.json')), true)
})

test('preserves unrelated app.json settings while replacing pages', async () => {
  const project = await createProject({
    config: {
      source: 'src',
      output: 'miniprogram',
      pages: { 'pages/home/index': 'App.tsx' },
    },
    files: {
      'src/App.tsx': 'export default function App() { return <view /> }\n',
    },
  })
  await Promise.all([
    writeProjectFile(project, 'src/app.js', 'App({})\n'),
    writeProjectFile(project, 'src/app.wxss', ''),
    writeProjectFile(
      project,
      'src/app.json',
      JSON.stringify({
        componentFramework: 'glass-easel',
        window: { navigationBarTitleText: 'Keep me' },
        custom: { flag: true },
        pages: ['pages/stale/index'],
      }),
    ),
  ])
  await buildProject(project)

  const appJson = await readJson(path.join(project, 'miniprogram/app.json'))
  assert.equal(appJson.window.navigationBarTitleText, 'Keep me')
  assert.deepEqual(appJson.custom, { flag: true })
  assert.deepEqual(appJson.pages, ['pages/home/index'])
})

test('copies app.js into the output', async () => {
  const project = await createProject({
    config: {
      source: 'src',
      output: 'miniprogram',
      pages: { 'pages/home/index': 'App.tsx' },
    },
    files: {
      'src/App.tsx': 'export default function App() { return <view /> }\n',
      'src/app.js': 'App({ onLaunch() {} })\n',
    },
  })
  await Promise.all([
    writeProjectFile(project, 'src/app.wxss', ''),
    writeProjectFile(
      project,
      'src/app.json',
      JSON.stringify({ componentFramework: 'glass-easel', window: {} }),
    ),
  ])
  await buildProject(project)

  assert.equal(
    await readFile(path.join(project, 'miniprogram/app.js'), 'utf8'),
    'App({ onLaunch() {} })\n',
  )
})

test('inlines a child style into the parent component wxss', async () => {
  const project = await createProject({
    config: {
      source: 'src',
      output: 'miniprogram',
      pages: { 'pages/home/index': 'App.tsx' },
    },
    files: {
      'src/App.tsx': `import Child from './Child'
export default function App() {
  return <view class="page"><Child title="hi" /></view>
}
`,
      'src/App.wxss': `.page { color: red; }\n`,
      'src/Child.tsx': `export default function Child(props) {
  return <text class="child">{props.title}</text>
}
`,
      'src/Child.wxss': `.child { font-weight: bold; }\n`,
    },
  })
  await appShell(project)
  await buildProject(project)

  assert.equal(await exists(path.join(project, 'miniprogram/components/glaze-child')), false)
  const wxss = await readFile(
    path.join(project, 'miniprogram/components/glaze-app/index.wxss'),
    'utf8',
  )
  assert.match(wxss, /\.page\s*\{\s*color: red;/)
  assert.match(wxss, /\.child\s*\{\s*font-weight: bold;/)
})

test('emits an empty component wxss when no style exists', async () => {
  const project = await createProject({
    config: {
      source: 'src',
      output: 'miniprogram',
      pages: { 'pages/home/index': 'App.tsx' },
    },
    files: {
      'src/App.tsx': 'export default function App() { return <view /> }\n',
    },
  })
  await appShell(project)
  await buildProject(project)

  assert.equal(
    await readFile(
      path.join(project, 'miniprogram/components/glaze-app/index.wxss'),
      'utf8',
    ),
    '',
  )
})

test('reports the output directory and merged config in the build result', async () => {
  const project = await createProject({
    config: {
      source: 'src',
      output: 'miniprogram',
      pages: { 'pages/home/index': 'App.tsx' },
    },
    files: {
      'src/App.tsx': 'export default function App() { return <view /> }\n',
    },
  })
  await appShell(project)

  const result = await buildProject(project)
  assert.equal(result.outputDir, path.join(project, 'miniprogram'))
  assert.equal(result.config.source, 'src')
  assert.equal(result.config.output, 'miniprogram')
  assert.deepEqual(result.pages, ['pages/home/index'])
})

// ---------------------------------------------------------------------------
// Watch
// ---------------------------------------------------------------------------

test('watch rebuilds when the config changes the binding group size', async () => {
  const config = {
    source: 'src',
    output: 'miniprogram',
    runtime: { bindingGroupSize: 2 },
    pages: { 'pages/home/index': 'App.tsx' },
  }
  const project = await createProject({
    config,
    files: {
      'src/App.tsx': `import { createSignal } from 'solid-js'
export default function App() {
  const [count] = createSignal(0)
  return <view>{count()}</view>
}
`,
    },
  })
  await appShell(project)

  let builds = 0
  const watcher = await watchProject(project, {
    onBuild: () => {
      builds += 1
    },
    onError: (error) => {
      throw error
    },
  })
  try {
    assert.equal(builds, 1)
    const bundlePath = path.join(project, 'miniprogram/components/glaze-app/index.js')
    assert.match(await readFile(bundlePath, 'utf8'), /bindingGroupSize:2/)

    await writeProjectFile(
      project,
      'glaze.config.mjs',
      `export default ${JSON.stringify({ ...config, runtime: { bindingGroupSize: 5 } })}\n`,
    )

    const rebuilt = await waitUntil(async () => {
      const bundle = await readFile(bundlePath, 'utf8').catch(() => '')
      return bundle.includes('bindingGroupSize:5')
    })
    assert.equal(rebuilt, true)
    assert.equal(builds >= 2, true)
  } finally {
    watcher.close()
  }
})

test('watch rebuilds when a separate component file changes', async () => {
  const project = await createProject({
    config: {
      source: 'src',
      output: 'miniprogram',
      pages: { 'pages/home/index': 'App.tsx' },
    },
    files: {
      'src/App.tsx': `import Child from './Child'
export default function App() {
  return <view><Child /></view>
}
`,
      'src/Child.tsx': `export default function Child() {
  return <view><slot /><text class="child">one</text></view>
}
`,
    },
  })
  await appShell(project)

  const watcher = await watchProject(project, {
    onError: (error) => {
      throw error
    },
  })
  try {
    const wxmlPath = path.join(project, 'miniprogram/components/glaze-child/index.wxml')
    assert.match(await readFile(wxmlPath, 'utf8'), />one</)

    await writeProjectFile(
      project,
      'src/Child.tsx',
      `export default function Child() {
  return <view><slot /><text class="child">two</text></view>
}
`,
    )

    const rebuilt = await waitUntil(async () => {
      const wxml = await readFile(wxmlPath, 'utf8').catch(() => '')
      return wxml.includes('>two<')
    })
    assert.equal(rebuilt, true)
  } finally {
    watcher.close()
  }
})

test('watch ignores output files and unrelated extensions', async () => {
  const project = await createProject({
    config: {
      source: 'src',
      output: 'miniprogram',
      pages: { 'pages/home/index': 'App.tsx' },
    },
    files: {
      'src/App.tsx': 'export default function App() { return <view>ignored</view> }\n',
    },
  })
  await appShell(project)

  let builds = 0
  const watcher = await watchProject(project, {
    onBuild: () => {
      builds += 1
    },
    onError: (error) => {
      throw error
    },
  })
  try {
    assert.equal(builds, 1)
    await Promise.all([
      writeProjectFile(project, 'src/notes.txt', 'not a source file\n'),
      writeProjectFile(project, 'miniprogram/notes.txt', 'output file\n'),
      writeProjectFile(project, 'src/fixtures/data.txt', 'nested text\n'),
    ])
    await new Promise((resolve) => setTimeout(resolve, 500))
    assert.equal(builds, 1)
  } finally {
    watcher.close()
  }
})

test('watch coalesces rapid edits into one rebuild', async () => {
  const project = await createProject({
    config: {
      source: 'src',
      output: 'miniprogram',
      pages: { 'pages/home/index': 'App.tsx' },
    },
    files: {
      'src/App.tsx': `import Child from './Child'
export default function App() {
  return <view><Child /></view>
}
`,
      'src/Child.tsx': `export default function Child() {
  return <text class="child">one</text>
}
`,
    },
  })
  await appShell(project)

  let builds = 0
  const watcher = await watchProject(project, {
    onBuild: () => {
      builds += 1
    },
    onError: (error) => {
      throw error
    },
  })
  try {
    assert.equal(builds, 1)
    await Promise.all([
      writeProjectFile(
        project,
        'src/App.tsx',
        `import Child from './Child'
export default function App() {
  return <view class="page"><Child /></view>
}
`,
      ),
      writeProjectFile(
        project,
        'src/Child.tsx',
        `export default function Child() {
  return <text class="child">two</text>
}
`,
      ),
    ])

    const rebuilt = await waitUntil(async () => {
      const wxml = await readFile(
        path.join(project, 'miniprogram/components/glaze-app/index.wxml'),
        'utf8',
      ).catch(() => '')
      return wxml.includes('>two<') && wxml.includes('class="page"')
    })
    assert.equal(rebuilt, true)
    await new Promise((resolve) => setTimeout(resolve, 400))
    assert.equal(builds, 2)
  } finally {
    watcher.close()
  }
})

// ---------------------------------------------------------------------------
// Snippet
// ---------------------------------------------------------------------------

test('parses static snippet config values of every literal kind', () => {
  const parsed = parseSnippetSource(`export const glaze = {
  project: { appid: 'wx1', setting: { minified: true } },
  app: { window: { navigationBarTitleText: \`Demo\` } },
  page: { route: 'pages/demo/index', config: { list: [-1, null, true, 'x'] } },
} satisfies { page?: unknown }
export default function Page() {
  return <view>demo</view>
}
`)

  assert.deepEqual(parsed.config.project, {
    appid: 'wx1',
    setting: { minified: true },
  })
  assert.deepEqual(parsed.config.app, {
    window: { navigationBarTitleText: 'Demo' },
  })
  assert.deepEqual(parsed.config.page?.config, { list: [-1, null, true, 'x'] })
  assert.doesNotMatch(parsed.code, /export const glaze/)
  assert.match(parsed.code, /export default function Page/)
})

test('rejects snippet routes that escape the output', async () => {
  const project = await mkdtemp(path.join(tmpdir(), 'glaze-edge-snippet-'))
  const write = async (name, route) => {
    const file = path.join(project, name)
    await writeFile(
      file,
      `export const glaze = { page: { route: ${JSON.stringify(route)} } }
export default function Page() { return <view /> }
`,
    )
    return file
  }

  const escape = await write('Escape.tsx', '../escape')
  await assert.rejects(
    () => buildSnippet(escape, { out: path.join(project, 'a') }),
    /Invalid snippet page\.route/,
  )
  const nested = await write('Nested.tsx', 'pages/../escape')
  await assert.rejects(
    () => buildSnippet(nested, { out: path.join(project, 'b') }),
    /Invalid snippet page\.route/,
  )
  const blank = await write('Blank.tsx', '   ')
  await assert.rejects(
    () => buildSnippet(blank, { out: path.join(project, 'c') }),
    /Snippet page\.route must be a non-empty string/,
  )
})

test('force replaces an existing snippet output', async () => {
  const project = await mkdtemp(path.join(tmpdir(), 'glaze-edge-snippet-'))
  const source = path.join(project, 'Page.tsx')
  const out = path.join(project, 'out')
  await writeFile(
    source,
    `export const glaze = { page: { route: 'pages/index/index' } }
export default function Page() { return <view>demo</view> }
`,
  )
  await buildSnippet(source, { out })
  await writeFile(path.join(out, 'stale.txt'), 'stale\n')

  const result = await buildSnippet(source, { out, force: true })
  assert.equal(result.outDir, out)
  await assert.rejects(() => access(path.join(out, 'stale.txt')))
  assert.equal(await exists(path.join(out, 'project.config.json')), true)
})

test('rejects a snippet output that contains the source file', async () => {
  const project = await mkdtemp(path.join(tmpdir(), 'glaze-edge-snippet-'))
  const source = path.join(project, 'Page.tsx')
  await writeFile(
    source,
    `export const glaze = { page: { route: 'pages/index/index' } }
export default function Page() { return <view /> }
`,
  )
  await assert.rejects(
    () => buildSnippet(source, { out: project }),
    /Snippet output must not contain the source file/,
  )
})

test('rejects a snippet source that is not TSX', async () => {
  const project = await mkdtemp(path.join(tmpdir(), 'glaze-edge-snippet-'))
  const source = path.join(project, 'Page.tsx')
  const script = path.join(project, 'Page.js')
  await writeFile(script, 'export const glaze = {}\n')
  await assert.rejects(
    () => buildSnippet(script, { out: path.join(project, 'out') }),
    /Snippet source must be a \.tsx file/,
  )
  assert.equal(source.endsWith('.tsx'), true)
})

test('rejects a glaze export with extra declarators', () => {
  assert.throws(
    () =>
      parseSnippetSource(`export const glaze = { page: { route: 'pages/index/index' } }, other = 1
export default function Page() { return <view /> }
`),
    /`glaze` must be the only declaration in its export/,
  )
})

test('writes default project files for a snippet build', async () => {
  const project = await mkdtemp(path.join(tmpdir(), 'glaze-edge-snippet-'))
  const source = path.join(project, 'HelloWorld.tsx')
  const out = path.join(project, 'out')
  await writeFile(
    source,
    `export const glaze = { page: { route: 'pages/index/index' } }
export default function Page() { return <view>hello</view> }
`,
  )

  await buildSnippet(source, { out })

  const projectConfig = await readJson(path.join(out, 'project.config.json'))
  assert.equal(projectConfig.appid, 'touristappid')
  assert.equal(projectConfig.projectname, 'hello-world-snippet')
  assert.equal(projectConfig.miniprogramRoot, 'miniprogram/')
  assert.deepEqual(projectConfig.setting, { es6: false, minified: false })

  const miniprogram = path.join(out, 'miniprogram')
  assert.equal(await exists(path.join(miniprogram, 'app.js')), true)
  assert.equal(await exists(path.join(miniprogram, 'app.wxss')), true)
  assert.equal(await exists(path.join(miniprogram, 'pages/index/index.wxml')), true)
  assert.equal(await exists(path.join(miniprogram, 'components/glaze-page/index.wxml')), true)
})

test('derives the default snippet output directory from the file name', () => {
  assert.equal(
    defaultSnippetOut('/tmp/FooBar.tsx'),
    path.resolve(process.cwd(), 'foo-bar-snippet'),
  )
  assert.equal(
    defaultSnippetOut('/tmp/hello/HelloWorld.tsx'),
    path.resolve(process.cwd(), 'hello-world-snippet'),
  )
})
