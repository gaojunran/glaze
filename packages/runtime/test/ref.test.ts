import assert from 'node:assert/strict'
import test from 'node:test'
import { createNodeRef } from '../src/ref.ts'

test('calls every ref callback in an array with the same measured node', async () => {
  const calls: Array<[number, number]> = []
  const component = {
    createSelectorQuery() {
      return {
        select() {
          return {
            boundingClientRect(callback: (rect: unknown) => void) {
              callback({ width: 12, height: 4, top: 1, left: 2 })
              return this
            },
            exec() {},
          }
        },
      }
    },
  }

  await new Promise<void>((resolve) => {
    createNodeRef(component, 'glaze-r0', [
      (node) => calls.push([0, (node as { width: number }).width]),
      (node) => calls.push([1, (node as { width: number }).width]),
    ])
    setImmediate(resolve)
  })

  assert.deepEqual(calls, [
    [0, 12],
    [1, 12],
  ])
})
