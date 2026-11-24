import { createSignal } from 'solid-js'

/** `[getter, setter]` pair used by the runtime for every lazy boundary signal. */
export type BoundarySignal<T> = [get: () => T, set: (value: T) => void]

/**
 * The eight boundary-keyed concepts `mini.ts` currently keeps on the instance:
 *
 * - `pending` -> `asyncPending` (boundary -> binding indexes)
 * - `consumers` -> `errorBindings` (boundary -> source -> binding indexes)
 * - `errors` -> `errorValues` (boundary -> source -> last raw error)
 * - `loadingSignals`, `erroredSignals`, `errorValueSignals`, `resetSignals`
 * - `loadingOn` -> the `on` dependency readers
 *
 * `statusVersion` is not per-boundary and stays on the instance; so does the
 * `applyAsyncStatus` projection, which is transport-facing.
 */
export type BoundaryState = {
  pending: Map<number, Set<number>>
  consumers: Map<number, Map<unknown, Set<number>>>
  errors: Map<number, Map<unknown, unknown>>
  loadingSignals: Map<number, BoundarySignal<boolean>>
  erroredSignals: Map<number, BoundarySignal<boolean>>
  errorValueSignals: Map<number, BoundarySignal<unknown>>
  resetSignals: Map<number, BoundarySignal<number>>
  loadingOn: Map<number, () => unknown>
}

export function createBoundaryState(): BoundaryState {
  return {
    pending: new Map(),
    consumers: new Map(),
    errors: new Map(),
    loadingSignals: new Map(),
    erroredSignals: new Map(),
    errorValueSignals: new Map(),
    resetSignals: new Map(),
    loadingOn: new Map(),
  }
}

/** Copy of `mini.ts`'s `normalizeAsyncError`; moves here in phase 2. */
export function normalizeErrorValue(error: unknown): { name: string; message: string } {
  if (error instanceof Error) return { name: error.name, message: error.message }
  if (error && typeof error === 'object' && 'message' in error) {
    const value = error as { name?: unknown; message?: unknown }
    return {
      name: typeof value.name === 'string' ? value.name : 'Error',
      message: String(value.message),
    }
  }
  return { name: 'Error', message: String(error) }
}

const signalFor = <T>(
  signals: Map<number, BoundarySignal<T>>,
  boundary: number,
  initial: T,
): BoundarySignal<T> => {
  let signal = signals.get(boundary)
  if (!signal) {
    signal = createSignal(initial)
    signals.set(boundary, signal)
  }
  return signal
}

const booleanSignal = (signals: Map<number, BoundarySignal<boolean>>, boundary: number) =>
  signalFor(signals, boundary, false)

const errorValueSignal = (signals: Map<number, BoundarySignal<unknown>>, boundary: number) =>
  signalFor(signals, boundary, null as unknown)

const resetSignal = (signals: Map<number, BoundarySignal<number>>, boundary: number) =>
  signalFor(signals, boundary, 0)

/** Record a `NotReadyError` for a binding. Returns true when it was new. */
export function markPending(state: BoundaryState, boundary: number, index: number): boolean {
  const current = state.pending.get(boundary)
  if (current?.has(index)) return false
  const pending = current ?? new Set<number>()
  pending.add(index)
  state.pending.set(boundary, pending)
  booleanSignal(state.loadingSignals, boundary)[1](true)
  return true
}

/** Drop a binding from pending. Returns true when it was pending. */
export function markSettled(state: BoundaryState, boundary: number, index: number): boolean {
  const pending = state.pending.get(boundary)
  if (!pending?.delete(index)) return false
  if (pending.size === 0) state.pending.delete(boundary)
  // A pending entry implies `markPending` created this signal; never allocate
  // one merely because a settle arrived for an untouched boundary.
  state.loadingSignals.get(boundary)?.[1](pending.size > 0)
  return true
}

/**
 * Track a real (non-NotReady) failure. Several bindings may share one source;
 * the boundary stays errored until every consumer recovers.
 */
