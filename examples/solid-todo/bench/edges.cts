// Edge-case comparison: Glaze routes vs hand-written native pages.
//
// Start `minidev sim serve` on port 9422 first, then:
//   NODE_PATH=<minidev>/sdk node examples/solid-todo/bench/edges.cts
//
// Four cases share one route per implementation:
//   deep  - 10 chains of 10 recursively nested components (100 nodes), leaf bump
//   form  - 20 independent scalar inputs, 10 characters typed into the last one
//   slot  - 100 card components with default slot content, one card text update
//   event - 100 row components with a custom event button, one click round-trip
//
// All four cases ship in one page, so `firstRender` is one page-level number:
// the time from `reLaunch` until the last case's content is present. Per-case
// first render is not separable without route reloads, and reloading a
// 100-component page per case made the automator session too slow to finish.
// Each update number is measured after that shared warm-up. The numbers include
// automator round-trips and page routing; use them to compare the two pages on
// the same machine, not as absolute render timings.

const automator = require('minidev-automator')

const PORT = process.env.GLAZE_PORT || '9422'
const RUNS = Number(process.env.GLAZE_RUNS || 3)
const NEUTRAL_ROUTE = '/pages/index/index'

const DEEP_LEVELS = 10
const DEEP_TOP = 10
const FIELD_COUNT = 20
const CARD_COUNT = 100
const EVENT_COUNT = 100
const TYPED = 'abcdefghij'

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function count(root, selector) {
  return (await root.$$(selector)).length
}

async function waitFor(description, probe, timeoutMs, interval = 50) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await probe()
    if (value) return value
    await wait(interval)
  }
  throw new Error(`timed out waiting for ${description}`)
}

async function waitForCount(root, selector, expected, timeoutMs) {
  return waitFor(
    `${expected} ${selector}`,
    async () => {
      const actual = await count(root, selector)
      return actual === expected ? actual : false
    },
    timeoutMs,
  )
}

async function waitForText(element, check, timeoutMs, description) {
  return waitFor(
    description,
    async () => {
      if (!element) return false
      const text = await element.text()
      return check(text) ? text : false
    },
    timeoutMs,
    10,
  )
}

async function descend(host, levels) {
  let current = host
  for (let index = 0; index < levels; index += 1) {
    const parent = current
    current = await waitFor(
      `deep level ${index + 1}`,
      async () => parent.$('.deep-host'),
      10000,
    )
  }
  return current
}

async function readCardText(root) {
  const host = (await root.$$('.slot-card-host'))[0]
  return (await host.$('.card-text')) ?? (await root.$('.card-text'))
}

async function waitForPage(mp, route, isGlaze) {
  const start = Date.now()
  await mp.reLaunch(route)
  const page = await mp.currentPage()
  const root = isGlaze
    ? await waitFor('#app', async () => page.$('#app'), 10000)
    : page

  // Deep: Glaze nests component hosts, native nests plain views.
  let deepCount
  let deepBump
  if (isGlaze) {
    await waitForCount(root, '.deep-host', DEEP_TOP, 120000)
    const firstChain = await descend((await root.$$('.deep-host'))[0], DEEP_LEVELS - 1)
    deepCount = await waitFor('deep leaf count', async () => firstChain.$('.deep-count'), 10000)
    deepBump = await waitFor('deep leaf bump', async () => firstChain.$('.deep-bump'), 10000)
  } else {
    await waitForCount(root, '.deep-node', DEEP_TOP * DEEP_LEVELS, 120000)
    const counts = await root.$$('.deep-count')
    const bumps = await root.$$('.deep-bump')
    deepCount = await waitFor('deep leaf count', async () => counts.at(-1), 10000)
    deepBump = await waitFor('deep leaf bump', async () => bumps.at(-1), 10000)
  }
  await waitForText(deepCount, () => true, 10000, 'deep leaf count text')

  // Form.
  await waitForCount(root, '.field-input', FIELD_COUNT, 120000)
  const mirror = await waitFor('field mirror', async () => root.$('.field-mirror'), 10000)

  // Slot.
  await waitForCount(root, '.slot-card-host', CARD_COUNT, 120000)
  const cardText = await waitFor('first card text', () => readCardText(root), 10000)
  await waitForText(cardText, () => true, 10000, 'card text')

  // Custom event row.
  await waitForCount(root, '.event-row-host', EVENT_COUNT, 120000)
  const pick = await waitFor('first pick button', async () => (await root.$$('.event-row-host'))[0].$('.pick'), 10000)
  const rowCount = await waitFor(
    'first event count',
    async () => (await root.$$('.event-row-host'))[0].$('.event-count'),
    10000,
  )
  const pickedElement = await waitFor('picked text', async () => root.$('.picked'), 10000)
  await waitForText(pickedElement, () => true, 10000, 'picked text')

  return {
    root,
    firstRender: Date.now() - start,
    deepCount,
    deepBump,
    mirror,
    pick,
    rowCount,
    pickedElement,
  }
}

