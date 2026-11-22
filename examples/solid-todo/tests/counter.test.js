const { test, expect } = require('minidev-automator')

test('counter renders and updates through the compiled bindings', async (miniProgram) => {
  await miniProgram.reLaunch('/pages/index/index')
  const page = await miniProgram.currentPage()
  await page.waitFor(800)
  const app = await page.$('#app')
  if (!app) throw new Error('glaze-root not found')

  await expect(app).toMatchText('.title', 'Glaze + Solid')
  await expect(app).toMatchText('.count', '0')
  const camelInitial = await app.outerWxml()
  await expect(camelInitial).toContain('camel-label')
  await expect(camelInitial).toContain('zero')

  const buttons = await app.$$('.btn')
  await buttons[1].tap()
  await expect(app).toMatchText('.count', '1')

  for (let i = 0; i < 3; i += 1) await buttons[1].tap()
  await expect(app).toMatchText('.count', '4')
  await expect(app).toMatchText('.hint', 'count is greater than 3')
  await expect(app).toMatchText('.card-title', 'Todos')
  await expect(app).toMatchText('.slot-header', 'Slot header')
  await expect(app).toMatchText('.slot-body', 'Slot body')
  await expect(app).toMatchText('.show-keyed', 'idle')
  await expect(app).toMatchText('.unkeyed', 'a')
  await expect(app).toMatchText('.outer-in-for', 'ROW-a')
  await expect(app).toMatchText('.match-keyed', 'picked')
  await expect(app).toMatchText('.destructured', '1')
  await expect(app).toMatchText('.nested-title', 'Nested inline')
  const camelXml = await app.outerWxml()
  await expect(camelXml).toContain('camel-label')
  await expect(camelXml).toContain('positive')
  await expect(app).toMatchText('.badge', 'badge from relative import')
  await expect(app).toMatchText('.nested-repeat', '1')
  await expect(app).toMatchText('.nested-show', 'Compile Solid to WXML')
  await expect(app).toMatchText('.dot', '0')
  await expect(app).toMatchText('.empty-list', 'empty')
  await expect(app).toMatchText('.switch-idle', 'idle')
  const statusToggle = await app.$('.status-toggle')
  await statusToggle.tap()
  await expect(app).toMatchText('.switch-busy', 'busy')
  await expect(app).toMatchText('.show-keyed', 'busy')
  await statusToggle.tap()
  await expect(app).toMatchText('.switch-other', 'other')
  await expect(app).toMatchText('.show-keyed', 'other')
  await expect(app).toMatchText('.theme-label', 'dark')

  const refText = await (await app.$('.ref-width')).text()
  await expect(Number(refText)).toBeGreaterThan(0)

  const cells = await app.$$('.cell')
  await expect(cells.length).toBe(4)
  await cells[0].tap()
  await expect(app).toMatchText('.cell', 'a!')

  let xml = await app.outerWxml()
  await expect(xml).toContain('done="true" title="Compile Solid to WXML"')
  await expect(xml).toContain('done="true" title="Run in minidev"')
  await expect(xml).toContain('item-title done')

  const toggle = await app.$('.toggle')
  await toggle.tap()
  await page.waitFor(500)
  xml = await app.outerWxml()
  await expect(xml).toContain('done="false" title="Compile Solid to WXML"')
  await expect(xml).toContain('<text class="item-title">Compile Solid to WXML</text>')

  const append = await app.$('.append')
  await append.tap()
  await page.waitFor(500)
  xml = await app.outerWxml()
  await expect(xml).toContain('Appended')

  const removes = await app.$$('.remove')
  await removes[0].tap()
  await page.waitFor(500)
  xml = await app.outerWxml()
  await expect(xml.includes('Compile Solid to WXML')).toBe(false)
  await expect(xml).toContain('Run in minidev')

  const prepend = await app.$('.prepend')
  await prepend.tap()
  await page.waitFor(500)
  xml = await app.outerWxml()
  await expect(xml).toContain('Prepended')
})

test('review boundary probes render through the real page', async (miniProgram) => {
  await miniProgram.reLaunch('/pages/index/index')
  const page = await miniProgram.currentPage()
  await page.waitFor(800)
  const app = await page.$('#app')
  if (!app) throw new Error('glaze-root not found')

  await expect(app).toMatchText('.nested-show-nonkeyed', 'Compile Solid to WXML')
  await expect(app).toMatchText('.theme-direct', 'light')

  // PropProbe intentionally keeps a component boundary (it renders a slot), so
  // page-level selectors cannot see inside its shadow root. Check the host tag
  // attributes in the page WXML instead.
  const plus = await app.$$('.btn')
  await plus[1].tap()
  await page.waitFor(300)
  const xml = await app.outerWxml()
  await expect(xml).toContain('prop-probe')
  await expect(xml).toContain('count="3"')
  await expect(xml).toContain('label="probe"')
  await expect(xml).toContain('style="margin-top: 2"')
  await expect(xml).toContain('class="active"')
})

