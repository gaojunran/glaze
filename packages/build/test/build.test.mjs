import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { buildProject } from '../src/build.mjs'

test('builds a page, its inlined child and a page wrapper', async () => {
  const project = await mkdtemp(path.join(tmpdir(), 'glaze-build-'))
  const src = path.join(project, 'src')
  await mkdir(src, { recursive: true })

  await writeFile(
    path.join(project, 'glaze.config.mjs'),
    `export default {
      source: 'src',
      output: 'miniprogram',
      pages: { 'pages/home/index': 'App.tsx' },
    }\n`,
  )
  await writeFile(
    path.join(src, 'app.json'),
    JSON.stringify({ componentFramework: 'glass-easel', window: {} }),
  )
  await writeFile(
    path.join(src, 'App.tsx'),
    `import Child from './Child'

export default function App() {
  return <view class="page"><Child title="Hello" /></view>
}
`,
  )
  await writeFile(
    path.join(src, 'Child.tsx'),
    `export default function Child(props) {
  return <text class="title">{props.title}</text>
}
`,
  )

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

  const appJson = JSON.parse(
    await readFile(path.join(project, 'miniprogram/app.json'), 'utf8'),
  )
  assert.deepEqual(appJson.pages, ['pages/home/index'])
})
