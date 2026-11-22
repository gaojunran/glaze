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
const port = option('port', '9422')
const route = option('route')
const neutral = option('neutral')
const rootSelector = option('root')
const runs = Number(option('runs', '3'))
const rowCount = Number(option('count', '1000'))
const updateSelector = option('update')
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

if (!route) {
  console.error('usage: node bench/frameworks/run.mjs --port 9440 --route /pages/home/index [--neutral /pages/blank/index] [--root "#app"] [--update "#update"] [--last "Row 999"] [--runs 3]')
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
  const tap = async (selector, waitForResult, label) => {
    const button = await waitFor(selector, () => controls.$(selector))
    const started = Date.now()
    await button.tap()
    await waitFor(label, waitForResult)
    return Date.now() - started
  }

  let update
  if (updateSelector) {
    const before = await (await controls.$(titleSelector)).text()
    update = await tap(updateSelector, async () => {
      const current = await controls.$(titleSelector)
      return current && (await current.text()) !== before
    }, 'updated title')
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

  return { firstRender, bump, update, toggle, insert, delete: deleteRow, reverse: reverseMs }
}

const mp = await automator.connect(`ws://127.0.0.1:${port}/automator`)
try {
  const results = []
  for (let index = 0; index < runs; index += 1) results.push(await measure(mp))
  console.log(JSON.stringify({ port, route, neutral: neutral ?? null, runs: results }, null, 2))
} finally {
  await mp.disconnect()
}