test('honors catch, capture and mut-bind event semantics', async (miniProgram) => {
  await miniProgram.reLaunch('/pages/index/index')
  const page = await miniProgram.currentPage()
  await page.waitFor(800)
  const app = await page.$('#app')
  if (!app) throw new Error('glaze-root not found')

  await (await app.$('.tap-inner')).tap()
  await expect(app).toMatchText('.tap-log', 'inner')

  await (await app.$('.capture-inner')).tap()
  await expect(app).toMatchText('.capture-log', 'CT')

  await (await app.$('.mut-inner')).tap()
  await expect(app).toMatchText('.mut-log', 'I')

  const catchHost = await app.$('.event-catch-host')
  await (await catchHost.$('.event-ping')).tap()
  await expect(app).toMatchText('.event-log', 'c')

  const captureHost = await app.$('.event-capture-host')
  await (await captureHost.$('.event-ping')).tap()
  await expect(app).toMatchText('.event-log', 'cp')
})

test('deep store state and object/array seams update through compiled bindings', async (miniProgram) => {
  await miniProgram.reLaunch('/pages/reactive/index')
  const page = await miniProgram.currentPage()
  await page.waitFor(800)
  const app = await page.$('#app')
  if (!app) throw new Error('glaze-root not found')

  await expect(app).toMatchText('.user-name', 'Ada')
  await expect(app).toMatchText('.user-city', 'London')
  await expect(app).toMatchText('.done-count', '0')
  await expect(app).toMatchText('.store-count', '0')
  await expect(app).toMatchText('.profile-age', '1')

  await (await app.$('.rename')).tap()
  await expect(app).toMatchText('.user-name', 'Grace')
  await expect(app).toMatchText('.renamed', 'renamed')

  await (await app.$('.move-city')).tap()
  await expect(app).toMatchText('.user-city', 'Paris')

  await (await app.$('.toggle-row')).tap()
  await expect(app).toMatchText('.done-count', '1')
  await expect(app).toMatchText('.store-row-state', 'done')

  await (await app.$('.retag-row')).tap()
  await expect(app).toMatchText('.store-row-tag', 'changed')

  await (await app.$('.push-row')).tap()
  await page.waitFor(300)
  await expect((await app.$$('.store-row')).length).toBe(3)
  await expect(app).toMatchText('.store-row-title', 'one')

  await (await app.$('.remove-row')).tap()
  await page.waitFor(300)
  await expect((await app.$$('.store-row')).length).toBe(2)

  await (await app.$('.bump-count')).tap()
  await expect(app).toMatchText('.store-count', '1')

  await (await app.$('.rename-item')).tap()
  await expect(app).toMatchText('.signal-row', 'alpha+')

  await (await app.$('.append-item')).tap()
  await page.waitFor(300)
  await expect((await app.$$('.signal-row')).length).toBe(3)

  await (await app.$('.age-profile')).tap()
  await expect(app).toMatchText('.profile-age', '2')
})

test('Tailwind utilities reach WXML and app.wxss', async (miniProgram) => {
  await miniProgram.reLaunch('/pages/tailwind/index')
  const page = await miniProgram.currentPage()
  await page.waitFor(800)
  const app = await page.$('#app')
  if (!app) throw new Error('glaze-root not found')

  await expect(app).toMatchText('.tw-title', 'Tailwind in Glaze')
  const xml = await app.outerWxml()
  await expect(xml).toContain('text-_b24rpx_B')
  await expect(xml).toContain('h-_b20rpx_B')
  await expect(xml).toContain('w-_b120rpx_B')

  const title = await app.$('.tw-title')
  const fontSize = await title.style('font-size')
  if (fontSize !== '12px') {
    throw new Error(`unexpected Tailwind font size: ${fontSize}`)
  }
  const padded = await app.$('.p-4')
  const paddingTop = await padded.style('padding-top')
  if (paddingTop !== '16px') {
    throw new Error(`unexpected Tailwind padding: ${paddingTop}`)
  }
})

test('cross-file context reaches a component boundary', async (miniProgram) => {
  await miniProgram.reLaunch('/pages/context/index')
  const page = await miniProgram.currentPage()
  await page.waitFor(800)
  const app = await page.$('#app')
  if (!app) throw new Error('glaze-root not found')
  await expect(app).toMatchText('.title', 'Context boundary')
  const xml = await app.outerWxml()
  await expect(xml).toContain('class="context-boundary">cross-file')
})

test('ref facade queries a child node inside the component', async (miniProgram) => {
  await miniProgram.reLaunch('/pages/index/index')
  const page = await miniProgram.currentPage()
  await page.waitFor(800)
  const app = await page.$('#app')
  if (!app) throw new Error('glaze-root not found')
  await (await app.$('.ref-query')).tap()
  await expect(app).toMatchText('.ref-query-result', /found:/)
})

test('async Loading and Errored boundaries render fallbacks and resolved values', async (miniProgram) => {
  await miniProgram.reLaunch('/pages/async/index')
  const page = await miniProgram.currentPage()
  await page.waitFor(1200)
  const app = await page.$('#app')
  if (!app) throw new Error('glaze-root not found')
  await expect(app).toMatchText('.title', 'Async boundaries')
  await expect(app).toMatchText('.async-value', 'async-ready')
  const fs = require('node:fs'); fs.writeFileSync('/tmp/opencode/async-app.xml', await app.outerWxml())
  await expect(app).toMatchText('.async-error', 'async-error')
})
