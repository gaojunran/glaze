import { build as esbuild } from 'esbuild'
import { existsSync } from 'node:fs'
import { copyFile, cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { compileComponent } from '@glaze/compiler'

const repoRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)))
const packageRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))

const DEFAULT_CONFIG = {
  source: 'src',
  output: 'miniprogram',
  pages: {},
  staticPages: [],
}

const kebabCase = (value) =>
  value
    .replace(/\//g, '-')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()

async function loadConfig(projectPath) {
  const configFile = path.join(projectPath, 'glaze.config.mjs')
  if (!existsSync(configFile)) return DEFAULT_CONFIG
  const loaded = await import(pathToFileURL(configFile).href)
  return { ...DEFAULT_CONFIG, ...(loaded.default ?? loaded) }
}

async function collectTsx(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...(await collectTsx(full)))
    else if (entry.name.endsWith('.tsx')) files.push(full)
  }
  return files.sort()
}

function outputNameFor(sourceFile, sourceDir) {
  const relative = path.relative(sourceDir, sourceFile).replace(/\.tsx$/, '')
  return `glaze-${kebabCase(relative)}`
}

function resolveSourceImport(fromFile, specifier, sources) {
  if (!specifier.startsWith('.')) return null
  const base = path.resolve(path.dirname(fromFile), specifier)
  for (const candidate of [
    base,
    `${base}.tsx`,
    `${base}.ts`,
    path.join(base, 'index.tsx'),
    path.join(base, 'index.ts'),
  ]) {
    if (sources.has(candidate)) return candidate
  }
  return null
}

function styleFor(sourceFile) {
  return path.join(
    path.dirname(sourceFile),
    `${path.basename(sourceFile, '.tsx')}.wxss`,
  )
}

/**
 * Build a mini-program project from a Glaze config.
 *
 * The output is a normal mini-program directory: pages are thin wrappers over
 * compiled page components, and every reached component is emitted with its
 * WXML, JS, JSON and WXSS.
 */
