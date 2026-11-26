import assert from 'node:assert/strict'
import test from 'node:test'
import { createRoot, createSignal, flush } from 'solid-js'
import {
  createBoundaryState,
  markPending,
  markSettled,
  markSettledBoundary,
} from '../src/boundary.ts'
import { createRevealGroup } from '../src/reveal.ts'

test('sequential Reveal gates the first pending slot and hides a collapsed tail', () => {
  createRoot(() => {
    const boundaries = createBoundaryState()
    const group = createRevealGroup(boundaries, [1, 2], () => 'sequential', () => true)

    markPending(boundaries, 1, 0)
    flush()
    assert.deepEqual([group.gated(1), group.hidden(1)], [true, false])
    assert.deepEqual([group.gated(2), group.hidden(2)], [true, true])

    markSettled(boundaries, 1, 0)
    flush()
    assert.deepEqual([group.gated(1), group.hidden(1)], [false, false])
    assert.deepEqual([group.gated(2), group.hidden(2)], [false, false])
  })
})

test('sequential collapsed=false shows the tail fallback instead of hiding it', () => {
  createRoot(() => {
    const boundaries = createBoundaryState()
    const group = createRevealGroup(boundaries, [1, 2], () => 'sequential', () => false)

    markPending(boundaries, 1, 0)
    flush()
    assert.deepEqual([group.gated(1), group.hidden(1)], [true, false])
    assert.deepEqual([group.gated(2), group.hidden(2)], [true, false])
  })
})

test('together waits for every slot before releasing any', () => {
  createRoot(() => {
    const boundaries = createBoundaryState()
    const group = createRevealGroup(boundaries, [1, 2], () => 'together', () => false)

    markPending(boundaries, 1, 0)
    flush()
    assert.equal(group.gated(1), true)
    assert.equal(group.gated(2), true)

    markSettled(boundaries, 1, 0)
    flush()
    assert.equal(group.gated(1), false)
    assert.equal(group.gated(2), false)
  })
})

test('natural Reveal releases each ready slot on its own', () => {
  createRoot(() => {
    const boundaries = createBoundaryState()
    const group = createRevealGroup(boundaries, [1, 2], () => 'natural', () => false)

    markPending(boundaries, 1, 0)
    flush()
    assert.equal(group.gated(1), true)
    assert.equal(group.gated(2), false)
  })
})

test('reactive order and collapsed change the group without remounting', () => {
  createRoot(() => {
    const boundaries = createBoundaryState()
    const [order, setOrder] = createSignal<'sequential' | 'together'>('sequential')
    const [collapsed, setCollapsed] = createSignal(false)
    const group = createRevealGroup(boundaries, [1, 2], order, collapsed)

    markPending(boundaries, 1, 0)
    flush()
    assert.equal(group.gated(1), true)
    assert.equal(group.gated(2), true)
    assert.equal(group.hidden(2), false)

    setCollapsed(true)
    flush()
    assert.equal(group.hidden(2), true)

    setOrder('together')
    flush()
    assert.equal(group.gated(1), true)
    assert.equal(group.gated(2), true)
    assert.equal(group.hidden(2), false)

    markSettled(boundaries, 1, 0)
    flush()
    assert.equal(group.gated(1), false)
    assert.equal(group.gated(2), false)
  })
})

test('a slot that has shown content stays released through a refetch', () => {
  createRoot(() => {
    const boundaries = createBoundaryState()
    const group = createRevealGroup(boundaries, [1, 2], () => 'sequential', () => true)

    markSettledBoundary(boundaries, 1, true)
    markPending(boundaries, 1, 0)
    flush()
    assert.equal(group.gated(1), false)
    assert.equal(group.hidden(1), false)
  })
})