async function measure(mp, route, isGlaze) {
  const ready = await waitForPage(mp, route, isGlaze)
  const { root } = ready

  // Deep leaf update.
  const deepBefore = await ready.deepCount.text()
  const deepStart = Date.now()
  await ready.deepBump.tap()
  const deepAfter = await waitForText(
    ready.deepCount,
    (text) => text !== deepBefore,
    20000,
    'deep leaf update',
  )
  const deep = Date.now() - deepStart

  // One card text update through parent state. Do this before typing so the
  // focused input cannot swallow the button tap.
  const cardBefore = await (await readCardText(root)).text()
  const slotStart = Date.now()
  await (await root.$('.update-card')).tap()
  const cardAfter = await waitFor(
    'card text update',
    async () => {
      const text = await (await readCardText(root)).text()
      return text !== cardBefore ? text : false
    },
    20000,
  )
  const slot = Date.now() - slotStart

  // One custom-event click round-trip.
  const clickedBefore = await ready.pickedElement.text()
  const rowBefore = await ready.rowCount.text()
  const clickStart = Date.now()
  await ready.pick.tap()
  const clickedAfter = await waitForText(
    ready.pickedElement,
    (text) => text !== clickedBefore,
    20000,
    'picked update',
  )
  const rowAfter = await waitForText(
    ready.rowCount,
    (text) => text !== rowBefore,
    20000,
    'row count update',
  )
  const event = Date.now() - clickStart

  // Form typing last: the input keeps focus, so run it after the taps.
  const inputs = await root.$$('.field-input')
  const target = inputs.at(-1)
  let buffer = (await target.value()) ?? ''
  const typingStart = Date.now()
  for (const character of TYPED) {
    buffer += character
    await target.input(buffer)
  }
  await waitForText(ready.mirror, (text) => text === buffer, 20000, 'typed mirror')
  const typing = Date.now() - typingStart

  return {
    firstRender: ready.firstRender,
    deep: { update: deep, nodes: DEEP_TOP * DEEP_LEVELS, before: deepBefore, after: deepAfter },
    form: {
      typing,
      fields: inputs.length,
      keystrokes: TYPED.length,
      value: await target.value(),
      mirror: await ready.mirror.text(),
      // setData counts are not exposed through the automator, so the number of
      // field updates is not observable; keystrokes is the upper bound.
    },
    slot: { update: slot, cards: CARD_COUNT, before: cardBefore, after: cardAfter },
    event: { click: event, rows: EVENT_COUNT, before: clickedBefore, after: clickedAfter, rowBefore, rowAfter },
  }
}

;(async () => {
  const mp = await automator.connect(`ws://127.0.0.1:${PORT}/automator`)
  for (const [label, route, isGlaze] of [
    ['glaze', '/pages/bench-edges/index', true],
    ['native', '/pages/native-edges/index', false],
  ]) {
    const runs = []
    for (let index = 0; index < RUNS; index += 1) {
      // A neutral reLaunch keeps the previous run from satisfying a readiness
      // wait. It is outside every timed interval.
      await mp.reLaunch(NEUTRAL_ROUTE)
      const neutral = await mp.currentPage()
      await waitFor('neutral page', async () => neutral.$('#app'), 10000)
      try {
        runs.push(await measure(mp, route, isGlaze))
      } catch (error) {
        throw new Error(`${label} run ${index}: ${error.message}`)
      }
    }
    console.log(JSON.stringify({ label, route, runs }))
  }
  await mp.disconnect()
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
