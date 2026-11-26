const { test, expect } = require('minidev-automator')

test('control flow variants update through real rendering', async (miniProgram) => {
  await miniProgram.reLaunch('/pages/control/index')
  const page = await miniProgram.currentPage()
  await page.waitFor(800)
  const app = await page.$('#app')
  if (!app) throw new Error('glaze-root not found')

  const texts = async (selector) => {
    const nodes = await app.$$(selector)
    const values = []
    for (const node of nodes) values.push(await node.text())
    return values
  }
  const tap = async (selector) => {
    await (await app.$(selector)).tap()
    await page.waitFor(300)
  }

  // Plain `For` without a key.
  await expect(JSON.stringify(await texts('.plain-row'))).toBe(JSON.stringify(['a', 'b', 'c']))
  await tap('.plain-reverse')
  await expect(JSON.stringify(await texts('.plain-row'))).toBe(JSON.stringify(['c', 'b', 'a']))
  await tap('.plain-append')
  await expect(JSON.stringify(await texts('.plain-row'))).toBe(
    JSON.stringify(['c', 'b', 'a', 'd']),
  )
  await tap('.plain-clear')
  await expect((await app.$$('.plain-row')).length).toBe(0)

  // `keyed={false}` gives the row accessor.
  await expect(JSON.stringify(await texts('.unkeyed-row'))).toBe(
    JSON.stringify(['u1', 'u2']),
  )
  await tap('.unkeyed-reverse')
  await expect(JSON.stringify(await texts('.unkeyed-row'))).toBe(
    JSON.stringify(['u2', 'u1']),
  )
  await tap('.unkeyed-append')
  await expect(JSON.stringify(await texts('.unkeyed-row'))).toBe(
    JSON.stringify(['u2', 'u1', 'u3']),
  )
  await tap('.unkeyed-remove')
  await expect(JSON.stringify(await texts('.unkeyed-row'))).toBe(
    JSON.stringify(['u1', 'u3']),
  )

  // `keyed={(row) => row.id}` reorders the same row nodes.
  await expect(JSON.stringify(await texts('.keyed-row'))).toBe(
    JSON.stringify(['k1', 'k2', 'k3']),
  )
  await tap('.keyed-reverse')
  await expect(JSON.stringify(await texts('.keyed-row'))).toBe(
    JSON.stringify(['k3', 'k2', 'k1']),
  )
  await tap('.keyed-append')
  await expect(JSON.stringify(await texts('.keyed-row'))).toBe(
    JSON.stringify(['k3', 'k2', 'k1', 'k4']),
  )
  await tap('.keyed-remove')
  await expect(JSON.stringify(await texts('.keyed-row'))).toBe(
    JSON.stringify(['k2', 'k1', 'k4']),
  )

  // Keyed and non-keyed Show callbacks follow the same signal.
  await expect(await (await app.$('.show-keyed')).text()).toBe('alpha')
  await expect(await (await app.$('.show-nonkeyed')).text()).toBe('alpha')
  await tap('.show-next')
  await expect(await (await app.$('.show-keyed')).text()).toBe('beta')
  await expect(await (await app.$('.show-nonkeyed')).text()).toBe('beta')
  await tap('.show-clear')
  if (await app.$('.show-keyed')) throw new Error('keyed Show did not clear')
  if (await app.$('.show-nonkeyed')) throw new Error('non-keyed Show did not clear')

  // A keyed Match callback updates in place and falls back when empty.
  await expect(await (await app.$('.match-keyed')).text()).toBe('alpha')
  await tap('.match-next')
  await expect(await (await app.$('.match-keyed')).text()).toBe('beta')
  await tap('.match-clear')
  await expect(await (await app.$('.match-fallback')).text()).toBe('none')
})
