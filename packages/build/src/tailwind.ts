import { existsSync } from 'node:fs'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { GlazeConfig, GlazeTailwindConfig } from './config.ts'

const CLASS_ATTRIBUTE = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/g

async function collectFiles(dir: string, extensions: string[]): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...(await collectFiles(full, extensions)))
    else if (extensions.some((extension) => entry.name.endsWith(extension))) files.push(full)
  }
  return files.sort()
}

function collectClassCandidates(wxml: string): string[] {
  const candidates = new Set<string>()
  for (const match of wxml.matchAll(CLASS_ATTRIBUTE)) {
    const value = match[1] ?? match[2] ?? ''
    if (value.includes('{{')) continue
    for (const token of value.split(/\s+/)) {
      if (token) candidates.add(token)
    }
  }
  return [...candidates]
}

export function validateTailwindConfig(project: string, config: GlazeConfig): string | null {
  const tailwind = config.css?.tailwind
  if (!tailwind) return null
  if (!tailwind.input || typeof tailwind.input !== 'string') {
    throw new Error('Config "css.tailwind.input" must be a stylesheet path')
  }
  if (
    tailwind.safelist &&
    (!Array.isArray(tailwind.safelist) ||
      tailwind.safelist.some((entry) => typeof entry !== 'string' || entry.length === 0))
  ) {
    throw new Error('Config "css.tailwind.safelist" must be an array of class names')
  }
  const input = path.resolve(project, tailwind.input)
  const relative = path.relative(project, input)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Config "css.tailwind.input" must be inside the project: ${tailwind.input}`)
  }
  if (!existsSync(input)) {
    throw new Error(`Tailwind input stylesheet not found: ${tailwind.input}`)
  }
  return input
}

async function loadTailwind() {
  try {
    return await import('weapp-tailwindcss/core')
  } catch (error) {
    throw new Error(
      'Tailwind support requires the optional "tailwindcss" and "weapp-tailwindcss" packages. Install them in the project that enables css.tailwind.',
      { cause: error },
    )
  }
}

/**
 * Generate one global app.wxss from the configured Tailwind entry and rewrite
 * generated WXML/JS class strings with the same classNameSet.
 *
 * The mini-program style scope is still the global app.wxss: generated
 * components use styleIsolation "apply-shared", so utilities reach component
 * internals without injecting a second copy into every index.wxss.
 */
export async function applyTailwind(
  project: string,
  sourceDir: string,
  stagingDir: string,
  config: GlazeConfig,
): Promise<void> {
  const tailwind: GlazeTailwindConfig | undefined = config.css?.tailwind
  if (!tailwind) return
  const input = validateTailwindConfig(project, config)
  if (!input) return

  const { createCompiler } = await loadTailwind()
  const compiler = createCompiler({})

  try {
    const componentDir = path.join(stagingDir, 'components')
    const wxmlFiles = existsSync(componentDir)
      ? await collectFiles(componentDir, ['.wxml'])
      : []
    const jsFiles = existsSync(componentDir)
      ? await collectFiles(componentDir, ['.js'])
      : []
    const wxml = await Promise.all(wxmlFiles.map((file) => readFile(file, 'utf8')))
    const candidates = new Set(tailwind.safelist ?? [])
    for (const source of wxml) {
      for (const candidate of collectClassCandidates(source)) candidates.add(candidate)
    }

    const generated = await compiler.generate({
      id: 'glaze-app',
      sourceOptions: {
        projectRoot: project,
        cssEntries: [input],
      },
      target: 'weapp',
      scanSources: true,
      candidates: [...candidates],
    })

    const appWxss = path.join(stagingDir, 'app.wxss')
    const appWxssSource = path.join(sourceDir, 'app.wxss')
    const existing =
      path.resolve(input) === path.resolve(appWxssSource) || !existsSync(appWxss)
        ? ''
        : await readFile(appWxss, 'utf8')
    await writeFile(appWxss, [generated.css, existing.trim()].filter(Boolean).join('\n'))

    for (let index = 0; index < wxmlFiles.length; index += 1) {
      const transformed = await compiler.transformTemplate(wxml[index], generated.snapshot)
      await writeFile(wxmlFiles[index], transformed)
    }

    for (const file of jsFiles) {
      const source = await readFile(file, 'utf8')
      const result = await compiler.transformJavaScript(source, generated.snapshot)
      if (result.error) {
        throw new Error(`Tailwind could not transform ${file}: ${result.error.message}`)
      }
      await writeFile(file, result.code)
    }
  } finally {
    await compiler.dispose?.()
  }
}
