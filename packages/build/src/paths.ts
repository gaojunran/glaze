import path from 'node:path'
import { kebabCase } from '@glaze/shared'
export { kebabCase }

/** Normalize a route the way app.json expects it. */
export const normalizeRoute = (route) =>
  route
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
    .replace(/\/+/g, '/')
    .replace(/\/+$/, '')
    .replace(/\.(tsx|wxml)$/, '')

export const normalizeSubpackageRoot = (root) =>
  root
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^(?:\.\/)+/, '')
    .replace(/^\/+|\/+$/g, '')

export const hasRouteTraversal = (route) =>
  route.split(/[\\/]/).some((segment) => segment === '..')

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

export function outputNameFor(sourceFile, sourceDir) {
  return outputNameForRelative(path.relative(sourceDir, sourceFile))
}

export const escapes = (relative) =>
  relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)

export const isInside = (parent, child) => {
  const relative = path.relative(parent, child)
  return relative !== '' && !escapes(relative)
}

/** Require target to be a strict subdirectory of project. */
export function assertProjectSubdirectory(project, target, label) {
  const relative = path.relative(project, target)
  if (relative === '' || escapes(relative)) {
    throw new Error(`${label} must be a subdirectory of the project: ${target}`)
  }
}

export function validateProjectPaths(project, sourceDir, outputDir, stagingBase) {
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
