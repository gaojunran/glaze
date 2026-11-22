import { existsSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parse } from '@babel/parser'
import { kebabCase } from '@glaze/shared'
import { buildProject } from './build.ts'
import { normalizeRoute } from './paths.ts'

export type GlazeSnippetConfig = {
  project?: Record<string, unknown>
  app?: Record<string, unknown>
  page?: {
    route?: string
    config?: Record<string, unknown>
  }
  tailwind?: boolean | { safelist?: string[] }
}

export type SnippetSource = {
  code: string
  config: GlazeSnippetConfig
}

export type SnippetBuildResult = {
  outDir: string
  route: string
  pages: string[]
  components: string[]
}

const CONFIG_NAME = 'glaze'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value)

function literalValue(node: any): unknown {
  switch (node.type) {
    case 'TSAsExpression':
    case 'TSSatisfiesExpression':
    case 'TSNonNullExpression':
    case 'ParenthesizedExpression':
      return literalValue(node.expression)
    case 'StringLiteral':
    case 'NumericLiteral':
    case 'BooleanLiteral':
      return node.value
    case 'NullLiteral':
      return null
    case 'UnaryExpression':
      if (node.operator === '-' && node.argument.type === 'NumericLiteral') {
        return -node.argument.value
      }
      break
    case 'TemplateLiteral':
      if (node.expressions.length === 0) return node.quasis[0].value.cooked
      break
    case 'ArrayExpression':
      return node.elements.map((element) =>
        element == null ? null : literalValue(element),
      )
    case 'ObjectExpression': {
      const value: Record<string, unknown> = {}
      for (const property of node.properties) {
        if (property.type !== 'ObjectProperty' || property.computed) {
          throw new Error(
            `Snippet config supports only static object properties (found ${property.type})`,
          )
        }
        const key =
          property.key.type === 'Identifier'
            ? property.key.name
            : property.key.type === 'StringLiteral' ||
                property.key.type === 'NumericLiteral'
              ? String(property.key.value)
              : null
        if (key == null) throw new Error('Snippet config has an unsupported property key')
        value[key] = literalValue(property.value)
      }
      return value
    }
  }
  throw new Error(
    `Snippet config must be a static JSON value (found ${node.type})`,
  )
}

/**
 * Read the `export const glaze = {...}` metadata and remove it from the
 * component source. The metadata is a compile-time concern; it must not reach
 * the generated mini-program component.
 */
export function parseSnippetSource(source: string): SnippetSource {
  const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] })
  const matches = ast.program.body.filter(
    (node) =>
      node.type === 'ExportNamedDeclaration' &&
      node.declaration?.type === 'VariableDeclaration' &&
      node.declaration.declarations.some(
        (declaration) =>
          declaration.id.type === 'Identifier' && declaration.id.name === CONFIG_NAME,
      ),
  )
  if (matches.length === 0) {
    throw new Error(
      `A snippet TSX file must export a static \`${CONFIG_NAME}\` object, for example:\n` +
        `export const ${CONFIG_NAME} = { page: { route: 'pages/index/index' }, tailwind: true }`,
    )
  }
  if (matches.length > 1) {
    throw new Error(`A snippet TSX file must export \`${CONFIG_NAME}\` exactly once`)
  }

  const declaration = matches[0] as any
  if (declaration.declaration.declarations.length !== 1) {
    throw new Error(`\`${CONFIG_NAME}\` must be the only declaration in its export`)
  }
  const variable = declaration.declaration.declarations.find(
    (item) => item.id.type === 'Identifier' && item.id.name === CONFIG_NAME,
  )
  if (!variable?.init) {
    throw new Error(`\`${CONFIG_NAME}\` must be initialized with an object literal`)
  }
  const config = literalValue(variable.init)
  if (!isRecord(config)) {
    throw new Error(`\`${CONFIG_NAME}\` must be an object`)
  }
  return {
    code: source.slice(0, declaration.start) + source.slice(declaration.end),
    config: config as GlazeSnippetConfig,
  }
}

export function defaultSnippetOut(sourceFile: string): string {
  const name = kebabCase(path.basename(sourceFile, path.extname(sourceFile)))
  return path.resolve(process.cwd(), `${name}-snippet`)
}

function routeFor(config: GlazeSnippetConfig): string {
  const route = config.page?.route ?? 'pages/index/index'
  if (typeof route !== 'string' || route.trim() === '') {
    throw new Error('Snippet page.route must be a non-empty string')
  }
  const normalized = normalizeRoute(route.trim())
  if (
    normalized === '' ||
    normalized.startsWith('..') ||
    normalized.includes('\\') ||
    normalized.split('/').includes('..') ||
    path.isAbsolute(normalized)
  ) {
    throw new Error(`Invalid snippet page.route: ${route}`)
  }
  return normalized
}

