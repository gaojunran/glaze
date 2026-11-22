import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export type GlazeRuntimeConfig = {
  bindingGroupSize?: number
}

export type GlazeTailwindConfig = {
  input: string
  safelist?: string[]
}

export type GlazeCssConfig = {
  tailwind?: GlazeTailwindConfig
}

export type GlazeSubpackage = {
  root: string
  pages: Record<string, string>
  independent?: boolean
}

export type GlazeConfig = {
  source: string
  output: string
  pages: Record<string, string>
  static?: string[]
  staticPages?: string[]
  subpackages?: GlazeSubpackage[]
  pageConfig?: Record<string, Record<string, unknown>>
  clean?: boolean
  runtime?: GlazeRuntimeConfig
  css?: GlazeCssConfig
}

export const DEFAULT_CONFIG: GlazeConfig = {
  source: 'src',
  output: 'miniprogram',
  pages: {},
  staticPages: [],
  subpackages: [],
}

export const CONFIG_FILES = ['glaze.config.mts', 'glaze.config.ts', 'glaze.config.mjs'] as const

export function configFileFor(projectPath: string): string | null {
  for (const name of CONFIG_FILES) {
    const file = path.join(projectPath, name)
    if (existsSync(file)) return file
  }
  return null
}

let configImportCounter = 0

export async function loadConfig(projectPath: string): Promise<GlazeConfig> {
  const configFile = configFileFor(projectPath)
  if (!configFile) return DEFAULT_CONFIG
  // ESM module records are cached forever, so a plain import() would keep the
  // first config during `glaze watch`. Bust the cache on every load.
  const url = pathToFileURL(configFile)
  url.searchParams.set('v', `${Date.now()}-${++configImportCounter}`)
  const loaded = await import(url.href)
  return { ...DEFAULT_CONFIG, ...(loaded.default ?? loaded) }
}

export async function collectTsx(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...(await collectTsx(full)))
    else if (entry.name.endsWith('.tsx')) files.push(full)
  }
  return files.sort()
}

export function resolveSourceImport(fromFile, specifier, sources) {
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

export function styleFor(sourceFile) {
  return path.join(
    path.dirname(sourceFile),
    `${path.basename(sourceFile, '.tsx')}.wxss`,
  )
}

export function styleCandidatesFor(sourceFile) {
  const base = styleFor(sourceFile).slice(0, -'.wxss'.length)
  return [`${base}.wxss`, `${base}.scss`, `${base}.less`]
}

