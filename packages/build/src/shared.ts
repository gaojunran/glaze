import { build as esbuild } from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeSourcePath } from './paths.ts'

export const repoRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)))
export const packageRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))

export const dedupeSolidPlugin = {
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

export const SHARED_SPECIFIERS = new Set([
  'solid-js',
  '@glaze/runtime',
  '@glaze/runtime/mini',
  '@glaze/store',
])
const SHARED_SPECIFIER_RE = /^(@glaze\/(?:runtime(?:\/mini)?|store)|solid-js)$/
export const SHARED_MODULE = 'glaze-runtime/index.js'

/** Compute the literal require() path a component uses to reach the shared runtime. */
export const sharedSpecifierFor = (fromDir, sharedPath) => {
  const relative = normalizeSourcePath(path.relative(fromDir, sharedPath))
  return relative.startsWith('.') ? relative : `./${relative}`
}

export const sharedRuntimePlugin = (specifier) => ({
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
export const collectSharedImports = (sources) => {
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

export const buildSharedModule = (groups, outfile) =>
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
