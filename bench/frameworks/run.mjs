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
const updateSelector = option('update')
const titleSelector = option('title', '#title')
const reverseSelector = option('reverse', '.reverse')
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

  await waitFor('1000 rows', async () => (await root.$$('.row')).length === 1000)
  const firstRow = async () => (await root.$$('.row'))[0]
  const title = await waitFor('first row title', async () => {
    const row = await firstRow()
    return row && row.$('.row-title')
  })
  await waitFor('first row text', async () => (await title.text()).length > 0)

  const firstRender = Date.now() - started
  let update
  if (updateSelector) {
    const before = await (await page.$(titleSelector)).text()
    const button = await waitFor(updateSelector, () => page.$(updateSelector))
    const updateStarted = Date.now()
    await button.tap()
    await waitFor('updated title', async () => {
      const current = await page.$(titleSelector)
      return current && (await current.text()) !== before
    })
    update = Date.now() - updateStarted
  }

  const reverse = await waitFor(reverseSelector, () => root.$(reverseSelector))
  const reverseStarted = Date.now()
  await reverse.tap()
  await waitFor('reversed first row', async () => {
    const row = await firstRow()
    const text = row && (await (await row.$('.row-title')).text())
    if (!text) return false
    return lastTitle ? text === lastTitle : text !== (await title.text())
  })
  const reverseMs = Date.now() - reverseStarted

  return { firstRender, update, reverse: reverseMs }
}

const mp = await automator.connect(`ws://127.0.0.1:${port}/automator`)
try {
  const results = []
  for (let index = 0; index < runs; index += 1) results.push(await measure(mp))
  console.log(JSON.stringify({ port, route, neutral: neutral ?? null, runs: results }, null, 2))
} finally {
  await mp.disconnect()
}
