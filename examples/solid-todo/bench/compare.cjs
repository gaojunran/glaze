// Compare the compiled Solid page with the hand-written native page.
//
// Start `minidev sim serve` on port 9422 first, then:
//   NODE_PATH=<minidev>/sdk node examples/solid-todo/bench/compare.cjs
//
// The numbers include automator round-trips and page routing; use them to
// compare the two pages on the same machine, not as absolute render timings.

const automator = require('minidev-automator')

const PORT = process.env.GLAZE_PORT || '9422'
const ROWS = 1000
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function measure(mp, route, isGlaze) {
  const start = Date.now()
  await mp.reLaunch(route)
  const page = await mp.currentPage()
  let root = page

  if (isGlaze) {
    for (let i = 0; i < 100; i += 1) {
      root = await page.$('#app')
      if (root) break
      await wait(50)
    }
  }

  let rows = []
  for (let i = 0; i < 400; i += 1) {
    rows = await root.$$('.row')
    if (rows.length >= ROWS) break
    await wait(25)
  }
  const firstRender = Date.now() - start

  const before = await (await root.$('.tick')).text()
  const bump = await root.$('.bump')
  const updateStart = Date.now()
  await bump.tap()
  let after = before
  for (let i = 0; i < 200; i += 1) {
    after = await (await root.$('.tick')).text()
    if (after !== before) break
    await wait(10)
  }

  return {
    firstRender,
    update: Date.now() - updateStart,
    rows: rows.length,
    before,
    after,
  }
}

;(async () => {
  const mp = await automator.connect(`ws://127.0.0.1:${PORT}/automator`)
  for (const [label, route, isGlaze] of [
    ['glaze', '/pages/bench/index', true],
    ['native', '/pages/native/index', false],
  ]) {
    const runs = []
    for (let i = 0; i < 3; i += 1) runs.push(await measure(mp, route, isGlaze))
    console.log(label, JSON.stringify(runs))
  }
  await mp.disconnect()
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