function assertSafeOut(outDir: string, sourceFile: string, force: boolean): void {
  if (!existsSync(outDir)) return
  const relative = path.relative(outDir, sourceFile)
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    throw new Error('Snippet output must not contain the source file')
  }
  if (!force) {
    throw new Error(
      `Snippet output already exists: ${outDir}. Pass --force to replace it.`,
    )
  }
}

/**
 * Build a standalone mini-program project from one TSX file.
 *
 * The source is copied into a temporary Glaze project (app shell + generated
 * config), built with the normal builder, and the resulting mini-program is
 * copied to `outDir` next to a `project.config.json`.
 */
export async function buildSnippet(
  sourceFile: string,
  options: { out?: string; force?: boolean } = {},
): Promise<SnippetBuildResult> {
  const sourcePath = path.resolve(sourceFile)
  if (!sourcePath.endsWith('.tsx')) {
    throw new Error(`Snippet source must be a .tsx file: ${sourcePath}`)
  }
  const source = await readFile(sourcePath, 'utf8')
  const { code, config } = parseSnippetSource(source)
  const route = routeFor(config)
  const outDir = path.resolve(options.out ?? defaultSnippetOut(sourcePath))
  const force = options.force === true
  assertSafeOut(outDir, sourcePath, force)
  if (existsSync(outDir) && force) await rm(outDir, { recursive: true, force: true })

  const tempProject = await mkdtemp(path.join(tmpdir(), 'glaze-snippet-'))
  try {
    const sourceDir = path.join(tempProject, 'src')
    await mkdir(sourceDir, { recursive: true })
    await writeFile(path.join(sourceDir, 'Page.tsx'), code)
    await writeFile(path.join(sourceDir, 'app.js'), 'App({})\n')
    await writeFile(path.join(sourceDir, 'app.wxss'), '')

    const app = isRecord(config.app) ? config.app : {}
    const appWindow = isRecord(app.window) ? app.window : {}
    await writeFile(
      path.join(sourceDir, 'app.json'),
      `${JSON.stringify(
        {
          ...app,
          pages: [route],
          componentFramework: 'glass-easel',
          window: { ...appWindow, glassEaselWebview: true },
        },
        null,
        2,
      )}\n`,
    )

    const hasTailwind = config.tailwind === true || isRecord(config.tailwind)
    const tailwind =
      typeof config.tailwind === 'object' && config.tailwind != null
        ? config.tailwind
        : {}
    if (hasTailwind) {
      await writeFile(
        path.join(sourceDir, 'tailwind.css'),
        '@import "tailwindcss" source(none);\n@source "./**/*.{tsx,ts}";\n',
      )
    }

    const buildConfig: Record<string, unknown> = {
      source: 'src',
      output: 'miniprogram',
      pages: { [route]: 'Page.tsx' },
    }
    if (hasTailwind) {
      buildConfig.css = {
        tailwind: {
          input: 'src/tailwind.css',
          ...(Array.isArray(tailwind.safelist) ? { safelist: tailwind.safelist } : {}),
        },
      }
    }
    await writeFile(
      path.join(tempProject, 'glaze.config.mjs'),
      `export default ${JSON.stringify(buildConfig, null, 2)}\n`,
    )

    const project = isRecord(config.project) ? config.project : {}
    const projectSetting = isRecord(project.setting) ? project.setting : {}
    await writeFile(
      path.join(tempProject, 'project.config.json'),
      `${JSON.stringify(
        {
          ...project,
          miniprogramRoot: 'miniprogram/',
          compileType: 'miniprogram',
          appid: project.appid ?? 'touristappid',
          projectname:
            project.projectname ??
            `${kebabCase(path.basename(sourcePath, '.tsx'))}-snippet`,
          setting: { es6: false, minified: false, ...projectSetting },
        },
        null,
        2,
      )}\n`,
    )

    const result = await buildProject(tempProject)

    if (isRecord(config.page?.config)) {
      const pageJson = path.join(tempProject, 'miniprogram', `${route}.json`)
      const existing = JSON.parse(await readFile(pageJson, 'utf8'))
      await writeFile(
        pageJson,
        `${JSON.stringify({ ...existing, ...config.page.config }, null, 2)}\n`,
      )
    }

    await mkdir(outDir, { recursive: true })
    await cp(path.join(tempProject, 'miniprogram'), path.join(outDir, 'miniprogram'), {
      recursive: true,
    })
    await cp(
      path.join(tempProject, 'project.config.json'),
      path.join(outDir, 'project.config.json'),
    )
    return {
      outDir,
      route,
      pages: result.pages,
      components: result.components,
    }
  } finally {
    await rm(tempProject, { recursive: true, force: true })
  }
}
