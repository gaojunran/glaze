import path from 'node:path'
import { normalizeSourcePath } from './paths.ts'

export function assertPortableWxss(file, content, { allowRelative = false } = {}) {
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
      /^(data:|https?:|\/\/|\/)/i.test(value) ||
      (allowRelative && !/^[a-z]+:/i.test(value))
    ) {
      continue
    }
    throw new Error(
      `WXSS url() must be absolute, remote, or a data URL because styles are copied into generated components: ${file} (${value})`,
    )
  }
}

/**
 * Rewrite relative `url()` references from a source stylesheet to a path
 * relative to the generated component directory. Only files copied through
 * `static` are addressable; an unknown asset is a build error rather than a
 * silently broken URL in the mini-program.
 */
export function rewriteWxssUrls(file, content, outDir, stagingDir, assets) {
  const urlPattern = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi
  return content.replace(urlPattern, (match, quote, rawValue) => {
    const value = rawValue.trim()
    if (value === '' || value.startsWith('#') || /^(data:|https?:|\/\/|\/)/i.test(value)) {
      return match
    }
    const pathname = value.split(/[?#]/, 1)[0]
    const suffix = value.slice(pathname.length)
    const source = path.resolve(path.dirname(file), pathname)
    const target = assets.get(source)
    if (!target) {
      throw new Error(
        `WXSS url() references an asset that is not in static: ${file} (${value})`,
      )
    }
    let relative = normalizeSourcePath(path.relative(outDir, path.join(stagingDir, target)))
    if (!relative.startsWith('.')) relative = `./${relative}`
    return `url(${quote}${relative}${suffix}${quote})`
  })
}
