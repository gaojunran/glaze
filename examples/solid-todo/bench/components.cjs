// Component-dense comparison: Glaze routes vs hand-written native components.
//
// Start `minidev sim serve` on port 9422 first, then:
//   NODE_PATH=<minidev>/sdk node examples/solid-todo/bench/components.cjs
//
// Both routes render 1000 pure row components and 1000 stateful row components.
// Each row is a real custom component with its own shadow root, so the page-level
// selectors stop at the component host. Count rows by the host class
// (`.pure-row` / `.state-row`) and read inside a host with element-scoped
// selectors (`.pure-title`, `.state-count`, ...).
//
// The numbers include automator round-trips and page routing; use them to
// compare the two pages on the same machine, not as absolute render timings.

const automator = require('minidev-automator')

const PORT = process.env.GLAZE_PORT || '9422'
const RUNS = Number(process.env.GLAZE_RUNS || 3)
const ROWS = 1000
const NEUTRAL_ROUTE = '/pages/index/index'

const PURE_ROW = '.pure-row'
const STATE_ROW = '.state-row'

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
  return waitFor(`${expected} ${selector}`, async () => {
    const actual = await count(root, selector)
    return actual === expected ? actual : false
  }, timeoutMs)
}

async function waitForText(element, check, timeoutMs, description) {
  return waitFor(description, async () => {
    if (!element) return false
    const text = await element.text()
    return check(text) ? text : false
  }, timeoutMs, 10)
}

async function measure(mp, route, isGlaze) {
  const start = Date.now()
  await mp.reLaunch(route)
  const page = await mp.currentPage()
  let root = page

  if (isGlaze) {
    root = await waitFor('#app', async () => page.$('#app'), 10000)
  }

  await waitForCount(root, PURE_ROW, ROWS, 120000)
  await waitForCount(root, STATE_ROW, ROWS, 120000)
  const pureHost = await root.$(PURE_ROW)
  const stateHost = await root.$(STATE_ROW)
  const pureTitle = await waitFor('first pure title', async () => pureHost.$('.pure-title'), 10000)
  const stateTitle = await waitFor('first state title', async () => stateHost.$('.state-title'), 10000)
  await waitForText(pureTitle, () => true, 10000, 'first pure title text')
  await waitForText(stateTitle, () => true, 10000, 'first state title text')

  const firstRender = Date.now() - start
  const initialRows = await count(root, PURE_ROW)
  const initialStateRows = await count(root, STATE_ROW)

  // A previous run can surface `done` on the first row before the new tree
  // settles. Normalize it outside the timed update so each run starts from todo.
  const readPureState = async () => {
    const host = await root.$(PURE_ROW)
    const element = await host.$('.pure-state')
    return element.text()
  }
  let beforeUpdate = await readPureState()
  if (beforeUpdate !== 'todo') {
    await (await root.$('.update-row')).tap()
    await waitFor('reset first row', async () => (await readPureState()) === 'todo', 20000)
    beforeUpdate = await readPureState()
  }
  const updateHost = await root.$(PURE_ROW)
  const pureState = await updateHost.$('.pure-state')
  const updateStart = Date.now()
  await (await root.$('.update-row')).tap()
  const afterUpdate = await waitForText(
    pureState,
    (text) => text !== beforeUpdate,
    20000,
    'updated pure state',
  )
  const update = Date.now() - updateStart

  const stateCount = await stateHost.$('.state-count')
  const beforeClicks = await waitForText(stateCount, () => true, 10000, 'initial click count')
  const stateStart = Date.now()
  await (await stateHost.$('.state-bump')).tap()
  const afterClicks = await waitForText(stateCount, (text) => text === '1', 20000, 'click count 1')
  const stateClick = Date.now() - stateStart

  const appendStart = Date.now()
  await (await root.$('.append-row')).tap()
  await waitForCount(root, PURE_ROW, ROWS + 1, 30000)
  const append = Date.now() - appendStart

  const deleteStart = Date.now()
  await (await root.$('.delete-row')).tap()
  await waitForCount(root, PURE_ROW, ROWS, 30000)
  const remove = Date.now() - deleteStart

  return {
    firstRender,
    update,
    stateClick,
    append,
    delete: remove,
    counts: {
      pureRows: initialRows,
      stateRows: initialStateRows,
      afterAppend: ROWS + 1,
      afterDelete: ROWS,
    },
    beforeUpdate,
    afterUpdate,
    beforeClicks,
    afterClicks,
  }
}

;(async () => {
  const mp = await automator.connect(`ws://127.0.0.1:${PORT}/automator`)
  for (const [label, route, isGlaze] of [
    ['glaze', '/pages/bench-components/index', true],
    ['native', '/pages/native-components/index', false],
  ]) {
    const runs = []
    for (let i = 0; i < RUNS; i += 1) {
      // ReLaunch to a neutral page first so the previous run cannot satisfy the
      // row-count wait with its still-mounted DOM. This reLaunch is not timed.
      await mp.reLaunch(NEUTRAL_ROUTE)
      const neutral = await mp.currentPage()
      await waitFor('neutral page', async () => neutral.$('#app'), 10000)
      runs.push(await measure(mp, route, isGlaze))
    }
    console.log(JSON.stringify({ label, route, runs }))
  }
  await mp.disconnect()
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
