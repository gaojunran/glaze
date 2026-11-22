import { compileComponent } from '@glaze/compiler'
import { build as esbuild } from 'esbuild'
import { existsSync } from 'node:fs'
import {
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import { loadConfig, collectTsx, resolveSourceImport, styleFor } from './config.ts'
import {
  kebabCase,
  normalizeRoute,
  normalizeSourcePath,
  outputNameFor,
  validateProjectPaths,
} from './paths.ts'
import {
  SHARED_MODULE,
  buildSharedModule,
  collectSharedImports,
  dedupeSolidPlugin,
  packageRoot,
  repoRoot,
  sharedRuntimePlugin,
  sharedSpecifierFor,
} from './shared.ts'
import { assertPortableWxss } from './styles.ts'
export { normalizeSourcePath, outputNameForRelative } from './paths.ts'

async function replaceOutput(stagingDir: string, outputDir: string, clean: boolean) {
  if (clean) {
    await rm(outputDir, { recursive: true, force: true })
    await mkdir(path.dirname(outputDir), { recursive: true })
    await rename(stagingDir, outputDir)
    return
  }
  await cp(stagingDir, outputDir, { recursive: true, force: true })
  await rm(stagingDir, { recursive: true, force: true })
}

export async function buildProject(projectPath = process.cwd()) {
  const project = path.resolve(projectPath)
  const config = await loadConfig(project)
  if (
    config.bindingGroupSize !== undefined &&
    (!Number.isInteger(config.bindingGroupSize) || config.bindingGroupSize <= 0)
  ) {
    throw new Error('Config "bindingGroupSize" must be a positive integer')
  }
  const sourceDir = path.resolve(project, config.source)
  const outputDir = path.resolve(project, config.output)
  const stagingBase = path.join(project, '.tmp', 'glaze-build')

  validateProjectPaths(project, sourceDir, outputDir, stagingBase)

  const sourceStat = await stat(sourceDir).catch(() => null)
  if (!sourceStat?.isDirectory()) {
    throw new Error(`Config "source" directory not found: ${config.source}`)
  }

  const sourceFiles = await collectTsx(sourceDir)
  const sources = new Map()
  for (const file of sourceFiles) sources.set(file, await readFile(file, 'utf8'))

  const pages = new Map()
  for (const [route, relative] of Object.entries(config.pages ?? {})) {
    const file = path.resolve(sourceDir, relative)
    if (!sources.has(file)) throw new Error(`Page source not found: ${relative}`)
    const normalized = normalizeRoute(route)
    if (pages.has(normalized)) {
      throw new Error(`Duplicate page route: ${normalized}`)
    }
    pages.set(normalized, file)
  }
  if (pages.size === 0) throw new Error('glaze.config.mjs does not declare any pages')

  const compiled = new Map()
  const compileFile = (file) => {
    const existing = compiled.get(file)
    if (existing) return existing
    const entry = {
      result: compileComponent(sources.get(file), {
        inline: true,
        sourceFile: file,
        bindingGroupSize: config.bindingGroupSize,
        resolveComponent: (_name, specifier, fromFile = file) => {
          const child = resolveSourceImport(fromFile, specifier, sources)
          return child ? { source: sources.get(child), file: child } : null
        },
      }),
    }
    compiled.set(file, entry)
    return entry
  }

  // Compile pages first, then only the components they actually reach.
  // Unreachable TSX files are never parsed, so a stray file cannot fail a
  // build that does not use it.
  const used = new Set(pages.values())
  const queue = [...used]
  while (queue.length > 0) {
    const file = queue.pop()
    const entry = compileFile(file)
    for (const component of entry.result.components) {
      const fromFile = component.fromFile ?? file
      const child = resolveSourceImport(fromFile, component.source, sources)
      if (!child) {
        throw new Error(`Cannot resolve component "${component.name}" from ${fromFile}`)
      }
      if (!used.has(child)) {
        used.add(child)
        queue.push(child)
      }
    }
  }

  const names = new Map()
  const owners = new Map()
  for (const file of [...used].sort()) {
    const name = outputNameFor(file, sourceDir)
    const previous = owners.get(name)
    if (previous) {
      throw new Error(
        `Output name collision "${name}": ${previous} and ${file} map to the same component`,
      )
    }
    owners.set(name, file)
    names.set(file, name)
  }

  const staticRoutes = new Set(
    (config.staticPages ?? []).map((route) => normalizeRoute(route)),
  )

  const missingAppFiles = ['app.js', 'app.wxss'].filter(
    (name) => !existsSync(path.join(sourceDir, name)),
  )
  for (const name of missingAppFiles) {
    console.warn(
      `glaze build: ${name} is missing from ${sourceDir}; the mini-program may not start`,
    )
  }

  await mkdir(stagingBase, { recursive: true })
  const stagingDir = await mkdtemp(path.join(stagingBase, 'out-'))

  try {
    for (const name of ['app.js', 'app.wxss']) {
      const from = path.join(sourceDir, name)
      if (existsSync(from)) await copyFile(from, path.join(stagingDir, name))
    }
    for (const dir of config.static ?? []) {
      const from = path.join(sourceDir, dir)
      if (!existsSync(from)) continue
      for (const entry of await readdir(from, { withFileTypes: true })) {
        await cp(path.join(from, entry.name), path.join(stagingDir, entry.name), {
          recursive: true,
        })
      }
    }

    const styleCache = new Map()
    const readStyle = async (file) => {
      if (styleCache.has(file)) return styleCache.get(file)
      let content = ''
      try {
        content = await readFile(file, 'utf8')
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
      if (content) assertPortableWxss(file, content)
      styleCache.set(file, content)
      return content
    }

    const componentsDir = path.join(stagingDir, 'components')
    await mkdir(componentsDir, { recursive: true })
    const sharedPath = path.join(stagingDir, SHARED_MODULE)
    if (existsSync(sharedPath) || existsSync(path.dirname(sharedPath))) {
      throw new Error(
        `Output file collision: ${SHARED_MODULE} already exists in the staged output`,
      )
    }

    const componentJs = new Map()
    const sharedInputs = new Set<string>()
    for (const file of used) {
      const { result } = compiled.get(file)
      const outName = names.get(file)
      const outDir = path.join(componentsDir, outName)
      await mkdir(outDir, { recursive: true })

      await writeFile(path.join(outDir, 'index.wxml'), result.wxml)

      const usingComponents = {}
      for (const component of result.components) {
        const tag = kebabCase(component.name)
        if (usingComponents[tag]) {
          throw new Error(`Duplicate component tag "${tag}" in ${file}`)
        }
        const child = resolveSourceImport(
          component.fromFile ?? file,
          component.source,
          sources,
        )
        usingComponents[tag] = `/components/${names.get(child)}/index`
      }
      const componentJson: Record<string, unknown> = {
        component: true,
        styleIsolation: 'apply-shared',
        usingComponents,
      }
      if (result.namedSlots.length > 0) {
        componentJson.options = { multipleSlots: true }
      }
      await writeFile(
        path.join(outDir, 'index.json'),
        `${JSON.stringify(componentJson, null, 2)}\n`,
      )

      const inlineStyles = []
      for (const inline of result.inlineComponents) {
        const child = inline.file ?? resolveSourceImport(file, inline.source, sources)
        inlineStyles.push(await readStyle(styleFor(child)))
      }
      await writeFile(
        path.join(outDir, 'index.wxss'),
        [await readStyle(styleFor(file)), ...inlineStyles].join('\n'),
      )

      const bundle = await esbuild({
        stdin: {
          contents: result.js,
          resolveDir: path.dirname(file),
          sourcefile: `${outName}.tsx`,
          loader: 'tsx',
        },
        bundle: true,
        format: 'cjs',
        platform: 'browser',
        conditions: ['browser'],
        target: 'es2020',
        write: false,
        metafile: true,
        nodePaths: [
          path.join(project, 'node_modules'),
          path.join(packageRoot, 'node_modules'),
          path.join(repoRoot, 'node_modules'),
        ],
        loader: { '.tsx': 'tsx', '.ts': 'ts' },
        plugins: [
          sharedRuntimePlugin(sharedSpecifierFor(outDir, sharedPath)),
          dedupeSolidPlugin,
        ],
        minify: true,
        logLevel: 'warning',
      })
      componentJs.set(file, bundle.outputFiles[0].text)
      for (const input of Object.keys(bundle.metafile.inputs)) {
        if (input !== '<stdin>') sharedInputs.add(input)
      }
    }

    const sharedTexts = [...used].map((file) => compiled.get(file).result.js)
    for (const input of sharedInputs) {
      try {
        sharedTexts.push(await readFile(input, 'utf8'))
      } catch {
        // A virtual or generated input is already represented by result.js.
      }
    }
    const sharedImports = collectSharedImports(sharedTexts)
    if (sharedImports.size > 0) {
      await mkdir(path.dirname(sharedPath), { recursive: true })
      await buildSharedModule(sharedImports, sharedPath)
    }
    for (const [file, output] of componentJs) {
      await writeFile(path.join(componentsDir, names.get(file), 'index.js'), output)
    }

    for (const [route, file] of pages) {
      if (staticRoutes.has(route)) continue
      const outName = names.get(file)
      const pageDir = path.join(stagingDir, path.dirname(route))
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
    const appJsonFile = path.join(stagingDir, 'app.json')
    const appJson = existsSync(appJsonSource)
      ? JSON.parse(await readFile(appJsonSource, 'utf8'))
      : { componentFramework: 'glass-easel', window: { glassEaselWebview: true } }
    const routeList = []
    const seenRoutes = new Set()
    for (const route of [...pages.keys(), ...(config.staticPages ?? [])]) {
      const normalized = normalizeRoute(route)
      if (seenRoutes.has(normalized)) continue
      seenRoutes.add(normalized)
      routeList.push(normalized)
    }
    appJson.pages = routeList
    await writeFile(appJsonFile, `${JSON.stringify(appJson, null, 2)}\n`)

    await replaceOutput(stagingDir, outputDir, config.clean !== false)
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true }).catch(() => {})
    throw error
  }

  return {
    outputDir,
    pages: [...pages.keys()],
    components: [...used].map((file) => names.get(file)),
    config,
  }
}
