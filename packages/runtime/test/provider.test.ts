import assert from 'node:assert/strict'
import test from 'node:test'
import { createContext, createRoot, createSignal, flush, useContext } from 'solid-js'
import { withBoundaryContexts, withProvider } from '../src/provider.ts'

test('an object context value follows later reads without remounting the provider', () => {
  const Theme = createContext({ color: 'light' })
  const [color, setColor] = createSignal('light')
  let seen
  createRoot(() => {
    withProvider(
      Theme,
      { color: color() },
      () => {
        seen = useContext(Theme)
      },
      () => ({ get color() { return color() } }),
    )
  })
  assert.equal(seen.color, 'light')
  setColor('dark')
  flush()
  assert.equal(seen.color, 'dark')
})

test('a boundary context accessor updates the proxied value', () => {
  const Theme = createContext({ color: 'light' })
  const [color, setColor] = createSignal('light')
  let seen
  createRoot(() => {
    withBoundaryContexts(
      [{ context: Theme, key: '/app/theme#Theme' }],
      () => ({ '/app/theme#Theme': { get color() { return color() } } }),
      () => {
        seen = useContext(Theme)
      },
    )
  })
  assert.equal(seen.color, 'light')
  setColor('dark')
  flush()
  assert.equal(seen.color, 'dark')
})

test('a primitive context value keeps the value captured at mount', () => {
  const Theme = createContext('light')
  let seen
  createRoot(() => {
    withProvider(
      Theme,
      'light',
      () => {
        seen = useContext(Theme)
      },
      () => 'dark',
    )
  })
  assert.equal(seen, 'light')
})
