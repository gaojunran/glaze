#!/usr/bin/env node
import { buildProject } from './build.ts'
import { buildSnippet, defaultSnippetOut } from './snippet.ts'
import { watchProject } from './watch.ts'

const usage = `Usage: glaze <command> [options]

Commands:
  build [project]            Compile a Glaze project (default: current directory)
  watch [project]            Rebuild when source files change
  snippet <file.tsx>         Build a standalone project from one snippet file

Options:
  -h, --help                 Show this help
  -o, --out <dir>            Snippet output directory (default: <name>-snippet)
  --force                    Replace an existing snippet output directory`

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

const parseSnippetArgs = (argv: string[]) => {
  let source: string | undefined
  let out: string | undefined
  let force = false
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--force') {
      force = true
      continue
    }
    if (arg === '--out' || arg === '-o') {
      out = argv[index + 1]
      if (!out) throw new Error(`${arg} requires a directory`)
      index += 1
      continue
    }
    if (arg.startsWith('--out=')) {
      out = arg.slice('--out='.length)
      if (!out) throw new Error('--out requires a directory')
      continue
    }
    if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`)
    if (source) throw new Error(`Unexpected argument: ${arg}`)
    source = arg
  }
  if (!source) throw new Error('Missing snippet source file')
  return { source, out, force }
}

const report = (result: { pages: string[]; components: string[]; outputDir: string }) =>
  console.log(
    `glaze build: ${result.pages.length} pages, ${result.components.length} components -> ${result.outputDir}`,
  )

try {
  if (command === 'snippet') {
    const { source, out, force } = parseSnippetArgs(args.slice(1))
    const result = await buildSnippet(source, { out, force })
    console.log(
      `glaze snippet: ${result.pages.length} page, ${result.components.length} components -> ${result.outDir}`,
    )
    if (!out) {
      console.log(`glaze snippet: default output is ${defaultSnippetOut(source)}`)
    }
  } else if (command === 'build' || command === 'watch') {
    const project = args.slice(1).find((arg) => !arg.startsWith('-')) ?? process.cwd()
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
  } else {
    console.error(`Unknown command: ${command}`)
    console.error(usage)
    process.exit(1)
  }
} catch (error) {
  console.error((error as Error).message)
  process.exit(1)
}
