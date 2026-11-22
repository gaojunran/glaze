import { existsSync, watch } from 'node:fs'
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

  const isIgnored = (name) => {
    if (name.includes('.tmp')) return true
    if (currentConfig.output && name.includes(currentConfig.output)) return true
    return !/\.(tsx?|jsx?|mjs|json|wxml|wxss|css)$/.test(name)
  }

  const schedule = () => {
    if (closed) return
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
            if (!filename) {
              schedule()
              return
            }
            if (isIgnored(filename.toString())) return
            schedule()
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
    try {
      const result = await buildProject(project)
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

