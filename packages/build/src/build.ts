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
import { loadConfig, collectTsx, resolveSourceImport } from './config.ts'
import {
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

export async function buildProject(projectPath = process.cwd()) {
  const project = path.resolve(projectPath)
  const config = await loadConfig(project)
  const bindingGroupSize = config.runtime?.bindingGroupSize
  if (
    bindingGroupSize !== undefined &&
    (!Number.isInteger(bindingGroupSize) || bindingGroupSize <= 0)
  ) {
    throw new Error('Config "runtime.bindingGroupSize" must be a positive integer')
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
    const file = path.resolve(sourceDir, relative)
    if (!sources.has(file)) throw new Error(`Page source not found: ${relative}`)
    const normalized = normalizeRoute(route)
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
  const ownerOf = (file) => {
    const owner = [...subpackages]
      .sort((left, right) => right.root.length - left.root.length)
      .find((entry) => isInside(path.join(sourceDir, entry.root), file))
    return owner ?? null
  }
  const ownerKey = (owner) => (owner ? owner.root : '')
  const outputFor = (owner, file, name) =>
    owner ? `/${owner.root}/components/${name}/index` : `/components/${name}/index`

  const compiled = new Map()
  const compileFile = (file) => {
    const existing = compiled.get(file)
    if (existing) return existing
    const entry = {
      result: compileComponent(sources.get(file), {
        inline: true,
        sourceFile: file,
        bindingGroupSize,
        resolveComponent: (_name, specifier, fromFile = file) => {
          const child = resolveSourceImport(fromFile, specifier, sources)
          return child ? { source: sources.get(child), file: child } : null
        },
      }),
    }
    compiled.set(file, entry)
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
  const edges = new Map()
  const queue = [...used]
  while (queue.length > 0) {
    const file = queue.pop()
    const entry = compileFile(file)
    const children = []
    for (const component of entry.result.components) {
      const fromFile = component.fromFile ?? file
      const child = resolveSourceImport(fromFile, component.source, sources)
      if (!child) {
        throw new Error(`Cannot resolve component "${component.name}" from ${fromFile}`)
      }
      children.push(child)
      if (!used.has(child)) {
        used.add(child)
        queue.push(child)
      }
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

  await mkdir(stagingBase, { recursive: true })
  const stagingDir = await mkdtemp(path.join(stagingBase, 'out-'))

  try {
    const appJs = path.join(sourceDir, 'app.js')
    if (existsSync(appJs)) await copyFile(appJs, path.join(stagingDir, 'app.js'))
    const appWxss = path.join(sourceDir, 'app.wxss')
    if (existsSync(appWxss)) {
      await copyFile(appWxss, path.join(stagingDir, 'app.wxss'))
    } else {
      const appStyle = await readAppStyle(sourceDir)
      if (appStyle) await writeFile(path.join(stagingDir, 'app.wxss'), appStyle.content)
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
      const sharedPath = path.join(base, SHARED_MODULE)
      if (existsSync(sharedPath) || existsSync(path.dirname(sharedPath))) {
        throw new Error(
          `Output file collision: ${SHARED_MODULE} already exists in the staged output`,
        )
      }
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
      await writeFile(
        path.join(outDir, 'index.wxss'),
        [await readStyle(file), ...inlineStyles].join('\n'),
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
          sharedRuntimePlugin(sharedSpecifierFor(outDir, group.sharedPath)),
          dedupeSolidPlugin,
        ],
        minify: true,
        logLevel: 'warning',
      })
      group.js.set(file, bundle.outputFiles[0].text)
      for (const input of Object.keys(bundle.metafile.inputs)) {
        if (input !== '<stdin>') group.inputs.add(input)
      }
    }

    for (const group of componentGroups.values()) {
      const sharedTexts = [...group.js.keys()].map((file) => compiled.get(file).result.js)
      for (const input of group.inputs) {
        try {
          sharedTexts.push(await readFile(input, 'utf8'))
        } catch {
          // A virtual or generated input is already represented by result.js.
        }
      }
      const sharedImports = collectSharedImports(sharedTexts)
      if (sharedImports.size > 0) {
        await mkdir(path.dirname(group.sharedPath), { recursive: true })
        await buildSharedModule(sharedImports, group.sharedPath)
      }
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
      await writeFile(
        path.join(pageDir, `${pageName}.json`),
        `${JSON.stringify(
          {
            usingComponents: {
              'glaze-page': outputFor(owner, file, outName),
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

    await applyTailwind(project, sourceDir, stagingDir, config)

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
