import assert from 'node:assert/strict'
import test from 'node:test'
import {
  attach,
  attachWhileWaiting,
  deferContext,
  detach,
  initialLifecycle,
  mountImmediately,
  readyMount,
  reattach,
  type LifecycleState,
} from '../src/lifecycle.ts'

const UNMOUNTED: LifecycleState = { phase: 'unmounted' }
const WAITING: LifecycleState = { phase: 'waiting-context', attachedBeforeMount: false }
const WAITING_ATTACHED: LifecycleState = {
  phase: 'waiting-context',
  attachedBeforeMount: true,
}
const MOUNTED: LifecycleState = { phase: 'mounted' }
const ATTACHED: LifecycleState = { phase: 'attached' }
const DETACHED: LifecycleState = { phase: 'detached' }

test('created chooses immediate mount or context waiting', () => {
  assert.deepEqual(initialLifecycle(false), UNMOUNTED)
  assert.deepEqual(initialLifecycle(true), WAITING)
  assert.deepEqual(mountImmediately(initialLifecycle(false)), MOUNTED)
  assert.deepEqual(deferContext(initialLifecycle(false)), WAITING)
})

test('the non-deferred path mounts, attaches, detaches and re-attaches', () => {
  const mounted = mountImmediately(UNMOUNTED)
  assert.deepEqual(mounted, MOUNTED)

  const attached = attach(mounted)
  assert.deepEqual(attached, ATTACHED)

  const detached = detach(attached)
  assert.deepEqual(detached, DETACHED)

  assert.deepEqual(reattach(detached), ATTACHED)
})

test('the deferred path attaches before the root exists and mounts at ready', () => {
  const waiting = deferContext(UNMOUNTED)
  assert.deepEqual(waiting, WAITING)

  // The platform's attached lifetime runs before ready: no root yet, so the
  // attach is recorded without installing effects.
  const waitingAttached = attachWhileWaiting(waiting)
  assert.deepEqual(waitingAttached, WAITING_ATTACHED)

  // ready builds the root, runs setup (bindings, memos, asyncStatus effects)
  // and calls attach again.
  assert.deepEqual(readyMount(waitingAttached), ATTACHED)
})

test('ready before attached keeps the platform phase at mounted', () => {
  const waiting = deferContext(UNMOUNTED)
  const mounted = readyMount(waiting)

  // Current `ready` mounts and calls the runtime attach unconditionally, so
  // effects are installed here even though the phase says `mounted`.
  assert.deepEqual(mounted, MOUNTED)

  assert.deepEqual(attach(mounted), ATTACHED)
})

test('detach before ready moves a deferred instance to detached', () => {
  assert.deepEqual(detach(WAITING_ATTACHED), DETACHED)
  assert.deepEqual(detach(WAITING), DETACHED)
})

test('detach outside a root keeps the phase unchanged', () => {
  assert.equal(detach(UNMOUNTED), UNMOUNTED)
  assert.equal(detach(DETACHED), DETACHED)
})

test('helpers leave unrelated phases untouched', () => {
  for (const state of [WAITING, WAITING_ATTACHED, MOUNTED, ATTACHED, DETACHED]) {
    assert.equal(mountImmediately(state), state)
    assert.equal(deferContext(state), state)
  }
  for (const state of [UNMOUNTED, MOUNTED, ATTACHED, DETACHED]) {
    assert.equal(attachWhileWaiting(state), state)
  }
  for (const state of [UNMOUNTED, MOUNTED, ATTACHED, DETACHED]) {
    assert.equal(readyMount(state), state)
  }
  for (const state of [UNMOUNTED, WAITING, WAITING_ATTACHED, ATTACHED, DETACHED]) {
    assert.equal(attach(state), state)
  }
  for (const state of [UNMOUNTED, WAITING, WAITING_ATTACHED, MOUNTED, ATTACHED]) {
    assert.equal(reattach(state), state)
  }
})

test('repeated lifetime calls are idempotent', () => {
  assert.equal(attach(ATTACHED), ATTACHED)
  assert.equal(attachWhileWaiting(WAITING_ATTACHED), WAITING_ATTACHED)
  assert.equal(detach(DETACHED), DETACHED)
  assert.equal(reattach(ATTACHED), ATTACHED)
  assert.equal(readyMount(ATTACHED), ATTACHED)

  const detachedAgain = detach(detach(ATTACHED))
  assert.deepEqual(detachedAgain, DETACHED)
})

test('a deferred component with asyncStatus can reach attached without a root', () => {
  // Documented reachable path: `boundaryContexts` defers setup, `attached`
  // runs first, and asyncStatus bindings are only projected once `ready`
  // mounts and calls attach. Phase `waiting-context` therefore means
  // attached-but-not-mounted, not "effects installed".
  const created = initialLifecycle(true)
  const platformAttached = attachWhileWaiting(created)
  assert.deepEqual(platformAttached, WAITING_ATTACHED)

  const mounted = readyMount(platformAttached)
  assert.deepEqual(mounted, ATTACHED)

  const detached = detach(mounted)
  assert.deepEqual(detached, DETACHED)

  // Re-attach rebuilds the root even though the context is deferred.
  assert.deepEqual(reattach(detached), ATTACHED)
})
