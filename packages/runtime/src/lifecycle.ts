/**
 * The five reachable lifecycle shapes of a Glaze component instance.
 *
 * This is a partition of the former `mounted` / `active` / `everMounted`
 * booleans, not a new set of guarantees:
 *
 * - `unmounted`: no root, the platform has not attached, never mounted.
 * - `waiting-context`: deferred context (`boundaryContexts`), no root yet.
 *   `attachedBeforeMount` records that the platform's `attached` ran first.
 * - `mounted`: a root exists, the platform has not attached.
 * - `attached`: a root exists and the platform attached it.
 * - `detached`: the platform detached; a root may never have existed for a
 *   deferred instance, and the next attach rebuilds it.
 *
 * A phase says nothing about installed effects. `waiting-context` with
 * `attachedBeforeMount: true` is attached-but-not-mounted, and `mounted` is
 * also reached when `ready` runs before the platform's `attached` (the current
 * `ready` calls the runtime attach unconditionally).
 */
export type LifecyclePhase =
  | 'unmounted'
  | 'waiting-context'
  | 'mounted'
  | 'attached'
  | 'detached'

export type LifecycleState =
  | { phase: 'unmounted' }
  | { phase: 'waiting-context'; attachedBeforeMount: boolean }
  | { phase: 'mounted' }
  | { phase: 'attached' }
  | { phase: 'detached' }

/** State after `created` decides whether the root can be built immediately. */
export function initialLifecycle(deferredContext: boolean): LifecycleState {
  return deferredContext
    ? { phase: 'waiting-context', attachedBeforeMount: false }
    : { phase: 'unmounted' }
}

/** `created` without boundary contexts: build the root at once, not attached. */
export function mountImmediately(state: LifecycleState): LifecycleState {
  return state.phase === 'unmounted' ? { phase: 'mounted' } : state
}

/** `created` with boundary contexts: wait for the property bridge / `ready`. */
export function deferContext(state: LifecycleState): LifecycleState {
  return state.phase === 'unmounted'
    ? { phase: 'waiting-context', attachedBeforeMount: false }
    : state
}

/**
 * Platform `attached` before the deferred root exists. There is no root,
 * binding list or memo yet, so this records the attach without installing
 * effects; `readyMount` will attach again once the root is built.
 */
export function attachWhileWaiting(state: LifecycleState): LifecycleState {
  return state.phase === 'waiting-context' && !state.attachedBeforeMount
    ? { phase: 'waiting-context', attachedBeforeMount: true }
    : state
}

/**
 * Deferred mount: `ready`, or the context property arriving before `ready`.
 * Both build the root and call the runtime attach. If the platform had already
 * attached, the phase becomes `attached`; otherwise it stays `mounted` because
 * the phase tracks platform attachment, even though the mount path already
 * installed the effects.
 */
export function readyMount(state: LifecycleState): LifecycleState {
  if (state.phase !== 'waiting-context') return state
  return state.attachedBeforeMount ? { phase: 'attached' } : { phase: 'mounted' }
}

/** Platform `attached` for an instance whose root already exists. */
export function attach(state: LifecycleState): LifecycleState {
  return state.phase === 'mounted' ? { phase: 'attached' } : state
}

/**
 * Platform `detached`. A root is dropped; a waiting deferred instance also
 * moves to `detached` even though it never built one, so a late `ready` cannot
 * revive it.
 */
export function detach(state: LifecycleState): LifecycleState {
  switch (state.phase) {
    case 'mounted':
    case 'attached':
    case 'waiting-context':
      return { phase: 'detached' }
    default:
      return state
  }
}

/** Platform `attached` after `detached`: rebuild the root, then attach it. */
export function reattach(state: LifecycleState): LifecycleState {
  return state.phase === 'detached' ? { phase: 'attached' } : state
}
