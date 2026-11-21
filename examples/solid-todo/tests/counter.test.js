const { test, expect } = require('minidev-automator')

test('counter renders and updates through the compiled bindings', async (miniProgram) => {
  await miniProgram.reLaunch('/pages/index/index')
  const page = await miniProgram.currentPage()
  await page.waitFor(800)
  const app = await page.$('#app')
  if (!app) throw new Error('glaze-root not found')

  await expect(app).toMatchText('.title', 'Glaze + Solid')
  await expect(app).toMatchText('.count', '0')

  const buttons = await app.$$('.btn')
  await buttons[1].tap()
  await expect(app).toMatchText('.count', '1')

  for (let i = 0; i < 3; i += 1) await buttons[1].tap()
  await expect(app).toMatchText('.count', '4')
  await expect(app).toMatchText('.hint', 'count is greater than 3')

  let xml = await app.outerWxml()
  await expect(xml).toContain('done="true" title="Compile Solid to WXML"')
  await expect(xml).toContain('item-title done')

  const toggle = await app.$('.toggle')
  await toggle.tap()
  await page.waitFor(500)
  xml = await app.outerWxml()
  await expect(xml).toContain('done="false" title="Compile Solid to WXML"')
  await expect(xml).toContain('<text class="item-title">Compile Solid to WXML</text>')

  const removes = await app.$$('.remove')
  await removes[0].tap()
  await page.waitFor(500)
  xml = await app.outerWxml()
  await expect(xml.includes('Compile Solid to WXML')).toBe(false)
  await expect(xml).toContain('Run in minidev')
})
