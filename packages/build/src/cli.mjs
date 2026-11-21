#!/usr/bin/env node
import { buildProject } from './build.mjs'

const args = process.argv.slice(2)
const command = args[0] ?? 'build'
const projectArg = args.find((arg) => !arg.startsWith('--'))
const project = projectArg && projectArg !== 'build' ? projectArg : process.cwd()

if (command !== 'build') {
  console.error(`Unknown command: ${command}`)
  console.error('Usage: glaze build [project]')
  process.exit(1)
}

try {
  const result = await buildProject(project)
  console.log(
    `glaze build: ${result.pages.length} pages, ${result.components.length} components -> ${result.outputDir}`,
  )
} catch (error) {
  console.error(`glaze build failed: ${error.message}`)
  process.exit(1)
}
