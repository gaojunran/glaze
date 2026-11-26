#!/usr/bin/env node
// Measures one mini-program page through minidev's automator.
//
// This is deliberately framework-agnostic: it only knows about the row and
// control selectors used by the fixtures in apps/. Start a minidev sim server
// first (see README.md), then run:
//
//   NODE_PATH=<minidev>/sdk node bench/frameworks/run.mjs \
//     --port 9440 --route /pages/home/index --neutral /pages/blank/index
//
// Glaze pages live inside a #app component boundary, so pass --root "#app"
// when measuring them.

import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const automator = require('minidev-automator')

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index === -1 ? fallback : args[index + 1]
}
const options = (name) => args.reduce(
  (values, arg, index) => (arg === `--${name}` ? [...values, args[index + 1]] : values),
  [],
)
const port = option('port', '9422')
const route = option('route')
const neutral = option('neutral')
const rootSelector = option('root')
const runs = Number(option('runs', '3'))
const rowCount = Number(option('count', '1000'))
const updateSelector = option('update')
const updateAllSelector = option('update-all')
const lastTextSelector = option('last-text', '#last')
const titleSelector = option('title', '#title')
const rowSelector = option('row', '.row')
const firstTextSelector = option('first-text', '.row-title')
const reverseSelector = option('reverse', '.reverse')
const bumpSelector = option('bump')
const tickSelector = option('tick', '#tick')
const toggleSelector = option('toggle')
const insertSelector = option('insert')
const deleteSelector = option('delete')
const doneSelector = option('done', '.row-done')
const lastTitle = option('last')
const timeout = Number(option('timeout', '120000'))
const warmSelector = option('warm')
const actionSpecs = options('action')
const precise = args.includes('--precise')

