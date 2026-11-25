import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { createSignal } from 'solid-js'
import { defineGlazePage } from '../src/mini.ts'

const originalPage = (globalThis as { Page?: unknown }).Page
let registered: any = null
;(globalThis as { Page?: unknown }).Page = (config: unknown) => {
  registered = config
  return config
}
after(() => {
  if (originalPage === undefined) delete (globalThis as { Page?: unknown }).Page
  else (globalThis as { Page?: unknown }).Page = originalPage
})

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

test('a page root uses the page path transport for binding updates', async () => {
  let setCount!: (value: number) => void
  const page = defineGlazePage({
    data: { b0: null },
    handlerCount: 0,
    setup(ctx) {
      const [count, set] = createSignal(0)
      setCount = set
      ctx.bind(0, () => count())
    },
  }) as any

  const calls: any[] = []
  const pathCalls: any[] = []
  let applied = 0
  const instance: any = {
    data: { ...page.data },
    properties: {},
    setData(data: any) {
      calls.push(data)
    },
    replaceDataOnPath(path: (string | number)[], value: any) {
      pathCalls.push([path, value])
    },
    applyDataUpdates() {
      applied += 1
    },
  }

  page.onLoad.call(instance, {})
  page.onReady.call(instance)
  setCount(1)
  await tick()

  assert.deepEqual(pathCalls, [[['b0'], 1]])
  assert.equal(applied, 1)
  assert.deepEqual(calls, [{ b0: 0 }])
})

test('a page root registers Page, mounts in onLoad and disposes in onUnload', async () => {
  let setCount!: (value: number) => void
  const page = defineGlazePage({
    data: { b0: null },
    handlerCount: 0,
    setup(ctx) {
      const [count, set] = createSignal(0)
      setCount = set
      ctx.bind(0, () => count())
    },
  }) as any
  assert.equal(page, registered)
  assert.equal(typeof page.onLoad, 'function')
  assert.equal(typeof page.onReady, 'function')
  assert.equal(typeof page.onUnload, 'function')

  const calls: any[] = []
  const instance: any = {
    data: { ...page.data },
    properties: {},
    setData(data: any) {
      calls.push(data)
    },
  }
  page.onLoad.call(instance, { source: 'share' })
  assert.equal(instance.__glazePageQuery.source, 'share')
  assert.deepEqual(calls[0], { b0: 0 })

  page.onReady.call(instance)
  setCount(1)
  await tick()
  assert.ok(calls.some((data) => data.b0 === 1), 'the binding should project into page data')

  page.onUnload.call(instance)
  assert.equal(instance.__glaze.lifecycle.phase, 'detached')
})
