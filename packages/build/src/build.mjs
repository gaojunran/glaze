import { build as esbuild } from 'esbuild'
import { existsSync, watch } from 'node:fs'
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
import { fileURLToPath, pathToFileURL } from 'node:url'
import { compileComponent } from '@glaze/compiler'

const repoRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)))
const packageRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))

// esbuild in this workspace predates/dropped the `dedupe` option, so force the
// builder's own solid-js copy during resolution instead.
const dedupeSolidPlugin = {
  name: 'glaze-dedupe-solid',
  setup(context) {
    context.onResolve({ filter: /^solid-js(\/|$)/ }, async (args) => {
      if (args.pluginData?.glazeDedupe) return
      const resolved = await context.resolve(args.path, {
        kind: args.kind,
        resolveDir: path.join(packageRoot, 'node_modules'),
        pluginData: { glazeDedupe: true },
      })
      if (resolved.errors.length > 0) return
      return resolved
    })
  },
}

const SHARED_SPECIFIERS = new Set([
  'solid-js',
  'solid-js/store',
  '@glaze/runtime',
  '@glaze/runtime/mini',
])
const SHARED_SPECIFIER_RE = /^(@glaze\/runtime(?:\/mini)?|solid-js(?:\/store)?)$/
const SHARED_MODULE = 'glaze-runtime/index.js'

/** Compute the literal require() path a component uses to reach the shared runtime. */
const sharedSpecifierFor = (fromDir, sharedPath) => {
  const relative = normalizeSourcePath(path.relative(fromDir, sharedPath))
  return relative.startsWith('.') ? relative : `./${relative}`
}

const sharedRuntimePlugin = (specifier) => ({
  name: 'glaze-shared-runtime',
  setup(context) {
    context.onResolve({ filter: SHARED_SPECIFIER_RE }, (args) => {
      if (!SHARED_SPECIFIERS.has(args.path)) return
      return { path: specifier, external: true }
    })
  },
})

/**
 * Collect named imports from Glaze's shared specifiers.
 *
 * The shared module must re-export every name a generated bundle imports. A
 * namespace or default import cannot be enumerated statically, so reject it
 * instead of silently shipping an incomplete shim.
 */
const collectSharedImports = (sources) => {
  const groups = new Map()
  const importPattern = /import\s+([\s\S]*?)\s+from\s+["']([^"']+)["']/g
  for (const source of sources) {
    let match
    while ((match = importPattern.exec(source))) {
      const specifier = match[2]
      if (!SHARED_SPECIFIERS.has(specifier)) continue
      let clause = match[1].trim().replace(/^type\s+/, '')
      if (!clause.startsWith('{')) {
        throw new Error(
          `Shared import from "${specifier}" must use named imports, got "${clause}"`,
        )
      }
      const names = groups.get(specifier) ?? new Set()
      for (const entry of clause.slice(1, -1).split(',')) {
        const imported = entry
          .trim()
          .replace(/^type\s+/, '')
          .split(/\s+as\s+/)[0]
        if (!imported || imported === 'default') continue
        names.add(imported)
      }
      groups.set(specifier, names)
    }
  }
  return groups
}

const buildSharedModule = (groups, outfile) =>
  esbuild({
    stdin: {
      contents: [...groups]
        .map(([specifier, names]) => {
          const list = [...names].sort().join(', ')
          return list
            ? `export { ${list} } from ${JSON.stringify(specifier)};`
            : `import ${JSON.stringify(specifier)};`
        })
        .join('\n'),
      resolveDir: packageRoot,
      sourcefile: 'glaze-runtime.ts',
      loader: 'ts',
    },
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    conditions: ['browser'],
    target: 'es2020',
    outfile,
    nodePaths: [
      path.join(packageRoot, 'node_modules'),
      path.join(repoRoot, 'node_modules'),
    ],
    plugins: [dedupeSolidPlugin],
    minify: true,
    logLevel: 'warning',
  })

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

/** Normalize a route the way app.json expects it. */
const normalizeRoute = (route) =>
  route.replace(/^\//, '').replace(/\.(tsx|wxml)$/, '')

/**
 * Normalize a path relative to the source root.
 *
 * `path.relative` uses the platform separator, so Windows produces
 * `pages\\FooBar.tsx`. Output names must not depend on the host platform.
 */
export const normalizeSourcePath = (value) =>
  value.split(path.sep).join('/').replace(/\\/g, '/')

/** Pure output-name helper, exported so tests can inject Windows separators. */
export const outputNameForRelative = (relative) =>
  `glaze-${kebabCase(normalizeSourcePath(relative).replace(/\.tsx$/, ''))}`

function outputNameFor(sourceFile, sourceDir) {
  return outputNameForRelative(path.relative(sourceDir, sourceFile))
}

const escapes = (relative) =>
  relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)

const isInside = (parent, child) => {
  const relative = path.relative(parent, child)
  return relative !== '' && !escapes(relative)
}

/** Require target to be a strict subdirectory of project. */
function assertProjectSubdirectory(project, target, label) {
  const relative = path.relative(project, target)
  if (relative === '' || escapes(relative)) {
    throw new Error(`${label} must be a subdirectory of the project: ${target}`)
  }
}

