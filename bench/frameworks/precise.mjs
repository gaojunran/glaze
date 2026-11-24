#!/usr/bin/env node
// Precise in-appservice timing for the prop-shape pages. The automator
// `waitFor` path in run.mjs is limited by its 50ms polling loop, so it cannot
// separate sub-100ms updates. This probe installs a `setData` wrapper inside
// the appservice, invokes the page's update method, and reports the measured
// callback time directly.
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const automator = require('minidev-automator')

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index === -1 ? fallback : args[index + 1]
}

const suite = option('suite')
const port = option('port')
const route = option('route')
const rootSelector = option('root', '')
const action = option('action', 'updateAll')
const eventIndex = Number(option('event-index', '1'))
const runs = Number(option('runs', '5'))
const timeout = Number(option('timeout', '120000'))

if (!suite || !port || !route) {
  console.error(
    'usage: precise.mjs --suite glaze|native|uni --port 9440 ' +
      '--route /pages/bench-props-1/index [--root #app] [--runs 5]',
  )
  process.exit(2)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const mp = await automator.connect(`ws://127.0.0.1:${port}/automator`)

for (let run = 0; run < runs; run += 1) {
  await mp.reLaunch(route)
  await sleep(2000)
  const result = await Promise.race([
    mp.evaluate(
      (config) => {
        const page = getCurrentPages()[getCurrentPages().length - 1]
        const target = config.rootSelector
          ? page.selectComponent(config.rootSelector)
          : page
        if (!target || typeof target.setData !== 'function') {
          throw new Error(`no setData target for ${config.suite}`)
        }
        const original = target.setData
        const records = []
        target.setData = function (payload, callback) {
          const record = { keys: Object.keys(payload).length, start: performance.now() }
          records.push(record)
          return original.call(this, payload, () => {
            record.ms = performance.now() - record.start
            if (typeof callback === 'function') callback()
          })
        }
        const started = performance.now()
        if (config.suite === 'glaze') {
          target.__glaze.events[config.eventIndex]({})
        } else if (config.suite === 'uni') {
          target.$vm[config.action]()
        } else {
          target[config.action]()
        }
        return new Promise((resolve) => {
          setTimeout(() => {
            target.setData = original
            const last = config.suite === 'glaze' ? target.data?.b0 : target.data?.a
            resolve({ records, last, elapsed: performance.now() - started })
          }, 400)
        })
      },
      { suite, rootSelector, action, eventIndex },
    ),
    sleep(timeout).then(() => {
      throw new Error(`precise measurement timed out for ${suite} ${route}`)
    }),
  ])
  console.log(JSON.stringify({ suite, route, run, ...result }))
}

await mp.disconnect()
