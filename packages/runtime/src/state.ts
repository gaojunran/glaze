import type { GlazeBinding } from './types.ts'

/**
 * Per-binding runtime state. This is the behaviour-preserving model of the
 * fields `mini.ts` currently spreads across `bindingFns`, `bindings`,
 * `bindingMemos`, `initial`, `previous`, `settled`, `bindingBoundaries`,
 * `bindingErrorBoundaries`, `bindingSources` and `fallbackSources`.
 *
 * The fields stay separate on purpose: `initial`, `previous` and `settled`
 * describe different moments and must never be inferred from `undefined`.
 */
export type BindingState = {
  /** Raw binding function: the direct read used for the mount value. */
  raw: GlazeBinding | null
  /**
   * Effect source. When the binding has an async boundary this is a memo
   * accessor that unwraps the internal error sentinel; otherwise it is `raw`.
   */
  read: GlazeBinding | null
  /**
   * Real Solid memo node used by `isPending` for refetch. `null` when the
   * binding has no async boundary (no memo is created in that case).
   */
  memo: GlazeBinding | null
  /**
   * Raw value recorded by the mount pass, before list projection/snapshot.
   * The first effect run compares against it to skip the initial `setData`.
   */
  initial: unknown
  /** Last applied baseline: projected and, for list bindings, snapshotted. */
  previous: unknown
  /**
   * True once a value has been committed. The status effect may only probe
   * `isPending` for settled bindings; a memo that never produced a value
   * cannot answer that probe.
   */
  settled: boolean
  /** Nearest Loading boundary id for this binding. */
  loadingBoundary: number | null
  /** Nearest Errored boundary id for this binding. */
  errorBoundary: number | null
  /** Last resolved error source key (`error.source` or the fallback below). */
  source: unknown
  /**
   * Stable `{ binding: index }` fallback source, allocated lazily when an
   * error has no `source`. Mount clears it, a boundary reset does not.
   */
  fallbackSource: unknown
}

/**
 * Sparse binding slots. Holes are meaningful: `mini.ts` registers bindings by
 * index and iterates with `forEach`, so holes are skipped and indexes stay
 * aligned with the compiler's `bN` names. Never compact this list.
 */
export type BindingList = (BindingState | undefined)[]

export type BindingConfig = {
  raw: GlazeBinding
  loadingBoundary?: number | null
  errorBoundary?: number | null
}

/**
 * Mirror of `ctx.bind(index, fn, loadingBoundary = null, errorBoundary =
 * loadingBoundary)`: an omitted error boundary follows the loading boundary,
 * while an explicit `null` stays `null`.
 */
export function createBindingState(config: BindingConfig): BindingState {
  const loadingBoundary = config.loadingBoundary ?? null
  return {
    raw: config.raw,
    read: config.raw,
    memo: null,
    initial: undefined,
    previous: undefined,
    settled: false,
    loadingBoundary,
    errorBoundary: config.errorBoundary === undefined ? loadingBoundary : config.errorBoundary,
    source: undefined,
    fallbackSource: undefined,
  }
}

export type BindingStatesConfig = {
  /** Raw bindings by slot; `undefined`/holes stay holes. */
  raw?: readonly (GlazeBinding | undefined)[]
  /** Loading boundary by slot; a hole means `null`. */
  loadingBoundaries?: readonly (number | null | undefined)[]
  /** Errored boundary by slot; a hole follows the loading boundary. */
  errorBoundaries?: readonly (number | null | undefined)[]
}

/**
 * Build the sparse binding list from the arrays `mini.ts` already holds. A
 * raw array with length N and holes keeps that length and those holes.
 */
export function createBindingStates(config: BindingStatesConfig = {}): BindingList {
  const states: BindingList = []
  const raw = config.raw
  if (!raw) return states
  for (let index = 0; index < raw.length; index += 1) {
    const binding = raw[index]
    if (!binding) continue
    states[index] = createBindingState({
      raw: binding,
      loadingBoundary: config.loadingBoundaries?.[index],
      errorBoundary: config.errorBoundaries?.[index],
    })
  }
  return states
}

/**
 * Clear every value a mount would recompute, in place. Entry identity and the
 * sparse layout are preserved so external references observe the reset; other
 * state (boundary signals, transport queues) is untouched.
 */
export function resetBindingStates(states: BindingList): void {
  for (let index = 0; index < states.length; index += 1) {
    const state = states[index]
    if (!state) continue
    state.raw = null
    state.read = null
    state.memo = null
    state.initial = undefined
    state.previous = undefined
    state.settled = false
    state.loadingBoundary = null
    state.errorBoundary = null
    state.source = undefined
    state.fallbackSource = undefined
  }
}

/**
 * The slice of instance state this module owns. Phase 2 replaces the matching
 * `InstanceState` fields with `core.bindings`; transport queues, props,
 * lifecycle flags and boundary maps stay where they are until the integration
 * edits `mini.ts` and `types.ts` together.
 */
export type RuntimeStateCore = {
  bindings: BindingList
}