export function markError(
  state: BoundaryState,
  boundary: number,
  source: unknown,
  index: number,
  error: unknown,
): { valueChanged: boolean; added: boolean } {
  const errors = state.errors.get(boundary) ?? new Map<unknown, unknown>()
  const normalized = normalizeErrorValue(error)
  const previousError = errors.get(source)
  const previousNormalized =
    previousError == null ? null : normalizeErrorValue(previousError)
  let valueChanged = false
  if (
    previousNormalized == null ||
    previousNormalized.name !== normalized.name ||
    previousNormalized.message !== normalized.message
  ) {
    errors.set(source, error)
    state.errors.set(boundary, errors)
    errorValueSignal(state.errorValueSignals, boundary)[1](normalized)
    valueChanged = true
  }

  const consumersBySource = state.consumers.get(boundary) ?? new Map<unknown, Set<number>>()
  const consumers = consumersBySource.get(source) ?? new Set<number>()
  if (consumers.has(index)) return { valueChanged, added: false }
  consumers.add(index)
  consumersBySource.set(source, consumers)
  state.consumers.set(boundary, consumersBySource)
  booleanSignal(state.erroredSignals, boundary)[1](true)
  return { valueChanged, added: true }
}

/** Drop one consumer of a source; the source entry survives other consumers. */
export function clearError(
  state: BoundaryState,
  boundary: number,
  source: unknown,
  index: number,
): void {
  const consumersBySource = state.consumers.get(boundary)
  if (consumersBySource) {
    const consumers = consumersBySource.get(source)
    consumers?.delete(index)
    if (consumers?.size === 0) {
      consumersBySource.delete(source)
      state.errors.get(boundary)?.delete(source)
    }
    if (consumersBySource.size === 0) state.consumers.delete(boundary)
    state.erroredSignals.get(boundary)?.[1](consumersBySource.size > 0)
  }

  const errors = state.errors.get(boundary)
  if (errors) {
    if (errors.size === 0) state.errors.delete(boundary)
    state.errorValueSignals.get(boundary)?.[1](
      errors.size > 0 ? normalizeErrorValue(errors.values().next().value) : null,
    )
  }
}

/**
 * Clear one boundary's pending/error content and bump its reset counter so
 * binding memos retry. Signal instances are reused; only their values change.
 */
export function resetBoundary(state: BoundaryState, boundary: number): void {
  state.pending.delete(boundary)
  state.consumers.delete(boundary)
  state.errors.delete(boundary)
  booleanSignal(state.loadingSignals, boundary)[1](false)
  booleanSignal(state.erroredSignals, boundary)[1](false)
  errorValueSignal(state.errorValueSignals, boundary)[1](null)
  const reset = resetSignal(state.resetSignals, boundary)
  reset[1](reset[0]() + 1)
}

/**
 * Remount clearing: drop all content, reset every existing signal in place,
 * and keep signal and reset-counter identity (a fresh root reads the same
 * reset signals). `resetSignals` are intentionally not cleared, matching the
 * current `mount`.
 */
export function clearBoundaryContent(state: BoundaryState): void {
  state.pending.clear()
  state.consumers.clear()
  state.errors.clear()
  state.loadingOn.clear()
  state.loadingSignals.forEach((signal) => signal[1](false))
  state.erroredSignals.forEach((signal) => signal[1](false))
  state.errorValueSignals.forEach((signal) => signal[1](null))
}

export const hasPending = (state: BoundaryState, boundary: number): boolean =>
  (state.pending.get(boundary)?.size ?? 0) > 0

export const loadingOf = (state: BoundaryState, boundary: number): boolean =>
  booleanSignal(state.loadingSignals, boundary)[0]()

export const erroredOf = (state: BoundaryState, boundary: number): boolean =>
  booleanSignal(state.erroredSignals, boundary)[0]()

export const errorValueOf = (state: BoundaryState, boundary: number): unknown =>
  errorValueSignal(state.errorValueSignals, boundary)[0]()

/** `errorArray` stays single-valued even when several sources are errored. */
export const errorArrayOf = (state: BoundaryState, boundary: number): unknown[] => {
  const value = errorValueOf(state, boundary)
  return value == null ? [] : [value]
}
