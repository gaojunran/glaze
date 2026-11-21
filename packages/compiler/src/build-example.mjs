import { build } from 'esbuild'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileComponent } from './index.mjs'

const root = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)))
const example = path.join(root, 'examples/solid-todo')
const sourceDir = path.join(example, 'src')
const tempDir = path.join(root, '.tmp/glaze')

const kebabCase = (name) =>
  name
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()

async function collectSources(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...(await collectSources(full)))
    else if (entry.name.endsWith('.tsx')) files.push(full)
  }
  return files
}

function outputName(sourceFile) {
  return `glaze-${kebabCase(path.basename(sourceFile, '.tsx'))}`
}

function resolveComponent(fromFile, specifier) {
  const base = path.resolve(path.dirname(fromFile), specifier)
  for (const candidate of [base, `${base}.tsx`, `${base}.ts`, path.join(base, 'index.tsx')]) {
    if (existsSync(candidate)) return candidate
  }
  throw new Error(`Cannot resolve component "${specifier}" from ${fromFile}`)
}

await mkdir(tempDir, { recursive: true })

const sourceFiles = await collectSources(sourceDir)
const sources = new Map()
const compiled = new Map()

for (const sourceFile of sourceFiles) {
  sources.set(sourceFile, await readFile(sourceFile, 'utf8'))
}

for (const sourceFile of sourceFiles) {
  const source = sources.get(sourceFile)
  compiled.set(sourceFile, {
    sourceFile,
    result: compileComponent(source, {
      inline: true,
      resolveComponent: (name, specifier) => {
        const childFile = resolveComponent(sourceFile, specifier)
        return sources.get(childFile) ?? null
      },
    }),
    outName: outputName(sourceFile),
  })
}

for (const { sourceFile, result, outName } of compiled.values()) {
  const outDir = path.join(example, 'miniprogram/components', outName)
  await mkdir(outDir, { recursive: true })

  const generatedFile = path.join(tempDir, `${outName}.tsx`)
  await writeFile(generatedFile, result.js)
  await writeFile(path.join(outDir, 'index.wxml'), result.wxml)

  const usingComponents = {}
  for (const component of result.components) {
    const tag = kebabCase(component.name)
    if (usingComponents[tag]) {
      throw new Error(`Duplicate component tag "${tag}" in ${sourceFile}`)
    }
    const childFile = resolveComponent(sourceFile, component.source)
    const child = compiled.get(childFile)
    if (!child) throw new Error(`Component source is not compiled: ${childFile}`)
    usingComponents[tag] = `/components/${child.outName}/index`
  }
  await writeFile(
    path.join(outDir, 'index.json'),
    `${JSON.stringify({ component: true, usingComponents }, null, 2)}\n`,
  )

  const styleFile = path.join(
    path.dirname(sourceFile),
    `${path.basename(sourceFile, '.tsx')}.wxss`,
  )
  const inlineStyles = []
  for (const inline of result.inlineComponents) {
    const childFile = resolveComponent(sourceFile, inline.source)
    const childStyle = path.join(
      path.dirname(childFile),
      `${path.basename(childFile, '.tsx')}.wxss`,
    )
    if (existsSync(childStyle)) inlineStyles.push(await readFile(childStyle, 'utf8'))
  }
  await writeFile(
    path.join(outDir, 'index.wxss'),
    [await readFile(styleFile, 'utf8').catch(() => ''), ...inlineStyles].join('\n'),
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
    `compiled ${path.relative(example, sourceFile)} -> ${outName} ` +
      `(props: ${result.props.length}, bindings: ${result.bindingCount}, handlers: ${result.handlerCount})`,
  )
}
