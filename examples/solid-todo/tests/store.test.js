const { test, expect } = require('minidev-automator')

test('a shared store stays in sync across component boundaries', async (miniProgram) => {
  await miniProgram.reLaunch('/pages/store/index')
  const page = await miniProgram.currentPage()
  await page.waitFor(800)
  const app = await page.$('#app')
  if (!app) throw new Error('glaze-root not found')

  // The panel is a real component boundary; page selectors do not cross its
  // shadow root, so read its rendered text from the serialized tree.
  const panelCount = async (value) => {
    await expect(await app.outerWxml()).toContain(`class="store-panel-count">${value}<`)
  }

  await expect(app).toMatchText('.store-count', '2')
  await panelCount('2')
  await expect(app).toMatchText('.store-remaining', '1')

  await (await app.$('.store-add')).tap()
  await expect(app).toMatchText('.store-count', '3')
  await panelCount('3')
  await expect(app).toMatchText('.store-remaining', '2')

  await (await app.$('.store-add')).tap()
  await expect(app).toMatchText('.store-count', '4')
  await panelCount('4')
  await expect(app).toMatchText('.store-remaining', '3')

  const rows = await app.$$('.store-row')
  if (rows.length !== 4) throw new Error(`expected 4 store rows, got ${rows.length}`)
  await (await app.$('.store-toggle')).tap()
  await expect(app).toMatchText('.store-remaining', '2')
  await expect(app).toMatchText('.store-row-state', 'done')

  await (await app.$('.store-clear')).tap()
  await expect(app).toMatchText('.store-count', '2')
  await panelCount('2')
  await expect(app).toMatchText('.store-empty', '')
})
