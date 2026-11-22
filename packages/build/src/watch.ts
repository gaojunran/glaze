import { existsSync, statSync, watch } from 'node:fs'
import path from 'node:path'
import { configFileFor, loadConfig } from './config.ts'
import { buildProject } from './build.ts'

export async function watchProject(projectPath = process.cwd(), options: any = {}) {
  const project = path.resolve(projectPath)
  let currentConfig = await loadConfig(project)

  const watchers = new Map()
  let timer = null
  let building = false
  let pending = false
  let closed = false
  let changed = new Set<string>()

  const isIgnored = (base, name) => {
    const full = path.resolve(base, name.toString())
    const output = currentConfig.output ? path.resolve(project, currentConfig.output) : null
    if (full === output || (output && full.startsWith(`${output}${path.sep}`))) return true
    if (full.split(path.sep).includes('.tmp')) return true
    return !/\.(tsx?|jsx?|mjs|mts|cts|json|wxml|wxss|scss|less|css)$/.test(name.toString())
  }

  const schedule = (filename?: string, base = project) => {
    if (closed) return
    if (filename) changed.add(path.resolve(base, filename.toString()))
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      run()
    }, 100)
  }

  const syncWatchers = (config) => {
    currentConfig = config
    const desired = new Set<string>()
    const sourceDir = path.join(project, config.source)
    desired.add(existsSync(sourceDir) ? sourceDir : project)
    const configFile = configFileFor(project)
    if (configFile) desired.add(configFile)
    if (config.css?.tailwind?.input) {
      const input = path.resolve(project, config.css.tailwind.input)
      desired.add(existsSync(input) ? input : path.dirname(input))
    }

    for (const [target, watcher] of watchers) {
      if (!desired.has(target)) {
        watcher.close()
        watchers.delete(target)
      }
    }
    for (const target of desired) {
      if (watchers.has(target)) continue
      try {
        watchers.set(
          target,
          watch(target, { recursive: true }, (_event, filename) => {
            let base = target
            try {
              if (!statSync(target).isDirectory()) base = path.dirname(target)
            } catch {
              base = path.dirname(target)
            }
            if (!filename) {
              schedule(undefined, base)
              return
            }
            if (isIgnored(base, filename.toString())) return
            schedule(filename.toString(), base)
          }),
        )
      } catch {
        // The target may not exist yet; the next build retries.
      }
    }
  }

  const run = async () => {
    if (closed) return
    if (building) {
      pending = true
      return
    }
    building = true
    const changedFiles = changed.size > 0 ? [...changed] : null
    changed = new Set()
    try {
      const result = await buildProject(
        project,
        changedFiles ? { changedFiles } : {},
      )
      syncWatchers(result.config)
      options.onBuild?.(result)
    } catch (error) {
      try {
        syncWatchers(await loadConfig(project))
      } catch {
        // Keep the previous watchers if the new config cannot be loaded.
      }
      options.onError?.(error)
    } finally {
      building = false
      if (pending) {
        pending = false
        run()
      }
    }
  }

  await run()

  return {
    close() {
      closed = true
      if (timer) clearTimeout(timer)
      for (const watcher of watchers.values()) watcher.close()
    },
  }
}