export async function buildProject(projectPath = process.cwd()) {
  const project = path.resolve(projectPath)
  const config = await loadConfig(project)
  const sourceDir = path.join(project, config.source)
  const outputDir = path.join(project, config.output)
  const tempDir = path.join(project, '.tmp/glaze-build')

  if (config.clean !== false) await rm(outputDir, { recursive: true, force: true })
  await mkdir(outputDir, { recursive: true })

  for (const name of ['app.js', 'app.wxss']) {
    const from = path.join(sourceDir, name)
    if (existsSync(from)) await copyFile(from, path.join(outputDir, name))
  }
  for (const dir of config.static ?? []) {
    const from = path.join(sourceDir, dir)
    if (!existsSync(from)) continue
    for (const entry of await readdir(from, { withFileTypes: true })) {
      await cp(path.join(from, entry.name), path.join(outputDir, entry.name), {
        recursive: true,
      })
    }
  }

  const sourceFiles = await collectTsx(sourceDir)
  const sources = new Map()
  for (const file of sourceFiles) sources.set(file, await readFile(file, 'utf8'))

  const pages = new Map()
  for (const [route, relative] of Object.entries(config.pages)) {
    const file = path.resolve(sourceDir, relative)
    if (!sources.has(file)) throw new Error(`Page source not found: ${relative}`)
    pages.set(route.replace(/^\//, '').replace(/\.(tsx|wxml)$/, ''), file)
  }
  if (pages.size === 0) throw new Error('glaze.config.mjs does not declare any pages')

  const compiled = new Map()
  for (const file of sourceFiles) {
    compiled.set(file, {
      result: compileComponent(sources.get(file), {
        inline: true,
        resolveComponent: (name, specifier) => {
          const child = resolveSourceImport(file, specifier, sources)
          return child ? sources.get(child) : null
        },
      }),
    })
  }

  const used = new Set(pages.values())
  const queue = [...used]
  while (queue.length > 0) {
    const file = queue.pop()
    const entry = compiled.get(file)
    for (const component of entry.result.components) {
      const child = resolveSourceImport(file, component.source, sources)
      if (!child) {
        throw new Error(`Cannot resolve component "${component.name}" from ${file}`)
      }
      if (!used.has(child)) {
        used.add(child)
        queue.push(child)
      }
    }
  }

  const names = new Map()
  for (const file of used) names.set(file, outputNameFor(file, sourceDir))

  const componentsDir = path.join(outputDir, 'components')
  await mkdir(componentsDir, { recursive: true })
  for (const entry of await readdir(componentsDir, { withFileTypes: true })) {
    if (entry.name.startsWith('glaze-')) {
      await rm(path.join(componentsDir, entry.name), { recursive: true, force: true })
    }
  }
  await mkdir(tempDir, { recursive: true })

  for (const file of used) {
    const { result } = compiled.get(file)
    const outName = names.get(file)
    const outDir = path.join(componentsDir, outName)
    await mkdir(outDir, { recursive: true })

    const generatedFile = path.join(tempDir, `${outName}.tsx`)
    await writeFile(generatedFile, result.js)
    await writeFile(path.join(outDir, 'index.wxml'), result.wxml)

    const usingComponents = {}
    for (const component of result.components) {
      const tag = kebabCase(component.name)
      if (usingComponents[tag]) {
        throw new Error(`Duplicate component tag "${tag}" in ${file}`)
      }
      const child = resolveSourceImport(file, component.source, sources)
      usingComponents[tag] = `/components/${names.get(child)}/index`
    }
    await writeFile(
      path.join(outDir, 'index.json'),
      `${JSON.stringify({ component: true, usingComponents }, null, 2)}\n`,
    )

    const inlineStyles = []
    for (const inline of result.inlineComponents) {
      const child = resolveSourceImport(file, inline.source, sources)
      const childStyle = styleFor(child)
      if (existsSync(childStyle)) inlineStyles.push(await readFile(childStyle, 'utf8'))
    }
    const ownStyle = styleFor(file)
    await writeFile(
      path.join(outDir, 'index.wxss'),
      [
        await readFile(ownStyle, 'utf8').catch(() => ''),
        ...inlineStyles,
      ].join('\n'),
    )

    await esbuild({
      entryPoints: [generatedFile],
      bundle: true,
      format: 'cjs',
      platform: 'browser',
      conditions: ['browser'],
      target: 'es2020',
      outfile: path.join(outDir, 'index.js'),
      nodePaths: [
        path.join(project, 'node_modules'),
        path.join(packageRoot, 'node_modules'),
        path.join(repoRoot, 'node_modules'),
      ],
      loader: { '.tsx': 'tsx', '.ts': 'ts' },
      logLevel: 'warning',
    })
  }

  for (const [route, file] of pages) {
    const outName = names.get(file)
    const pageDir = path.join(outputDir, path.dirname(route))
    const pageName = path.basename(route)
    await mkdir(pageDir, { recursive: true })
    await writeFile(
      path.join(pageDir, `${pageName}.js`),
      `Page({\n  data: {},\n})\n`,
    )
    await writeFile(
      path.join(pageDir, `${pageName}.json`),
      `${JSON.stringify(
        {
          usingComponents: {
            'glaze-page': `/components/${outName}/index`,
          },
        },
        null,
        2,
      )}\n`,
    )
    await writeFile(
      path.join(pageDir, `${pageName}.wxml`),
      '<glaze-page id="app" />\n',
    )
    await writeFile(path.join(pageDir, `${pageName}.wxss`), '')
  }

  const appJsonSource = path.join(sourceDir, 'app.json')
  const appJsonFile = path.join(outputDir, 'app.json')
  const appJson = existsSync(appJsonSource)
    ? JSON.parse(await readFile(appJsonSource, 'utf8'))
    : { componentFramework: 'glass-easel', window: { glassEaselWebview: true } }
  appJson.pages = [...pages.keys(), ...config.staticPages]
  await writeFile(appJsonFile, `${JSON.stringify(appJson, null, 2)}\n`)

  return {
    outputDir,
    pages: [...pages.keys()],
    components: [...used].map((file) => names.get(file)),
  }
}
