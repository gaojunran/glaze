import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { styleCandidatesFor } from './config.ts'

export type StyleSource = {
  file: string
  content: string
}

function firstExisting(files: string[]): string | null {
  return files.find((file) => existsSync(file)) ?? null
}

async function compileSass(file: string): Promise<string> {
  let sass
  try {
    sass = await import('sass')
  } catch (error) {
    throw new Error(
      'SCSS support requires the optional "sass" package. Install it in the project that uses .scss styles.',
      { cause: error },
    )
  }
  const result = await sass.compileAsync(file, { style: 'expanded' })
  return result.css
}

async function compileLess(file: string): Promise<string> {
  let less
  try {
    less = (await import('less')).default
  } catch (error) {
    throw new Error(
      'Less support requires the optional "less" package. Install it in the project that uses .less styles.',
      { cause: error },
    )
  }
  const source = await readFile(file, 'utf8')
  const result = await less.render(source, {
    filename: file,
    paths: [path.dirname(file)],
  })
  return result.css
}

async function readOrCompile(file: string): Promise<string> {
  if (file.endsWith('.scss')) return compileSass(file)
  if (file.endsWith('.less')) return compileLess(file)
  return readFile(file, 'utf8')
}

/**
 * Read the style for a source component. A same-name .wxss wins over .scss and
 * .less, matching the existing generated-output contract; preprocessors are an
 * authoring format, not a second runtime path.
 */
export async function readComponentStyle(sourceFile: string): Promise<StyleSource> {
  const file = firstExisting(styleCandidatesFor(sourceFile))
  if (!file) return { file: sourceFile, content: '' }
  return { file, content: await readOrCompile(file) }
}

/** Read the app-level style, preferring app.wxss over app.scss/app.less. */
export async function readAppStyle(sourceDir: string): Promise<StyleSource | null> {
  const file = firstExisting([
    path.join(sourceDir, 'app.wxss'),
    path.join(sourceDir, 'app.scss'),
    path.join(sourceDir, 'app.less'),
  ])
  if (!file) return null
  return { file, content: await readOrCompile(file) }
}
