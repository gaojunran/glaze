import { build } from 'esbuild'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileComponent } from './index.mjs'

const root = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)))
const example = path.join(root, 'examples/solid-todo')
const tempDir = path.join(root, '.tmp/glaze')

const components = [
  { name: 'Counter', source: 'src/Counter.tsx', style: 'src/Counter.wxss', out: 'glaze-counter' },
  { name: 'Bench', source: 'src/Bench.tsx', style: 'src/Bench.wxss', out: 'glaze-bench' },
]

await mkdir(tempDir, { recursive: true })

for (const component of components) {
  const sourceFile = path.join(example, component.source)
  const outDir = path.join(example, 'miniprogram/components', component.out)
  const source = await readFile(sourceFile, 'utf8')
  const result = compileComponent(source)

  await mkdir(outDir, { recursive: true })

  const generatedFile = path.join(tempDir, `${component.name}.tsx`)
  await writeFile(generatedFile, result.js)
  await writeFile(path.join(outDir, 'index.wxml'), result.wxml)
  await writeFile(path.join(outDir, 'index.json'), '{\n  "component": true\n}\n')
  await writeFile(
    path.join(outDir, 'index.wxss'),
    await readFile(path.join(example, component.style), 'utf8'),
  )

  await build({
    entryPoints: [generatedFile],
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    conditions: ['browser'],
    target: 'es2020',
    outfile: path.join(outDir, 'index.js'),
    nodePaths: [path.join(root, 'packages/compiler/node_modules')],
    loader: { '.tsx': 'tsx', '.ts': 'ts' },
    logLevel: 'warning',
  })

  console.log(
    `compiled ${component.source} -> ${component.out} (bindings: ${result.bindingCount}, handlers: ${result.handlerCount})`,
  )
}
