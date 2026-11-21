import { buildProject } from '@glaze/build'

/**
 * Vite integration for Glaze.
 *
 * The plugin does not pass Solid code through Vite's renderer pipeline: the
 * mini-program output is produced by `@glaze/build`. This keeps Vite useful for
 * an accompanying web preview while the WXML/WXSS/JS artifacts stay in sync.
 */
export default function glaze(options = {}) {
  let project = options.project ?? process.cwd()
  const enabled = options.build !== false

  return {
    name: 'glaze',
    enforce: 'pre',
    configResolved(config) {
      if (!options.project && config.root) project = config.root
    },
    async buildStart() {
      if (enabled) await buildProject(project)
    },
    async handleHotUpdate(context) {
      if (!enabled || !/\.[jt]sx?$/.test(context.file)) return
      await buildProject(project)
    },
  }
}
