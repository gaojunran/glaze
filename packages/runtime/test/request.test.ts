import assert from 'node:assert/strict'
import test from 'node:test'
import { createRoot, flush } from 'solid-js'
import { createRequest, type AsyncRequest } from '../src/request.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

test('the latest response wins when an earlier flight resolves last', async () => {
  const first = deferred<string>()
  const second = deferred<string>()
  const tasks = [first.promise, second.promise]
  let calls = 0
  const request = createRequest(() => tasks[calls++])

  const firstRun = request.run()
  flush()
  assert.equal(request.pending(), true)
  const secondRun = request.run()

  second.resolve('second')
  assert.equal(await secondRun, 'second')
  assert.equal(request.data(), 'second')
  assert.equal(request.pending(), false)

  first.resolve('first')
  assert.equal(await firstRun, undefined)
  assert.equal(request.data(), 'second')
  assert.equal(request.pending(), false)
})

test('a stale rejection does not set error', async () => {
  const first = deferred<string>()
  const second = deferred<string>()
  const tasks = [first.promise, second.promise]
  let calls = 0
  const request = createRequest(() => tasks[calls++])

  const firstRun = request.run()
  const secondRun = request.run()
  second.resolve('ok')
  assert.equal(await secondRun, 'ok')

  first.reject(new Error('late failure'))
  assert.equal(await firstRun, undefined)
  assert.equal(request.error(), undefined)
  assert.equal(request.data(), 'ok')
  assert.equal(request.pending(), false)
})

test('pending and data transition around the latest flight', async () => {
  const task = deferred<number>()
  const request = createRequest(() => ({ promise: task.promise }))

  assert.equal(request.pending(), false)
  assert.equal(request.data(), undefined)
  assert.equal(request.error(), undefined)

  const run = request.run()
  flush()
  assert.equal(request.pending(), true)
  assert.equal(request.data(), undefined)

  task.resolve(1)
  assert.equal(await run, 1)
  assert.equal(request.pending(), false)
  assert.equal(request.data(), 1)
  assert.equal(request.error(), undefined)
})

test('a latest rejection sets error and resolves the run to undefined', async () => {
  const task = deferred<number>()
  const failure = new Error('failed')
  const request = createRequest(() => task.promise)

  const run = request.run()
  task.reject(failure)
  assert.equal(await run, undefined)
  assert.equal(request.error(), failure)
  assert.equal(request.pending(), false)
  assert.equal(request.data(), undefined)
})

test('explicit abort keeps data, clears pending and does not set error', async () => {
  const kept = deferred<string>()
  const pending = deferred<string>()
  let aborts = 0
  let calls = 0
  const request = createRequest(() => {
    if (calls++ === 0) return kept.promise
    return {
      promise: pending.promise,
      abort: () => {
        aborts += 1
      },
    }
  })

  const firstRun = request.run()
  kept.resolve('kept')
  assert.equal(await firstRun, 'kept')
  assert.equal(request.data(), 'kept')

  const secondRun = request.run()
  flush()
  assert.equal(request.pending(), true)

  request.abort()
  flush()
  assert.equal(aborts, 1)
  assert.equal(request.pending(), false)
  assert.equal(request.data(), 'kept')
  assert.equal(request.error(), undefined)

  pending.resolve('late')
  assert.equal(await secondRun, undefined)
  assert.equal(request.data(), 'kept')
  assert.equal(request.error(), undefined)
})

test('owner cleanup aborts the current task', async () => {
  const task = deferred<string>()
  let aborts = 0
  let request!: AsyncRequest<string>

  const dispose = createRoot((dispose) => {
    request = createRequest(() => ({
      promise: task.promise,
      abort: () => {
        aborts += 1
      },
    }))
    return dispose
  })

  const run = request.run()
  flush()
  assert.equal(request.pending(), true)
  dispose()
  flush()

  assert.equal(aborts, 1)
  assert.equal(request.pending(), false)
  assert.equal(request.error(), undefined)

  task.resolve('late')
  assert.equal(await run, undefined)
  assert.equal(request.data(), undefined)
})

test('a synchronous start throw is reported and clears pending', async () => {
  const failure = new Error('boom')
  const request = createRequest(() => {
    throw failure
  })

  assert.equal(await request.run(), undefined)
  assert.equal(request.error(), failure)
  assert.equal(request.pending(), false)
  assert.equal(request.data(), undefined)
})

test('a promise-only start resolves the run value', async () => {
  const request = createRequest(async () => 42)

  assert.equal(request.data(), undefined)
  assert.equal(request.pending(), false)
  assert.equal(await request.run(), 42)
  assert.equal(request.data(), 42)
  assert.equal(request.error(), undefined)
  assert.equal(request.pending(), false)
})