if (!route) {
  console.error('usage: node bench/frameworks/run.mjs --port 9440 --route /pages/home/index [--neutral /pages/blank/index] [--root "#app"] [--update "#update"] [--last "Row 999"] [--runs 3] [--precise]')
  process.exit(2)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(description, probe, limit = timeout) {
  const deadline = Date.now() + limit
  while (Date.now() < deadline) {
    const value = await probe()
    if (value) return value
    await sleep(50)
  }
  throw new Error(`timed out waiting for ${description}`)
}

async function measure(mp) {
  if (neutral) {
    await mp.reLaunch(neutral)
    const neutralPath = neutral.replace(/^\//, '')
    await waitFor(`neutral page ${neutral}`, async () => {
      const page = await mp.currentPage()
      return page && page.path === neutralPath
    })
  }

  const started = Date.now()
  await mp.reLaunch(route)
  const page = await mp.currentPage()
  const root = rootSelector ? await waitFor(rootSelector, () => page.$(rootSelector)) : page

  await waitFor(`${rowCount} rows`, async () => (await root.$$(rowSelector)).length === rowCount)
  const firstRow = async () => (await root.$$(rowSelector))[0]
  if (firstTextSelector) {
    const title = await waitFor('first row title', async () => {
      const row = await firstRow()
      return row && row.$(firstTextSelector)
    })
    await waitFor('first row text', async () => (await title.text()).length > 0)
  }

  const firstRender = Date.now() - started
  const controls = rootSelector ? root : page
  const frameResults = {}
  let preciseFrame = 0
  const preciseTap = async (selector, waitForResult, label) => {
    const button = await waitFor(selector, () => controls.$(selector))
    const key = `__glazeBench${Date.now()}${Math.random().toString(36).slice(2)}`
    await mp.evaluate(
      ({ root, key }) => {
        const current = getCurrentPages()[getCurrentPages().length - 1]
        const selected = root ? current.selectComponent(root) : null
        const target = selected && typeof selected.setData === 'function' ? selected : current
        if (!target || typeof target.setData !== 'function') {
          throw new Error(`no setData target for ${root ?? 'page'}`)
        }
        const original = target.setData
        const originalReplace = target.replaceDataOnPath
        const originalApply = target.applyDataUpdates
        const originalGroup = target.groupUpdates
        const records = []
        const acknowledge = (record) => {
          // Path APIs have no callback of their own. `wx.nextTick` runs after the
          // current data update; fall back to an empty setData when unavailable.
          const finish = () => {
            record.ms = performance.now() - record.start
            records.push(record)
          }
          const wxApi = globalThis.wx
          if (typeof wxApi?.nextTick === 'function') {
            wxApi.nextTick(finish)
          } else {
            original.call(target, {}, finish)
          }
        }
        target.setData = function (payload, callback) {
          const isFrameToken =
            payload !== null && typeof payload === 'object' && Object.keys(payload).length === 0
          const record = { start: performance.now(), kind: isFrameToken ? 'frame' : 'data' }
          records.push(record)
          return original.call(this, payload, () => {
            record.ms = performance.now() - record.start
            if (typeof callback === 'function') callback()
          })
        }
        // Grouped component transports do the work inside groupUpdates, while
        // page roots flush paths through applyDataUpdates.
        if (typeof originalGroup === 'function') {
          target.groupUpdates = function (run) {
            const record = { start: performance.now() }
            const result = originalGroup.call(this, () => run())
            acknowledge(record)
            return result
          }
        }
        // Page roots apply paths through replaceDataOnPath and a single
        // applyDataUpdates flush; no setData call would otherwise time them.
        let pathRecord = null
        if (typeof originalReplace === 'function') {
          target.replaceDataOnPath = function (path, value) {
            pathRecord ??= { start: performance.now() }
            return originalReplace.call(this, path, value)
          }
        }
        if (typeof originalApply === 'function') {
          target.applyDataUpdates = function (...args) {
            const record = pathRecord ?? { start: performance.now() }
            pathRecord = null
            try {
              return originalApply.apply(this, args)
            } finally {
              acknowledge(record)
            }
          }
        }
        globalThis[key] = { target, original, originalReplace, originalApply, originalGroup, records }
      },
      { root: rootSelector, key },
    )
    const started = Date.now()
    await button.tap()
    await waitFor(label, waitForResult)
    const times = await mp.evaluate(({ key }) => {
      const state = globalThis[key]
      if (!state) return []
      state.target.setData = state.original
      if (state.originalReplace) state.target.replaceDataOnPath = state.originalReplace
      if (state.originalApply) state.target.applyDataUpdates = state.originalApply
      if (state.originalGroup) state.target.groupUpdates = state.originalGroup
      delete globalThis[key]
      return state.records.map((record) => ({ ms: record.ms ?? 0, kind: record.kind ?? 'data' }))
    }, { key })
    const dataTimes = times.filter((record) => record.kind === 'data').map((record) => record.ms)
    preciseFrame = times.filter((record) => record.kind === 'frame').reduce((sum, record) => sum + record.ms, 0)
    return dataTimes.length > 0 ? dataTimes.reduce((sum, value) => sum + value, 0) : Date.now() - started
  }
  const tap = async (selector, waitForResult, label) => {
    if (precise) {
      const value = await preciseTap(selector, waitForResult, label)
      frameResults[label] = preciseFrame
      return value
    }
    const button = await waitFor(selector, () => controls.$(selector))
    const started = Date.now()
    await button.tap()
    await waitFor(label, waitForResult)
    return Date.now() - started
  }

  if (warmSelector) {
    const tick = await waitFor(tickSelector, () => controls.$(tickSelector))
    const before = await tick.text()
    const button = await waitFor(warmSelector, () => controls.$(warmSelector))
    await button.tap()
    await waitFor('warm-up tick', async () => (await (await controls.$(tickSelector)).text()) !== before)
  }

  let update
  if (updateSelector) {
    const before = await (await controls.$(titleSelector)).text()
    update = await tap(updateSelector, async () => {
      const current = await controls.$(titleSelector)
      return current && (await current.text()) !== before
    }, 'updated title')
  }

  let updateAll
  if (updateAllSelector) {
    const before = await (await controls.$(lastTextSelector)).text()
    updateAll = await tap(updateAllSelector, async () => {
      const current = await controls.$(lastTextSelector)
      return current && (await current.text()) !== before
    }, 'updated all titles')
  }

  let bump
  if (bumpSelector) {
    const before = await (await controls.$(tickSelector)).text()
    bump = await tap(bumpSelector, async () => {
      const current = await controls.$(tickSelector)
      return current && (await current.text()) !== before
    }, 'bumped tick')
  }

  let toggle
  if (toggleSelector) {
    const first = await firstRow()
    const before = await (await first.$(doneSelector)).text()
    toggle = await tap(toggleSelector, async () => {
      const row = await firstRow()
      const current = row && (await row.$(doneSelector))
      return current && (await current.text()) !== before
    }, 'toggled first row')
  }

  let insert
  if (insertSelector) {
    const before = (await root.$$(rowSelector)).length
    insert = await tap(insertSelector, async () => (await root.$$(rowSelector)).length === before + 1, 'inserted row')
  }

  let deleteRow
  if (deleteSelector) {
    const before = (await root.$$(rowSelector)).length
    deleteRow = await tap(deleteSelector, async () => (await root.$$(rowSelector)).length === before - 1, 'deleted row')
  }

  const actionResults = {}
  for (const spec of actionSpecs) {
    const [name, rest] = spec.split('=')
    const [selector, wait] = (rest ?? '').split(':')
    if (!name || !selector || !wait) throw new Error(`bad --action ${spec}`)
    if (wait.startsWith('count')) {
      const delta = Number(wait.slice(5))
      const before = (await root.$$(rowSelector)).length
      actionResults[name] = await tap(selector, async () => (
        (await root.$$(rowSelector)).length === before + delta
      ), `${name} row count`)
    } else {
      const before = await (await controls.$(wait)).text()
      actionResults[name] = await tap(selector, async () => (
        (await (await controls.$(wait)).text()) !== before
      ), `${name} value`)
    }
  }

  let reverseMs
  if (!args.includes('--skip-reverse')) {
    const reverse = await waitFor(reverseSelector, () => controls.$(reverseSelector))
    const reverseStarted = Date.now()
    await reverse.tap()
    await waitFor('reversed first row', async () => {
      const row = await firstRow()
      const text = row && firstTextSelector && (await (await row.$(firstTextSelector)).text())
      if (!text) return false
      return lastTitle ? text === lastTitle : text !== (await title.text())
    })
    reverseMs = Date.now() - reverseStarted
  }

  return { firstRender, bump, update, updateAll, toggle, insert, delete: deleteRow, reverse: reverseMs, ...actionResults, ...(precise ? { frame: frameResults } : {}) }
}

const mp = await automator.connect(`ws://127.0.0.1:${port}/automator`)
try {
  const results = []
  for (let index = 0; index < runs; index += 1) results.push(await measure(mp))
  console.log(JSON.stringify({ port, route, neutral: neutral ?? null, runs: results }, null, 2))
} finally {
  await mp.disconnect()
}
