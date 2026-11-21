#!/usr/bin/env node
import { buildProject, watchProject } from './build.mjs'

const args = process.argv.slice(2)
const command = args[0] ?? 'build'
const projectArg = args.slice(1).find((arg) => !arg.startsWith('--'))
const project = projectArg ?? process.cwd()

if (command !== 'build' && command !== 'watch') {
  console.error(`Unknown command: ${command}`)
  console.error('Usage: glaze build [project] | glaze watch [project]')
  process.exit(1)
}

const report = (result) =>
  console.log(
    `glaze build: ${result.pages.length} pages, ${result.components.length} components -> ${result.outputDir}`,
  )

try {
  if (command === 'build') {
    report(await buildProject(project))
  } else {
    const watched = await watchProject(project, {
      onBuild: report,
      onError: (error) => console.error(`glaze watch failed: ${error.message}`),
    })
    console.log('glaze watch: waiting for changes (Ctrl+C to stop)')
    process.on('SIGINT', () => {
      watched.close()
      process.exit(0)
    })
  }
} catch (error) {
  console.error(`glaze ${command} failed: ${error.message}`)
  process.exit(1)
}
