import { compileComponent, hasMultipleProps } from '@glaze/compiler'
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
import { loadConfig, collectTsx, resolveSourceImport } from './config.ts'
import {
  hasRouteTraversal,
  isInside,
  kebabCase,
  normalizeRoute,
  normalizeSourcePath,
  normalizeSubpackageRoot,
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
import { readAppStyle, readComponentStyle } from './preprocess.ts'
import { assertPortableWxss, rewriteWxssUrls } from './styles.ts'
import { applyTailwind, validateTailwindConfig } from './tailwind.ts'
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

const compileCache = new Map<string, { fingerprint: string; entry: any }>()
let compileCacheTag = ''
const dependencyGraph = new Map<string, Set<string>>()

const buildQueues = new Map<string, Promise<void>>()

export async function buildProject(
  projectPath = process.cwd(),
  options: { changedFiles?: string[] } = {},
) {
  const project = path.resolve(projectPath)
  const previous = buildQueues.get(project) ?? Promise.resolve()
  let release
  const gate = new Promise<void>((resolve) => (release = resolve))
  const current = previous.then(() => gate)
  buildQueues.set(project, current)
  await previous.catch(() => {})
  try {
    return await buildProjectInternal(project, options)
  } finally {
    release!()
    if (buildQueues.get(project) === current) buildQueues.delete(project)
  }
}

async function buildProjectInternal(
  projectPath = process.cwd(),
  options: { changedFiles?: string[] } = {},
) {
  const project = path.resolve(projectPath)
  const config = await loadConfig(project)
  const bindingGroupSize = config.runtime?.bindingGroupSize
  if (
    bindingGroupSize !== undefined &&
    (!Number.isInteger(bindingGroupSize) || bindingGroupSize <= 0)
  ) {
    throw new Error('Config "runtime.bindingGroupSize" must be a positive integer')
  }
  if (config.static != null && !Array.isArray(config.static)) {
    throw new Error('Config "static" must be an array')
  }
  validateTailwindConfig(project, config)
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

  const pageEntries = []
  const routes = new Set()
  const addPage = (route, relative, owner) => {
    if (hasRouteTraversal(route)) {
      throw new Error(`Invalid page route: ${route}`)
    }
    const file = path.resolve(sourceDir, relative)
    if (!sources.has(file)) throw new Error(`Page source not found: ${relative}`)
    const normalized = normalizeRoute(route)
    if (!normalized) throw new Error(`Invalid page route: ${route}`)
    if (routes.has(normalized)) throw new Error(`Duplicate page route: ${normalized}`)
    routes.add(normalized)
    pageEntries.push({ route: normalized, file, owner })
  }
  for (const [route, relative] of Object.entries(config.pages ?? {})) {
    addPage(route, relative, null)
  }
  const subpackages = (config.subpackages ?? []).map((entry) => {
    const root = normalizeSubpackageRoot(entry.root)
    if (!root) throw new Error('Config "subpackages[].root" must not be empty')
    if (path.isAbsolute(root) || root.startsWith('..') || root.split('/').includes('..')) {
      throw new Error(`Config "subpackages[].root" must be a relative package root: ${entry.root}`)
    }
    return { ...entry, root, independent: entry.independent === true }
  })
  const roots = new Set()
  for (const subpackage of subpackages) {
    if (roots.has(subpackage.root)) {
      throw new Error(`Duplicate subpackage root: ${subpackage.root}`)
    }
    roots.add(subpackage.root)
    if (Object.keys(subpackage.pages ?? {}).length === 0) {
      throw new Error(`Subpackage "${subpackage.root}" does not declare any pages`)
    }
    for (const [route, relative] of Object.entries(subpackage.pages)) {
      addPage(`${subpackage.root}/${normalizeRoute(route)}`, relative, subpackage)
    }
  }
  if (pageEntries.length === 0) throw new Error('glaze.config.mjs does not declare any pages')
  if (!pageEntries.some((entry) => entry.owner == null)) {
    throw new Error('At least one main-package page is required')
  }
  const knownRoutes = new Set([
    ...routes,
    ...(config.staticPages ?? []).map((route) => normalizeRoute(route)),
  ])
  const pageConfigForRoute = new Map()
  const pageConfigSource = new Map()
  for (const [route, pageConfig] of Object.entries(config.pageConfig ?? {})) {
    const normalized = normalizeRoute(route)
    if (!knownRoutes.has(normalized)) {
      throw new Error(`Page config route "${route}" does not match any page`)
    }
    if (
      pageConfig === null ||
      typeof pageConfig !== 'object' ||
      Array.isArray(pageConfig) ||
      (pageConfig.usingComponents !== undefined &&
        (typeof pageConfig.usingComponents !== 'object' ||
          pageConfig.usingComponents === null ||
          Array.isArray(pageConfig.usingComponents)))
    ) {
      throw new Error(`Page config for "${route}" must be an object`)
    }
    const previous = pageConfigSource.get(normalized)
    if (previous !== undefined) {
      throw new Error(
        `Duplicate page config route "${normalized}": "${previous}" and "${route}" normalize to the same route`,
      )
    }
    pageConfigSource.set(normalized, route)
    pageConfigForRoute.set(normalized, pageConfig)
  }
  const ownerOf = (file) => {
    const owner = [...subpackages]
      .sort((left, right) => right.root.length - left.root.length)
      .find((entry) => isInside(path.join(sourceDir, entry.root), file))
    return owner ?? null
  }
  const ownerKey = (owner) => (owner ? owner.root : '')
  const outputFor = (owner, file, name) =>
    owner ? `/${owner.root}/components/${name}/index` : `/components/${name}/index`

  const cacheTag = `${project}|${JSON.stringify({
    source: config.source,
    output: config.output,
    pages: config.pages,
    subpackages: config.subpackages,
    pageConfig: config.pageConfig,
    runtime: config.runtime,
    static: config.static,
    staticPages: config.staticPages,
  })}`
  if (cacheTag !== compileCacheTag) {
    compileCache.clear()
    dependencyGraph.clear()
    compileCacheTag = cacheTag
  }
  let changedFiles = options.changedFiles
    ? new Set(options.changedFiles.map((file) => path.resolve(file)))
    : null
  if (changedFiles) {
    const stack = [...changedFiles]
    while (stack.length > 0) {
      const file = stack.pop()
      for (const parent of dependencyGraph.get(file) ?? []) {
        if (changedFiles.has(parent)) continue
        changedFiles.add(parent)
        stack.push(parent)
      }
    }
  }
  const compiled = new Map()
  const pageFiles = new Set(pageEntries.map((entry) => entry.file))
  const structuredCache = new Map<string, boolean>()
  const structuredFor = (file: string) => {
    let structured = structuredCache.get(file)
    if (structured === undefined) {
      structured =
        !pageFiles.has(file) && hasMultipleProps(sources.get(file) ?? '')
      structuredCache.set(file, structured)
    }
    return structured
  }
  const compileFile = async (file: string) => {
    const existing = compiled.get(file)
    if (existing) return existing
    const fileStat = await stat(file).catch(() => null)
    const fingerprint = fileStat ? `${fileStat.mtimeMs}:${fileStat.size}` : 'missing'
    if (changedFiles && !changedFiles.has(file)) {
      const cached = compileCache.get(file)
      if (cached && cached.fingerprint === fingerprint) {
        compiled.set(file, cached.entry)
        return cached.entry
      }
    }
    const dependencies = new Set<string>()
    const entry = {
      result: compileComponent(sources.get(file), {
        inline: true,
        sourceFile: file,
        bindingGroupSize,
        structuredProps: structuredFor(file),
        resolveComponent: (_name, specifier, fromFile = file) => {
          const child = resolveSourceImport(fromFile, specifier, sources)
          if (child) dependencies.add(child)
          return child
            ? { source: sources.get(child), file: child, structuredProps: structuredFor(child) }
            : null
        },
      }),
      dependencies,
    }
    compiled.set(file, entry)
    compileCache.set(file, { fingerprint, entry })
    return entry
  }

  // Validate that every page belongs to the package its file lives in.
  for (const entry of pageEntries) {
    const fileOwner = ownerOf(entry.file)
    if (entry.owner ? fileOwner !== entry.owner : fileOwner !== null) {
      throw new Error(
        `Page "${entry.route}" must live inside ${entry.owner ? `subpackage "${entry.owner.root}"` : 'the main package'}`,
      )
    }
  }

  // Compile pages first, then only the components they actually reach.
  // Unreachable TSX files are never parsed, so a stray file cannot fail a
  // build that does not use it.
  const used = new Set(pageEntries.map((entry) => entry.file))
  const edges = new Map<string, Set<string>>()
  const queue = [...used]
  while (queue.length > 0) {
    const file = queue.pop()
    const entry = await compileFile(file)
    const children = new Set<string>(entry.dependencies ?? [])
    for (const component of entry.result.components) {
      const fromFile = component.fromFile ?? file
      const child = resolveSourceImport(fromFile, component.source, sources)
      if (!child) {
        throw new Error(`Cannot resolve component "${component.name}" from ${fromFile}`)
      }
      children.add(child)
      if (!used.has(child)) {
        used.add(child)
        queue.push(child)
      }
    }
    for (const previous of edges.get(file) ?? []) {
      if (children.has(previous)) continue
      dependencyGraph.get(previous)?.delete(file)
    }
    for (const child of children) {
      const parents = dependencyGraph.get(child) ?? new Set<string>()
      parents.add(file)
      dependencyGraph.set(child, parents)
    }
    edges.set(file, children)
  }

  // A page may only reach components in its own package, plus (for a normal
  // subpackage) components in the main package. An independent subpackage
  // cannot depend on anything outside itself, and the main package cannot
  // depend on a subpackage.
  for (const entry of pageEntries) {
    const seen = new Set([entry.file])
    const stack = [entry.file]
    while (stack.length > 0) {
      const file = stack.pop()
      const fileOwner = ownerOf(file)
      if (entry.owner) {
        const allowed = fileOwner === entry.owner || (!entry.owner.independent && fileOwner === null)
        if (!allowed) {
          throw new Error(
            `Subpackage "${entry.owner.root}" page "${entry.route}" reaches "${path.relative(sourceDir, file)}" in another package`,
          )
        }
      } else if (fileOwner) {
        throw new Error(
          `Main page "${entry.route}" cannot use component "${path.relative(sourceDir, file)}" from subpackage "${fileOwner.root}"`,
        )
      }
      for (const child of edges.get(file) ?? []) {
        if (seen.has(child)) continue
        seen.add(child)
        stack.push(child)
      }
    }
  }

  const names = new Map()
  const namesByOwner = new Map()
  for (const file of [...used].sort()) {
    const name = outputNameFor(file, sourceDir)
    const owner = ownerOf(file)
    const key = ownerKey(owner)
    const group = namesByOwner.get(key) ?? new Map()
    const previous = group.get(name)
    if (previous) {
      throw new Error(
        `Output name collision "${name}": ${previous} and ${file} map to the same component`,
      )
    }
    group.set(name, file)
    namesByOwner.set(key, group)
    names.set(file, name)
  }

  const staticRoutes = new Set(
    (config.staticPages ?? []).map((route) => normalizeRoute(route)),
  )

  const hasAppStyle = ['app.wxss', 'app.scss', 'app.less'].some((file) =>
    existsSync(path.join(sourceDir, file)),
  )
  const missingAppFiles = ['app.js', 'app.wxss'].filter(
    (name) =>
      !existsSync(path.join(sourceDir, name)) &&
      !(name === 'app.wxss' && (hasAppStyle || config.css?.tailwind)),
  )
  for (const name of missingAppFiles) {
    console.warn(
      `glaze build: ${name} is missing from ${sourceDir}; the mini-program may not start`,
    )
  }

  // Reserve every generated output path before copying static files so a
  // static entry or a page wrapper cannot silently overwrite generated code.
  const outputClaims = new Map()
  const claimOutput = (relative, writer) => {
    const target = normalizeSourcePath(relative)
    const previous = outputClaims.get(target)
    if (previous) {
      throw new Error(
        `Output path collision: "${target}" is written by ${previous} and ${writer}`,
      )
    }
    outputClaims.set(target, writer)
  }
  const projectPathOf = (file) => normalizeSourcePath(path.relative(project, file))
  for (const file of used) {
    const owner = ownerOf(file)
    const target = `${owner ? `${owner.root}/` : ''}components/${names.get(file)}/index`
    for (const extension of ['wxml', 'json', 'wxss', 'js']) {
      claimOutput(
        `${target}.${extension}`,
        `component "${projectPathOf(file)}" -> "${target}.${extension}"`,
      )
    }
  }
  const runtimeGroups = new Set()
  for (const file of used) {
    const owner = ownerOf(file)
    if (owner && !owner.independent) continue
    runtimeGroups.add(owner ? owner.root : '')
  }
  for (const root of runtimeGroups) {
    const target = root ? `${root}/${SHARED_MODULE}` : SHARED_MODULE
    claimOutput(
      target,
      `${root ? `subpackage "${root}"` : 'main package'} runtime -> "${target}"`,
    )
  }
  for (const entry of pageEntries) {
    if (staticRoutes.has(entry.route)) continue
    for (const extension of ['wxml', 'json', 'wxss', 'js']) {
      const target = `${entry.route}.${extension}`
      claimOutput(target, `page route "${entry.route}" -> "${target}"`)
    }
  }
  claimOutput('app.json', 'generated "app.json"')
  if (existsSync(path.join(sourceDir, 'app.js'))) claimOutput('app.js', 'copied "app.js"')
  if (hasAppStyle || config.css?.tailwind) {
    claimOutput('app.wxss', 'generated "app.wxss"')
  }

  await mkdir(stagingBase, { recursive: true })
  const stagingDir = await mkdtemp(path.join(stagingBase, 'out-'))

  try {
    const assets = new Map<string, string>()
    const assetEntry = (entry) => {
      if (typeof entry === 'string') return { from: entry }
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new Error('Static entries must be a string or an object with "from"')
      }
      return entry
    }
    const claimStatic = (source, target) => {
      const targetPath = normalizeSourcePath(path.relative(stagingDir, target))
      claimOutput(
        targetPath,
        `static asset "${projectPathOf(source)}" -> "${targetPath}"`,
      )
    }
    const copyTree = async (source, target) => {
      await mkdir(target, { recursive: true })
      for (const item of await readdir(source, { withFileTypes: true })) {
        const from = path.join(source, item.name)
        const to = path.join(target, item.name)
        if (item.isDirectory()) {
          await copyTree(from, to)
        } else {
          claimStatic(from, to)
          await copyFile(from, to)
          assets.set(from, normalizeSourcePath(path.relative(stagingDir, to)))
        }
      }
    }
    for (const raw of config.static ?? []) {
      const entry = assetEntry(raw)
      if (typeof entry.from !== 'string' || entry.from.trim() === '') {
        throw new Error('Static asset "from" must be a non-empty relative path')
      }
      if (entry.to !== undefined && typeof entry.to !== 'string') {
        throw new Error('Static asset "to" must be a relative path')
      }
      const fromRelative = normalizeSourcePath(entry.from)
      if (fromRelative === '' || fromRelative === '.') {
        throw new Error(`Static asset "from" must name a subdirectory or file: ${entry.from}`)
      }
      const from = path.resolve(sourceDir, fromRelative)
      if (!isInside(sourceDir, from)) {
        throw new Error(`Static asset source must be inside "source": ${entry.from}`)
      }
      if (!existsSync(from)) {
        throw new Error(
          `Static asset source not found: ${entry.from} (resolved to ${projectPathOf(from)})`,
        )
      }
      const subpackageRoot = entry.subpackage
        ? normalizeSubpackageRoot(entry.subpackage)
        : null
      if (subpackageRoot && !subpackages.some((item) => item.root === subpackageRoot)) {
        throw new Error(`Static asset subpackage does not exist: ${entry.subpackage}`)
      }
      const root = subpackageRoot ? path.join(stagingDir, subpackageRoot) : stagingDir
      if (
        entry.to &&
        (path.isAbsolute(entry.to) ||
          normalizeSourcePath(entry.to).split('/').includes('..'))
      ) {
        throw new Error(`Static asset target must be a relative path: ${entry.to}`)
      }
      const sourceStat = await stat(from)
      const target = entry.to
        ? path.join(root, entry.to)
        : sourceStat.isDirectory()
          ? root
          : path.join(root, path.basename(from))
      if (sourceStat.isDirectory()) {
        await copyTree(from, target)
      } else {
        claimStatic(from, target)
        await mkdir(path.dirname(target), { recursive: true })
        await copyFile(from, target)
        assets.set(from, normalizeSourcePath(path.relative(stagingDir, target)))
      }
    }

    const resolveWxmlAssets = (result, outDir) =>
      result.wxml.replace(/__GLAZE_ASSET_(\d+)__/g, (match, index) => {
        const entry = result.assets?.[Number(index)]
        if (!entry) return match
        if (!entry.fromFile) {
          throw new Error(`Cannot resolve asset "${entry.specifier}" without a source file`)
        }
        const source = path.resolve(path.dirname(entry.fromFile), entry.specifier)
        const target = assets.get(source)
        if (!target) {
          throw new Error(
            `Asset "${entry.specifier}" referenced from ${entry.fromFile} is not in static`,
          )
        }
        return `/${target}`
      })

    const appJs = path.join(sourceDir, 'app.js')
    if (existsSync(appJs)) await copyFile(appJs, path.join(stagingDir, 'app.js'))
    const appStyle = await readAppStyle(sourceDir)
    if (appStyle) {
      const content = rewriteWxssUrls(
        appStyle.file,
        appStyle.content,
        stagingDir,
        stagingDir,
        assets,
      )
      assertPortableWxss(appStyle.file, content, { allowRelative: true })
      await writeFile(path.join(stagingDir, 'app.wxss'), content)
    }

    const styleCache = new Map()
    const readStyle = async (file) => {
      if (styleCache.has(file)) return styleCache.get(file)
      const content = await readComponentStyle(file)
      styleCache.set(file, content)
      return content
    }

    const componentGroups = new Map()
    const groupFor = (owner) => {
      const key = ownerKey(owner)
      let group = componentGroups.get(key)
      if (group) return group
      const base = owner ? path.join(stagingDir, owner.root) : stagingDir
      // A normal subpackage can require the main package's JavaScript. Only an
      // independent subpackage needs its own runtime copy.
      const sharedOwner = owner && owner.independent ? owner : null
      const sharedBase = sharedOwner ? path.join(stagingDir, sharedOwner.root) : stagingDir
      const sharedPath = path.join(sharedBase, SHARED_MODULE)
      group = {
        dir: path.join(base, 'components'),
        sharedPath,
        js: new Map(),
        inputs: new Set(),
      }
      componentGroups.set(key, group)
      return group
    }

    for (const file of used) {
      const { result } = compiled.get(file)
      const owner = ownerOf(file)
      const group = groupFor(owner)
      const outName = names.get(file)
      const outDir = path.join(group.dir, outName)
      await mkdir(outDir, { recursive: true })

      await writeFile(path.join(outDir, 'index.wxml'), resolveWxmlAssets(result, outDir))

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
        usingComponents[tag] = outputFor(ownerOf(child), child, names.get(child))
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
        inlineStyles.push(await readStyle(child))
      }
      const ownStyle = await readStyle(file)
      const styleParts = [
        rewriteWxssUrls(ownStyle.file, ownStyle.content, outDir, stagingDir, assets),
        ...inlineStyles.map((style) =>
          rewriteWxssUrls(style.file, style.content, outDir, stagingDir, assets),
        ),
      ]
      const styleText = styleParts.join('\n')
      assertPortableWxss(ownStyle.file, styleText, { allowRelative: true })
      await writeFile(path.join(outDir, 'index.wxss'), styleText)

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
        outfile: path.join(outDir, 'index.js'),
        assetNames: 'assets/[name]-[hash]',
        publicPath: `${owner ? `/${owner.root}` : ''}/components/${outName}/`,
        nodePaths: [
          path.join(project, 'node_modules'),
          path.join(packageRoot, 'node_modules'),
          path.join(repoRoot, 'node_modules'),
        ],
        loader: {
          '.tsx': 'tsx',
          '.ts': 'ts',
          '.png': 'file',
          '.jpg': 'file',
          '.jpeg': 'file',
          '.gif': 'file',
          '.webp': 'file',
          '.svg': 'file',
          '.woff': 'file',
          '.woff2': 'file',
          '.ttf': 'file',
          '.otf': 'file',
          '.eot': 'file',
          '.mp3': 'file',
          '.mp4': 'file',
        },
        plugins: [
          sharedRuntimePlugin(sharedSpecifierFor(outDir, group.sharedPath)),
          dedupeSolidPlugin,
        ],
        minify: true,
        logLevel: 'warning',
      })
      const jsPath = path.join(outDir, 'index.js')
      const jsOutput = bundle.outputFiles.find((output) => output.path === jsPath)
      if (!jsOutput) throw new Error(`Component bundle did not produce index.js: ${file}`)
      group.js.set(file, jsOutput.text)
      for (const output of bundle.outputFiles) {
        if (output.path === jsPath) continue
        await mkdir(path.dirname(output.path), { recursive: true })
        await writeFile(output.path, output.contents)
      }
      for (const input of Object.keys(bundle.metafile.inputs)) {
        if (input === '<stdin>' || input.startsWith('<')) continue
        if (!/\.(tsx?|jsx?|mjs|cjs|json)$/.test(input)) continue
        group.inputs.add(input)
      }
    }

    const sharedGroups = new Map()
    for (const group of componentGroups.values()) {
      let shared = sharedGroups.get(group.sharedPath)
      if (!shared) {
        shared = { js: [], inputs: new Set() }
        sharedGroups.set(group.sharedPath, shared)
      }
      shared.js.push(...[...group.js.keys()].map((file) => compiled.get(file).result.js))
      for (const input of group.inputs) shared.inputs.add(input)
    }
    for (const [sharedPath, shared] of sharedGroups) {
      const sharedTexts = [...shared.js]
      for (const input of shared.inputs) {
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
    }
    for (const group of componentGroups.values()) {
      for (const [file, output] of group.js) {
        await writeFile(path.join(group.dir, names.get(file), 'index.js'), output)
      }
    }

    for (const entry of pageEntries) {
      const { route, file, owner } = entry
      if (staticRoutes.has(route)) continue
      const outName = names.get(file)
      const pageDir = path.join(stagingDir, path.dirname(route))
      const pageName = path.basename(route)
      await mkdir(pageDir, { recursive: true })
      await writeFile(
        path.join(pageDir, `${pageName}.js`),
        `Page({\n  data: {},\n})\n`,
      )
      const pageConfig = pageConfigForRoute.get(route) ?? {}
      const usingComponents = {
        ...(pageConfig.usingComponents as Record<string, string> | undefined),
        'glaze-page': outputFor(owner, file, outName),
      }
      await writeFile(
        path.join(pageDir, `${pageName}.json`),
        `${JSON.stringify({ ...pageConfig, usingComponents }, null, 2)}\n`,
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
      ? JSON.parse((await readFile(appJsonSource, 'utf8')).replace(/^\uFEFF/, ''))
      : { componentFramework: 'glass-easel', window: { glassEaselWebview: true } }
    delete appJson.subpackages
    delete appJson.subPackages
    const routeList = []
    const seenRoutes = new Set()
    for (const entry of pageEntries) {
      if (entry.owner) continue
      if (seenRoutes.has(entry.route)) continue
      seenRoutes.add(entry.route)
      routeList.push(entry.route)
    }
    for (const route of config.staticPages ?? []) {
      const normalized = normalizeRoute(route)
      if (seenRoutes.has(normalized)) continue
      seenRoutes.add(normalized)
      routeList.push(normalized)
    }
    appJson.pages = routeList
    if (subpackages.length > 0) {
      appJson.subPackages = subpackages.map((subpackage) => ({
        root: subpackage.root,
        pages: pageEntries
          .filter((entry) => entry.owner === subpackage)
          .map((entry) => entry.route.slice(subpackage.root.length + 1)),
        ...(subpackage.independent ? { independent: true } : {}),
      }))
    }
    await writeFile(appJsonFile, `${JSON.stringify(appJson, null, 2)}\n`)

    await applyTailwind(project, sourceDir, stagingDir, config, assets)

    await replaceOutput(stagingDir, outputDir, config.clean !== false)
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true }).catch(() => {})
    throw error
  }

  return {
    outputDir,
    pages: pageEntries.map((entry) => entry.route),
    components: [...used].map((file) => names.get(file)),
    config,
  }
}
