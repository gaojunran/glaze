import assert from 'node:assert/strict'
import test from 'node:test'
import { createFrameScheduler } from '../src/frame.ts'

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

test('falls back to a microtask without a glass-easel backend', async () => {
  let calls = 0
  const schedule = createFrameScheduler({})
  schedule(() => {
    calls += 1
  })
  assert.equal(calls, 0)
  await tick()
  assert.equal(calls, 1)
})

test('waits for the backend render callback', () => {
  const pending: Array<() => void> = []
  let calls = 0
  const schedule = createFrameScheduler({
    getBackendContext: () => ({
      render: (callback: () => void) => pending.push(callback),
    }),
  })
  schedule(() => {
    calls += 1
  })
  assert.equal(calls, 0)
  assert.equal(pending.length, 1)
  pending[0]()
  assert.equal(calls, 1)
  pending[0]()
  assert.equal(calls, 1)
})

test('uses an empty setData callback as a frame token', () => {
  const pending: Array<() => void> = []
  const holder = globalThis as unknown as { wx?: unknown }
  const original = holder.wx
  holder.wx = {}
  try {
    let calls = 0
    const schedule = createFrameScheduler({
      setData: (data: Record<string, never>, callback?: () => void) => {
        assert.deepEqual(data, {})
        pending.push(callback!)
      },
    })
    schedule(() => {
      calls += 1
    })
    assert.equal(calls, 0)
    assert.equal(pending.length, 1)
    pending[0]()
    assert.equal(calls, 1)
  } finally {
    if (original === undefined) delete holder.wx
    else holder.wx = original
  }
})

test('falls back to a microtask when the backend render throws', async () => {
  let calls = 0
  const schedule = createFrameScheduler({
    getBackendContext: () => ({
      render: () => {
        throw new Error('no frame')
      },
    }),
  })
  schedule(() => {
    calls += 1
  })
  assert.equal(calls, 0)
  await tick()
  assert.equal(calls, 1)
})

test('falls back to a microtask when the frame token never calls back', async () => {
  const holder = globalThis as unknown as { wx?: unknown }
  const original = holder.wx
  holder.wx = {}
  try {
    let calls = 0
    const callbacks: Array<() => void> = []
    const schedule = createFrameScheduler(
      {
        setData: (_data: Record<string, never>, callback?: () => void) => {
          callbacks.push(callback!)
        },
      },
      { tokenTimeout: 10 },
    )
    schedule(() => {
      calls += 1
    })
    assert.equal(calls, 0)
    await new Promise((resolve) => setTimeout(resolve, 30))
    assert.equal(calls, 1)
    // A late callback must not flush the batch a second time.
    callbacks[0]()
    assert.equal(calls, 1)
  } finally {
    if (original === undefined) delete holder.wx
    else holder.wx = original
  }
})
