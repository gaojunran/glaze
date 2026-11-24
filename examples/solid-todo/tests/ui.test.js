const { test, expect } = require('minidev-automator')

test('native UI components render and update', async (miniProgram) => {
  await miniProgram.reLaunch('/pages/ui/index')
  const page = await miniProgram.currentPage()
  await page.waitFor(800)
  const app = await page.$('#app')
  if (!app) throw new Error('glaze-page root not found')

  await expect(app).toMatchText('.ui-title', 'UI SDK port')
  await expect(app).toMatchText('.ui-click-count', '0')

  const incrementHost = await app.$('#ui-increment')
  const increment = await incrementHost.$('.glaze-button')
  await increment.tap()
  await expect(app).toMatchText('.ui-click-count', '1')
  await increment.tap()
  await expect(app).toMatchText('.ui-click-count', '2')

  await expect(app).toMatchText('.ui-toggle-state', 'released')
  const toggleHost = await app.$('#ui-toggle')
  const toggle = await toggleHost.$('.glaze-toggle')
  await toggle.tap()
  await expect(app).toMatchText('.ui-toggle-state', 'pressed')
  let xml = await app.outerWxml()
  await expect(xml).toContain('aria-pressed="true"')
  await toggle.tap()
  await expect(app).toMatchText('.ui-toggle-state', 'released')

  await expect(app).toMatchText('.ui-switch-state', 'on')
  const switchHost = await app.$('#ui-switch')
  const control = await switchHost.$('.glaze-switch')
  await control.tap()
  await expect(app).toMatchText('.ui-switch-state', 'off')
  xml = await app.outerWxml()
  await expect(xml).toContain('aria-checked="false"')

  const inputHost = await app.$('#ui-input')
  const input = await inputHost.$('.glaze-input')
  await input.trigger('input', { value: 'Grace' })
  await expect(app).toMatchText('.ui-name', 'Grace')
  await input.trigger('input', { value: '' })
  await expect(app).toMatchText('.ui-name', '')
  const field = await app.$('#ui-field')
  await expect(field).toMatchText('.glaze-field__error', 'Name is required')

  await expect(app).toMatchText('.ui-loading-state', 'idle')
  const toggleLoadingHost = await app.$('#ui-toggle-loading')
  const toggleLoading = await toggleLoadingHost.$('.glaze-button')
  await toggleLoading.tap()
  await expect(app).toMatchText('.ui-loading-state', 'loading')

  const uncontrolledToggleHost = await app.$('#ui-toggle-uncontrolled')
  const uncontrolledToggle = await uncontrolledToggleHost.$('.glaze-toggle')
  if ((await uncontrolledToggle.attribute('data-state')) !== 'on') {
    throw new Error('uncontrolled toggle did not start pressed')
  }
  await uncontrolledToggle.tap()
  await page.waitFor(200)
  if ((await uncontrolledToggle.attribute('data-state')) !== 'off') {
    throw new Error('uncontrolled toggle did not change')
  }

  const uncontrolledSwitchHost = await app.$('#ui-switch-uncontrolled')
  const uncontrolledSwitch = await uncontrolledSwitchHost.$('.glaze-switch')
  if ((await uncontrolledSwitch.attribute('data-state')) !== 'checked') {
    throw new Error('uncontrolled switch did not start checked')
  }
  await uncontrolledSwitch.tap()
  await page.waitFor(200)
  if ((await uncontrolledSwitch.attribute('data-state')) !== 'unchecked') {
    throw new Error('uncontrolled switch did not change')
  }

  await miniProgram.pageScrollTo(600)
  await page.waitFor(200)
  const checkboxHost = await app.$('#ui-checkbox')
  const checkbox = await checkboxHost.$('.glaze-checkbox')
  if ((await checkbox.attribute('data-state')) !== 'checked') {
    throw new Error('checkbox did not start checked')
  }
  await checkbox.tap()
  await expect(app).toMatchText('.ui-checkbox-state', 'unchecked')

  const radioHost = await app.$('#ui-radio-pro')
  await (await radioHost.$('.glaze-radio')).tap()
  await expect(app).toMatchText('.ui-plan-state', 'pro')

  await miniProgram.pageScrollTo(900)
  await page.waitFor(200)
  const tabsHost = await app.$('#ui-tabs')
  const triggers = await tabsHost.$$('.glaze-tabs__trigger')
  if (triggers.length !== 3) throw new Error(`expected three tabs, got ${triggers.length}`)
  await triggers[1].tap()
  await expect(app).toMatchText('.ui-tab-state', 'billing')

  await miniProgram.pageScrollTo(1200)
  await page.waitFor(200)
  const collapsibleHost = await app.$('#ui-collapsible')
  if (!(await collapsibleHost.$('.glaze-collapsible__content'))) {
    throw new Error('collapsible did not start open')
  }
  await (await collapsibleHost.$('.glaze-collapsible__trigger')).tap()
  await page.waitFor(200)
  const closedCollapsible = await app.$('#ui-collapsible')
  if (await closedCollapsible.$('.glaze-collapsible__content')) {
    throw new Error('collapsible did not close')
  }

  const dialogHost = await app.$('#ui-dialog')
  const openDialogHost = await app.$('#ui-dialog-open')
  await miniProgram.pageScrollTo(2400)
  await page.waitFor(200)
  await (await openDialogHost.$('.glaze-button')).tap()
  await page.waitFor(200)
  const openedDialog = await app.$('#ui-dialog')
  const panel = await openedDialog.$('.glaze-dialog__panel')
  if (!panel) throw new Error(`dialog did not open: ${await openedDialog.outerWxml()}`)
  await expect(await panel.text()).toContain('Dialog title')
  await expect(await panel.text()).toContain('Dialog body content')
  await (await openedDialog.$('.glaze-dialog__mask')).tap()
  await page.waitFor(200)
  const closedDialog = await app.$('#ui-dialog')
  if (await closedDialog.$('.glaze-dialog__panel')) {
    throw new Error('mask tap did not close the dialog')
  }
})
