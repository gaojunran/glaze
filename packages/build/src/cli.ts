#!/usr/bin/env node
import { buildProject } from './build.ts'
import { watchProject } from './watch.ts'

const usage = `Usage: glaze <command> [project]

Commands:
  build [project]   Compile a Glaze project (default: current directory)
  watch [project]   Rebuild when source files change

Options:
  -h, --help        Show this help`

const args = process.argv.slice(2)
if (args.includes('--help') || args.includes('-h')) {
  console.log(usage)
  process.exit(0)
}

const command = args[0]
if (!command) {
  console.error('Missing command')
  console.error(usage)
  process.exit(1)
}

const projectArg = args.slice(1).find((arg) => !arg.startsWith('--'))
const project = projectArg ?? process.cwd()

if (command !== 'build' && command !== 'watch') {
  console.error(`Unknown command: ${command}`)
  console.error(usage)
  process.exit(1)
}

const report = (result: { pages: string[]; components: string[]; outputDir: string }) =>
  console.log(
    `glaze build: ${result.pages.length} pages, ${result.components.length} components -> ${result.outputDir}`,
  )

try {
  if (command === 'build') {
    report(await buildProject(project))
  } else {
    const watched = await watchProject(project, {
      onBuild: report,
      onError: (error: Error) => console.error(`glaze watch failed: ${error.message}`),
    })
    console.log('glaze watch: waiting for changes (Ctrl+C to stop)')
    process.on('SIGINT', () => {
      watched.close()
      process.exit(0)
    })
  }
} catch (error) {
  console.error((error as Error).message)
  process.exit(1)
}
