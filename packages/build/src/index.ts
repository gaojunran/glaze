export { buildProject } from './build.ts'
export { buildSnippet, defaultSnippetOut, parseSnippetSource } from './snippet.ts'
export type { GlazeSnippetConfig, SnippetBuildResult } from './snippet.ts'
export { watchProject } from './watch.ts'
export {
  normalizeSourcePath,
  outputNameForRelative,
  validateProjectPaths,
} from './paths.ts'
export { loadConfig } from './config.ts'
export type {
  GlazeConfig,
  GlazeCssConfig,
  GlazeTailwindConfig,
  GlazeSubpackage,
  GlazeStaticEntry,
} from './config.ts'
