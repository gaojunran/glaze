export { buildProject } from './build.ts'
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
} from './config.ts'
