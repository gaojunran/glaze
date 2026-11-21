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
  await expect(app).toMatchText('.item', 'Compile Solid to WXML')
})