function validateProjectPaths(project, sourceDir, outputDir, stagingBase) {
  assertProjectSubdirectory(project, sourceDir, 'Config "source"')
  assertProjectSubdirectory(project, outputDir, 'Config "output"')
  if (path.resolve(sourceDir) === path.resolve(outputDir)) {
    throw new Error('Config "output" must not be the same directory as "source"')
  }
  if (isInside(sourceDir, outputDir)) {
    throw new Error('Config "output" must not be inside "source"')
  }
  if (isInside(outputDir, sourceDir)) {
    throw new Error('Config "source" must not be inside "output"')
  }
  if (
    path.resolve(outputDir) === path.resolve(stagingBase) ||
    isInside(outputDir, stagingBase)
  ) {
    throw new Error(
      'Config "output" must not contain the build staging directory (.tmp/glaze-build)',
    )
  }
}

let configImportCounter = 0

async function loadConfig(projectPath) {
  const configFile = path.join(projectPath, 'glaze.config.mjs')
  if (!existsSync(configFile)) return DEFAULT_CONFIG
  // ESM module records are cached forever, so a plain import() would keep the
  // first config during `glaze watch`. Bust the cache on every load.
  const url = pathToFileURL(configFile)
  url.searchParams.set('v', `${Date.now()}-${++configImportCounter}`)
  const loaded = await import(url.href)
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
 * Reject WXSS a copied component cannot portably use.
 *
 * Component WXSS is written next to the generated component, so a relative
 * `@import` or `url()` would resolve against a different directory and break.
 */
function assertPortableWxss(file, content) {
  if (/@import\s+[^;]+;/.test(content)) {
    throw new Error(
      `WXSS @import is not supported because styles are copied into generated components: ${file}`,
    )
  }
  const urlPattern = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi
  for (const match of content.matchAll(urlPattern)) {
    const value = match[2].trim()
    if (
      value === '' ||
      value.startsWith('#') ||
      /^(data:|https?:|\/\/|\/)/i.test(value)
    ) {
      continue
    }
    throw new Error(
      `WXSS url() must be absolute, remote, or a data URL because styles are copied into generated components: ${file} (${value})`,
    )
  }
}

async function replaceOutput(stagingDir, outputDir, clean) {
  if (clean) {
    await rm(outputDir, { recursive: true, force: true })
    await mkdir(path.dirname(outputDir), { recursive: true })
    await rename(stagingDir, outputDir)
    return
  }
  await cp(stagingDir, outputDir, { recursive: true, force: true })
  await rm(stagingDir, { recursive: true, force: true })
}

/**
 * Rebuild a project when source files change.
 *
 * This is a development helper, not an incremental compiler: each rebuild
 * runs the same full pipeline as `glaze build`. Changes are debounced and
 * serialized so a slow esbuild pass cannot overlap the next one. Config
 * changes are picked up because every build reloads the config with a
 * cache-busting query; watcher targets are refreshed when the config moves
 * `source`.
 */
export async function watchProject(projectPath = process.cwd(), options = {}) {
  const project = path.resolve(projectPath)
  let currentConfig = await loadConfig(project)

  const watchers = new Map()
  let timer = null
  let building = false
  let pending = false
  let closed = false

  const isIgnored = (name) => {
    if (name.includes('.tmp')) return true
    if (currentConfig.output && name.includes(currentConfig.output)) return true
    return !/\.(tsx?|jsx?|mjs|json|wxml|wxss)$/.test(name)
  }

  const schedule = () => {
    if (closed) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      run()
    }, 100)
  }

  const syncWatchers = (config) => {
    currentConfig = config
    const desired = new Set()
    const sourceDir = path.join(project, config.source)
    desired.add(existsSync(sourceDir) ? sourceDir : project)
    const configFile = path.join(project, 'glaze.config.mjs')
    if (existsSync(configFile)) desired.add(configFile)

    for (const [target, watcher] of watchers) {
      if (!desired.has(target)) {
        watcher.close()
        watchers.delete(target)
      }
    }
    for (const target of desired) {
      if (watchers.has(target)) continue
      try {
        watchers.set(
          target,
          watch(target, { recursive: true }, (_event, filename) => {
            if (!filename) {
              schedule()
              return
            }
            if (isIgnored(filename.toString())) return
            schedule()
          }),
        )
      } catch {
        // The target may not exist yet; the next build retries.
      }
    }
  }

  const run = async () => {
    if (closed) return
    if (building) {
      pending = true
      return
    }
    building = true
    try {
      const result = await buildProject(project)
      syncWatchers(result.config)
      options.onBuild?.(result)
    } catch (error) {
      try {
        syncWatchers(await loadConfig(project))
      } catch {
        // Keep the previous watchers if the new config cannot be loaded.
      }
      options.onError?.(error)
    } finally {
      building = false
      if (pending) {
        pending = false
        run()
      }
    }
  }

  await run()

  return {
    close() {
      closed = true
      if (timer) clearTimeout(timer)
      for (const watcher of watchers.values()) watcher.close()
    },
  }
}

/**
 * Build a mini-program project from a Glaze config.
 *
 * The output is a normal mini-program directory: pages are thin wrappers over
 * compiled page components, and every reached component is emitted with its
 * WXML, JS, JSON and WXSS.
 *
 * Validation happens before anything is written. The build is staged in
 * `.tmp/glaze-build` and only replaces `output` after it succeeds, so a
 * failing build leaves the previous output intact.
 */
export async function buildProject(projectPath = process.cwd()) {
  const project = path.resolve(projectPath)
  const config = await loadConfig(project)
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
    const sharedInputs = new Set()
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
      const componentJson = {
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
