import {
  createEffect,
  createMemo,
  isPending,
  NotReadyError,
  createRoot,
  createSignal,
  getOwner,
  onCleanup,
  runWithOwner,
  useContext,
} from 'solid-js'
import {
  CONTEXT_PROP,
  STRUCTURED_PROP,
  eventHandlerName,
  isPrototypePropName,
} from '@glaze/shared'
import {
  normalizeDataValue,
  normalizePropValue,
  GLAZE_EVENT_OPTIONS,
  reportAppLifecycleError,
  reportBindingError as logBindingError,
  reportComponentError,
  reportTransportError,
  SCALAR_BINDING_GROUP,
} from './data.ts'
import { diffList, projectList, snapshotList } from './list.ts'
import { isContextReader } from './provider.ts'
import { createNodeRef } from './ref.ts'
import {
  clearBoundaryContent,
  clearError,
  createBoundaryState,
  errorArrayOf,
  errorValueOf,
  erroredOf,
  hasPending as hasBoundaryPending,
  loadingOf,
  markError,
  markPending,
  markSettled,
  resetBoundary as resetBoundaryState,
  resetVersionOf,
  setLoading,
} from './boundary.ts'
import { validateConfig } from './config.ts'
import { createBindingState, resetBindingStates } from './state.ts'
import { createDataTransport } from './transport.ts'
import {
  attach as attachLifecycle,
  attachWhileWaiting,
  detach as detachLifecycle,
  initialLifecycle,
  mountImmediately,
  readyMount,
  reattach,
  type LifecycleState,
} from './lifecycle.ts'
declare const Component: (options: Record<string, unknown>) => unknown

import type {
  AppLaunchOptions,
  AppShowHandler,
  DataChange,
  GlazeComponentConfig,
  GlazeContext,
  GlazeContextProvider,
  InstanceState,
  PageEventName,
  PageEventPayloads,
  PageSize,
} from './types.ts'

export { className, styleName, textValue } from './styles.ts'
export { withBoundaryContexts, withProvider } from './provider.ts'
export { diffList, listOps, listPatch, projectList, snapshotList } from './list.ts'
export type { GlazeComponentConfig, GlazeContext, GlazeNode } from './types.ts'

/** Mirrors the old `state.active`: the platform has attached the instance. */
const platformAttached = (lifecycle: LifecycleState): boolean =>
  lifecycle.phase === 'attached' ||
  (lifecycle.phase === 'waiting-context' && lifecycle.attachedBeforeMount)

/** A Solid root exists (mounted or attached); waiting-context has none yet. */
const hasRoot = (lifecycle: LifecycleState): boolean =>
  lifecycle.phase === 'mounted' || lifecycle.phase === 'attached'

const [appVisible, setAppVisible] = createSignal(true)
// Launch options are immutable for the app instance. Keep them outside a signal
// so a component can read them during setup, before the first Solid flush.
let appLaunchOptionsValue: AppLaunchOptions | undefined
const appShowHandlers = new Set<AppShowHandler>()
const appHideHandlers = new Set<() => void>()
const appErrorHandlers = new Set<(error: unknown) => void>()
const unhandledRejectionHandlers = new Set<(reason: unknown) => void>()
let appLifecycleWx: unknown = null

type AppLifecycleWx = {
  onAppShow?: (listener: (options?: AppLaunchOptions) => void) => void
  onAppHide?: (listener: () => void) => void
  onError?: (listener: (error: unknown) => void) => void
  onUnhandledRejection?: (listener: (event: { reason?: unknown }) => void) => void
  getLaunchOptionsSync?: () => AppLaunchOptions
}

const dispatchAppShow = (options: AppLaunchOptions | undefined): void => {
  setAppVisible(true)
  for (const handler of [...appShowHandlers]) {
    try {
      handler(options)
    } catch (error) {
      reportAppLifecycleError(error)
    }
  }
}

const dispatchAppHide = (): void => {
  setAppVisible(false)
  for (const handler of [...appHideHandlers]) {
    try {
      handler()
    } catch (error) {
      reportAppLifecycleError(error)
    }
  }
}

const dispatchAppError = (error: unknown): void => {
  for (const handler of [...appErrorHandlers]) {
    try {
      handler(error)
    } catch (handlerError) {
      reportAppLifecycleError(handlerError)
    }
  }
}

const dispatchUnhandledRejection = (reason: unknown): void => {
  for (const handler of [...unhandledRejectionHandlers]) {
    try {
      handler(reason)
    } catch (error) {
      reportAppLifecycleError(error)
    }
  }
}

const installAppLifecycle = (): void => {
  const wx = (globalThis as { wx?: AppLifecycleWx }).wx
  if (!wx || appLifecycleWx === wx) return
  if (
    typeof wx.onAppShow !== 'function' &&
    typeof wx.onAppHide !== 'function' &&
    typeof wx.onError !== 'function' &&
    typeof wx.onUnhandledRejection !== 'function' &&
    typeof wx.getLaunchOptionsSync !== 'function'
  ) {
    return
  }
  appLifecycleWx = wx
  if (typeof wx.getLaunchOptionsSync === 'function') {
    appLaunchOptionsValue = wx.getLaunchOptionsSync()
  }
  wx.onAppShow?.(dispatchAppShow)
  wx.onAppHide?.(dispatchAppHide)
  wx.onError?.(dispatchAppError)
  wx.onUnhandledRejection?.((event) => dispatchUnhandledRejection(event?.reason ?? event))
}

const subscribeApp = <T,>(handlers: Set<T>, handler: T): (() => void) => {
  handlers.add(handler)
  const remove = () => {
    handlers.delete(handler)
  }
  onCleanup(remove)
  return remove
}

const notifyComponentError = (state: InstanceState, error: unknown): void => {
  state.error = error
  for (const handler of [...state.errorHandlers]) {
    try {
      handler(error)
    } catch (handlerError) {
      reportComponentError(handlerError)
    }
  }
}

const reportUnhandledComponentError = (state: InstanceState, error: unknown): void => {
  if (state.errorHandlers.length === 0) reportComponentError(error)
}

const emitPageEvent = (state: InstanceState, name: PageEventName, payload: unknown): unknown => {
  state.pageEvents.set(name, payload)
  state.pageEventVersion[1](state.pageEventVersion[0]() + 1)
  const handlers = state.pageHandlers.get(name)
  if (!handlers) return undefined
  let result: unknown
  for (const handler of [...handlers]) {
    try {
      const value = handler(payload)
      if (result === undefined) result = value
    } catch (error) {
      notifyComponentError(state, error)
      reportUnhandledComponentError(state, error)
    }
  }
  return result
}

/** The setup context while the user component body runs; hooks read it. */
let activeSetupContext: GlazeContext | null = null

const requireSetupContext = (hook: string): GlazeContext => {
  if (!activeSetupContext) {
    throw new Error(`[glaze] ${hook} must be called during component setup`)
  }
  return activeSetupContext
}

/** Reactive page visibility for the component currently being set up. */
export const usePageVisible = (): (() => boolean) =>
  requireSetupContext('usePageVisible').pageVisible

/** Reactive page size for the component currently being set up. */
export const usePageSize = (): (() => PageSize | null) =>
  requireSetupContext('usePageSize').pageSize

/** Subscribe to the component error lifetime from inside setup. */
export const onComponentError = (handler: (error: unknown) => void): (() => void) =>
  requireSetupContext('onComponentError').onComponentError(handler)

/** Reactive app foreground state for the component currently being set up. */
export const useAppVisible = (): (() => boolean) => {
  requireSetupContext('useAppVisible')
  installAppLifecycle()
  return appVisible
}

/** Launch options captured when the mini-program starts. */
export const useLaunchOptions = (): (() => AppLaunchOptions | undefined) => {
  const ctx = requireSetupContext('useLaunchOptions')
  return () => ctx.appLaunchOptions()
}

export const onAppShow = (handler: AppShowHandler): (() => void) =>
  requireSetupContext('onAppShow').onAppShow(handler)

export const onAppHide = (handler: () => void): (() => void) =>
  requireSetupContext('onAppHide').onAppHide(handler)

export const onAppError = (handler: (error: unknown) => void): (() => void) =>
  requireSetupContext('onAppError').onAppError(handler)

export const onUnhandledRejection = (handler: (reason: unknown) => void): (() => void) =>
  requireSetupContext('onUnhandledRejection').onUnhandledRejection(handler)

/** Latest payload of a page-level event. */
export const usePageEvent = <K extends PageEventName>(
  name: K,
): (() => PageEventPayloads[K] | undefined) => {
  const ctx = requireSetupContext('usePageEvent')
  return () => ctx.pageEvent(name)
}

/** Subscribe to a page-level event; the return value is delivered to share hooks. */
export const onPageEvent = <K extends PageEventName>(
  name: K,
  handler: (payload: PageEventPayloads[K]) => unknown,
): (() => void) => requireSetupContext('onPageEvent').onPageEvent(name, handler)

/** Run a callback when the component is moved in the node tree. */
export const onComponentMoved = (handler: () => void): (() => void) =>
  requireSetupContext('onComponentMoved').onComponentMoved(handler)

/** Run a callback before the component root is disposed. */
export const onBeforeDetach = (handler: () => void): (() => void) =>
  requireSetupContext('onBeforeDetach').onBeforeDetach(handler)

/** Accept either a resize event or its `size` payload. */
const pageSizeFrom = (value: unknown): PageSize | null => {
  if (value == null || typeof value !== 'object') return null
  const source = (value as { size?: unknown }).size ?? value
  if (source == null || typeof source !== 'object') return null
  const { windowWidth, windowHeight } = source as {
    windowWidth?: unknown
    windowHeight?: unknown
  }
  return typeof windowWidth === 'number' && typeof windowHeight === 'number'
    ? { windowWidth, windowHeight }
    : null
}

/** Seed the size signal so layout code does not wait for the first resize. */
const initialPageSize = (): PageSize | null => {
  try {
    const wx = (globalThis as { wx?: { getWindowInfo?: () => unknown } }).wx
    return pageSizeFrom(wx?.getWindowInfo?.call(wx))
  } catch {
    return null
  }
}

/**
 * A binding baseline is only valid once its batch reached the platform. A
 * failed flush substitutes this sentinel so the next update sends a whole
 * value instead of diffing against a value that was never committed.
 */
const INVALID_BASELINE = Symbol('glaze.invalidBaseline')

/** Bindings are sent as `b<index>`; map a change back to its binding slot. */
const bindingIndexOf = (change: DataChange): number | null => {
  const head = change.path[0]
  if (typeof head !== 'string' || head[0] !== 'b') return null
  const index = Number(head.slice(1))
  return Number.isInteger(index) ? index : null
}

export function defineGlazeComponent(config: GlazeComponentConfig): unknown {
  validateConfig(config)
  const publicPropertyNames = config.properties ?? []
  const structuredProps = config.structuredProps === true
  if (
    structuredProps &&
    publicPropertyNames.some((name) => name.toLowerCase() === STRUCTURED_PROP)
  ) {
    throw new Error(`Component props may not use the reserved property "${STRUCTURED_PROP}"`)
  }
  const propertyNames = structuredProps
    ? [...publicPropertyNames, STRUCTURED_PROP]
    : publicPropertyNames
  const isNotReady = (error: unknown) =>
    error instanceof NotReadyError || (error as { name?: string } | null)?.name === 'NotReadyError'
  // Only a binding with an async boundary surfaces its failure through the
  // Errored state; anything else has no channel and must still reach the log.
  const reportError = (state: InstanceState, index: number, error: unknown) => {
    if (!isNotReady(error)) notifyComponentError(state, error)
    if (state.core.bindings[index]?.errorBoundary == null) logBindingError(index, error)
  }
  const BINDING_ERROR = Symbol('glaze.bindingError')
  type BindingResult = { value: unknown } | { [BINDING_ERROR]: unknown }
  const isBindingError = (result: BindingResult): result is { [BINDING_ERROR]: unknown } =>
    Object.hasOwn(result, BINDING_ERROR)
  const sourceKey = (state: InstanceState, index: number, error: unknown) => {
    const source = (error as { source?: unknown } | null)?.source
    if (source != null) return source
    const binding = state.core.bindings[index]!
    if (binding.fallbackSource === undefined) binding.fallbackSource = { binding: index }
    return binding.fallbackSource
  }
  const clearAsync = (state: InstanceState, index: number) => {
    const binding = state.core.bindings[index]
    if (!binding) return
    const loadingBoundary = binding.loadingBoundary
    if (loadingBoundary != null && markSettled(state.boundaries, loadingBoundary, index)) {
      state.statusVersion[1](state.statusVersion[0]() + 1)
      applyAsyncStatus(state, loadingBoundary, 'loading')
    }
    const boundary = binding.errorBoundary
    if (boundary == null) return
    // The old code projected Errored only when this boundary had a consumers
    // map; `clearError` also updates the error-value signal independently.
    const hadConsumers = state.boundaries.consumers.has(boundary)
    clearError(state.boundaries, boundary, binding.source, index)
    if (hadConsumers) applyAsyncStatus(state, boundary, 'error')
  }
  const applyAsyncStatus = (
    state: InstanceState,
    boundary: number,
    kind: 'loading' | 'error',
  ) => {
    for (const status of state.asyncStatus ?? []) {
      if (status.boundary !== boundary || status.kind !== kind) continue
      // Signal writes made during the initial root pass are staged; read the
      // value after the current flush instead of projecting a stale `false`.
      const project = () =>
        state.applyStatus?.(
          status.index,
          kind === 'loading'
            ? loadingOf(state.boundaries, boundary)
            : erroredOf(state.boundaries, boundary),
        )
      if (typeof queueMicrotask === 'function') queueMicrotask(project)
      else Promise.resolve().then(project)
    }
  }
  const resetBoundary = (state: InstanceState, boundary: number) => {
    // Clears pending/error content, rewrites the status signals and bumps the
    // reset counter read by every memo in this boundary.
    resetBoundaryState(state.boundaries, boundary)
    state.statusVersion[1](state.statusVersion[0]() + 1)
    applyAsyncStatus(state, boundary, 'loading')
    applyAsyncStatus(state, boundary, 'error')
  }
  const hasPending = (state: InstanceState, boundary: number) => {
    if (hasBoundaryPending(state.boundaries, boundary)) return true
    return state.core.bindings.some(
      (binding) =>
        binding != null &&
        binding.loadingBoundary === boundary &&
        binding.settled &&
        binding.memo != null &&
        isPending(binding.memo),
    )
  }
  const armLoading = (state: InstanceState, boundary: number) => {
    if (!hasPending(state, boundary)) return
    setLoading(state.boundaries, boundary, true)
    applyAsyncStatus(state, boundary, 'loading')
  }
  const markAsync = (state: InstanceState, index: number, error: unknown) => {
    const binding = state.core.bindings[index]
    if (!binding) return
    const loadingBoundary = binding.loadingBoundary
    if (isNotReady(error)) {
      if (loadingBoundary == null) return
      if (!markPending(state.boundaries, loadingBoundary, index)) return
      applyAsyncStatus(state, loadingBoundary, 'loading')
      return
    }
    if (loadingBoundary != null && markSettled(state.boundaries, loadingBoundary, index)) {
      state.statusVersion[1](state.statusVersion[0]() + 1)
      applyAsyncStatus(state, loadingBoundary, 'loading')
    }
    const boundary = binding.errorBoundary
    if (boundary == null) return
    const source = sourceKey(state, index, error)
    if (binding.source !== undefined && binding.source !== source) {
      // A new error source replaced the old one. Drop the old consumer first,
      // or it keeps the boundary errored after the new source recovers.
      const hadConsumers = state.boundaries.consumers.has(boundary)
      clearError(state.boundaries, boundary, binding.source, index)
      if (hadConsumers) applyAsyncStatus(state, boundary, 'error')
    }
    binding.source = source
    // A repeated consumer does not re-project status, matching the old early
    // return after the error-value signal was possibly refreshed.
    if (markError(state.boundaries, boundary, source, index, error).added) {
      applyAsyncStatus(state, boundary, 'error')
    }
  }
  const deferredContext = (config.boundaryContexts?.length ?? 0) > 0
  const methods: Record<string, unknown> = {}
  methods.__glazePageEvent = function handlePageEvent(
    this: { __glaze?: InstanceState | null },
    name: PageEventName,
    payload: unknown,
  ) {
    const state = this.__glaze
    return state ? emitPageEvent(state, name, payload) : undefined
  }
  const handlerCount = config.handlerCount ?? 0
  for (let i = 0; i < handlerCount; i += 1) {
    const name = eventHandlerName(i)
    methods[name] = function handleEvent(
      this: { __glaze?: InstanceState | null },
      event?: unknown,
    ) {
      this.__glaze?.events[i]?.(event)
    }
  }

  const dataKeys = new Set(Object.keys(config.data ?? {}))
  for (const name of propertyNames) {
    if (dataKeys.has(name)) {
      throw new Error(
        `Property "${name}" collides with generated binding data key "${name}"; ` +
          'rename the prop (the data key prefix is compiler-owned)',
      )
    }
  }

  const properties = Object.fromEntries(
    propertyNames.map((name) => [
      name,
      name === CONTEXT_PROP || name === STRUCTURED_PROP
        ? { type: Object, value: null }
        : { type: null, value: null },
    ]),
  )
  const signalNames = new Set(config.propSignals ?? propertyNames)
  // Context is always observed so a boundary can wait for the property bridge.
  if (deferredContext) signalNames.add(CONTEXT_PROP)
  // Compact props only need a signal when the child reads a prop from JS. A
  // WXML-only child reads `glazeprops` directly, so adding a signal there would
  // recreate the per-prop observer cost this property exists to avoid.
  if (
    structuredProps &&
    publicPropertyNames.length >= 2 &&
    (config.propSignals === undefined || config.propSignals.length > 0)
  ) {
    signalNames.add(STRUCTURED_PROP)
  }
  const observers = Object.fromEntries(
    propertyNames.filter((name) => signalNames.has(name)).map((name) => [
      name,
      function observeProperty(this: { __glaze?: InstanceState | null }, value: unknown) {
        const state = this.__glaze
        state?.props[name]?.[1](normalizePropValue(value))
        if (
          name === CONTEXT_PROP &&
          state &&
          deferredContext &&
          !hasRoot(state.lifecycle) &&
          state.props[CONTEXT_PROP]?.[0]() != null
        ) {
          // The observer can mount a deferred component before `ready`, and
          // even after `detached`. Keep the old behavior: mount, then attach
          // only when the platform is (still) attached.
          if (state.lifecycle.phase === 'detached') {
            mount(this, state)
            state.lifecycle = { phase: 'mounted' }
          } else {
            state.lifecycle = readyMount(state.lifecycle)
            mount(this, state)
            if (state.lifecycle.phase === 'attached') attach(this, state)
          }
        }
      },
    ]),
  )
  // Null prototypes keep `props.toString` and friends from resolving through
  // Object.prototype instead of the component's real properties.
  const eventProps: Record<string, string> = Object.assign(
    Object.create(null),
    config.eventProps ?? {},
  )
  const propMap: Record<string, string> = Object.assign(Object.create(null), config.propMap ?? {})
  const listBindings: Record<string, string> = Object.assign(
    Object.create(null),
    config.listBindings ?? {},
  )
  const listFields: Record<string, string[]> = Object.assign(
    Object.create(null),
    config.listFields ?? {},
  )

  const isListBinding = (index: number) => Object.hasOwn(listBindings, index)
  /**
   * Build the component-data payload and the next diff baseline for one
   * binding. List payloads are always detached snapshots: the platform applies
   * path updates by mutating the data object in place (and `*this` used to
   * hand the application array over unchanged). Payload and baseline are
   * separate snapshots so a platform mutation of one cannot reach the other or
   * the application row.
   */
  const materialize = (index: number, value: unknown): { payload: unknown; baseline: unknown } => {
    if (!isListBinding(index)) return { payload: normalizeDataValue(value), baseline: value }
    const key = listBindings[index]
    const fields = listFields[index]
    const projected =
      !fields || !key || key === '*this'
        ? value
        : projectList(value, fields.includes(key) ? fields : [...fields, key])
    return {
      payload: normalizeDataValue(snapshotList(projected)),
      baseline: snapshotList(projected),
    }
  }

  const mount = (component: any, state: InstanceState) => {
    resetBindingStates(state.core.bindings)
    state.effectsInstalled = false
    clearBoundaryContent(state.boundaries)
    state.events.length = 0
    state.refs.length = 0
    state.errorHandlers.length = 0
    state.movedHandlers.length = 0
    state.beforeDetachHandlers.length = 0
    state.pageHandlers.clear()
    state.error = undefined
    state.owner = null

    state.dispose = createRoot((dispose) => {
      const setupContext: GlazeContext = {
        bind(index, fn, asyncBoundary = null, errorBoundary = asyncBoundary) {
          state.core.bindings[index] = createBindingState({
            raw: fn,
            loadingBoundary: asyncBoundary,
            errorBoundary,
          })
        },
        event(index, fn) {
          state.events[index] = fn
        },
        ref(index, fn) {
          state.refs[index] = { id: `glaze-r${index}`, fn }
        },
        context(context: GlazeContextProvider) {
          const value = useContext(context as never)
          return isContextReader(value) ? value : () => value
        },
        loadingOn(boundary: number, fn: () => unknown) {
          state.boundaries.loadingOn.set(boundary, fn)
        },
        reset(boundary: number) {
          resetBoundary(state, boundary)
        },
        loading: (boundary) => loadingOf(state.boundaries, boundary),
        errored: (boundary) => erroredOf(state.boundaries, boundary),
        error: (boundary) => errorValueOf(state.boundaries, boundary),
        errorArray: (boundary) => errorArrayOf(state.boundaries, boundary),
        pageVisible: () => state.pageVisible[0](),
        pageSize: () => state.pageSize[0](),
        appVisible: () => {
          installAppLifecycle()
          return appVisible()
        },
        appLaunchOptions: () => {
          installAppLifecycle()
          return appLaunchOptionsValue
        },
        onAppShow: (handler) => subscribeApp(appShowHandlers, handler),
        onAppHide: (handler) => subscribeApp(appHideHandlers, handler),
        onAppError: (handler) => subscribeApp(appErrorHandlers, handler),
        onUnhandledRejection: (handler) => subscribeApp(unhandledRejectionHandlers, handler),
        pageEvent: <K extends PageEventName>(name: K) => {
          state.pageEventVersion[0]()
          return state.pageEvents.get(name) as PageEventPayloads[K] | undefined
        },
        onPageEvent: <K extends PageEventName>(
          name: K,
          handler: (payload: PageEventPayloads[K]) => unknown,
        ) => {
          const handlers = state.pageHandlers.get(name) ?? new Set()
          handlers.add(handler as (payload: unknown) => unknown)
          state.pageHandlers.set(name, handlers)
          return () => {
            handlers.delete(handler as (payload: unknown) => unknown)
            if (handlers.size === 0) state.pageHandlers.delete(name)
          }
        },
        onComponentError(handler) {
          state.errorHandlers.push(handler)
          return () => {
            const index = state.errorHandlers.indexOf(handler)
            if (index >= 0) state.errorHandlers.splice(index, 1)
          }
        },
        onComponentMoved(handler) {
          state.movedHandlers.push(handler)
          return () => {
            const index = state.movedHandlers.indexOf(handler)
            if (index >= 0) state.movedHandlers.splice(index, 1)
          }
        },
        onBeforeDetach(handler) {
          state.beforeDetachHandlers.push(handler)
          return () => {
            const index = state.beforeDetachHandlers.indexOf(handler)
            if (index >= 0) state.beforeDetachHandlers.splice(index, 1)
          }
        },
      }
      const previousSetupContext = activeSetupContext
      activeSetupContext = setupContext
      try {
        config.setup(setupContext, state.propsProxy!)
      } finally {
        activeSetupContext = previousSetupContext
      }
      state.owner = getOwner()

      const initial: Record<string, unknown> = {}
      for (let index = 0; index < state.core.bindings.length; index += 1) {
        const binding = state.core.bindings[index]
        if (!binding?.raw) continue
        try {
          const value = binding.raw()
          binding.initial = value
          const { payload, baseline } = materialize(index, value)
          binding.previous = baseline
          // The initial pass already committed a value, so the boundary status
          // effect below may probe `isPending` for a later refetch.
          if (binding.loadingBoundary != null || binding.errorBoundary != null) {
            binding.settled = true
          }
          // Platform path updates mutate the data object in place. List data
          // must not alias the signal array, or the next page instance would
          // inherit a row mutated by the previous one.
          initial[`b${index}`] = payload
        } catch (error) {
          // One async or broken binding must not prevent the component from
          // rendering the remaining values.
          if (!isNotReady(error)) state.error = error
          markAsync(state, index, error)
          reportError(state, index, error)
        }
      }
      // Components with async boundaries get one memo per binding. The memo
      // is a real Solid graph node, so the data effects and status probes read
      // the same cached value instead of evaluating the expression twice.
      // Initial values above still call the raw binding first: a memo created
      // before that pass could cache a first-attempt error and never retry.
      if (state.core.bindings.some((binding) => binding?.loadingBoundary != null)) {
        for (const binding of state.core.bindings) {
          if (binding?.loadingBoundary != null) {
            loadingOf(state.boundaries, binding.loadingBoundary)
          }
        }
        for (let index = 0; index < state.core.bindings.length; index += 1) {
          const binding = state.core.bindings[index]
          const raw = binding?.raw
          if (!binding || !raw) continue
          // A memo is a real Solid graph node. Real (non-NotReady) failures
          // become values so they cannot halt the reactive system; the data
          // effect unwraps the error and keeps the existing skip/log path.
          const boundaryId = binding.loadingBoundary
          const errorBoundaryId = binding.errorBoundary
          const memo = createMemo<BindingResult>(
            () => {
              // A boundary reset bumps this signal; reading it here makes the
              // memo retry even when its own dependencies did not change.
              if (boundaryId != null) resetVersionOf(state.boundaries, boundaryId)
              if (errorBoundaryId != null && errorBoundaryId !== boundaryId) {
                resetVersionOf(state.boundaries, errorBoundaryId)
              }
              try {
                return { value: raw() }
              } catch (error) {
                if (isNotReady(error)) throw error
                return { [BINDING_ERROR]: error }
              }
            },
            isListBinding(index) ? { equals: false } : undefined,
          )
          binding.memo = memo
          binding.read = () => {
            const result = memo() as BindingResult
            if (isBindingError(result)) throw result[BINDING_ERROR]
            return result.value
          }
        }
      }
      // Pending/error signals remain runtime-owned; the memos above keep each
      // binding a single cached Solid graph node.
      component.setData(initial)
      return dispose
    })
  }

  const attach = (component: any, state: InstanceState) => {
    // A waiting deferred instance has no root or owner, and `ready` may have
    // installed the effects before the platform's `attached`. Neither path may
    // build a second set of binding effects.
    if (!hasRoot(state.lifecycle) || state.owner == null || state.effectsInstalled) return
    // `canSplice` must mean "a splice can actually and safely be committed". A
    // component without a group or data proxy falls to the setData fallback,
    // and a grouped transport without `replaceDataOnPath` can overwrite a
    // splice with a replacement queued after the group; list changes then take
    // the whole-value path instead of being dropped or lost.
    const transport = createDataTransport(component)

    const schedule = (changes: DataChange[]) => {
      if (changes.length === 0) return
      for (const change of changes) state.pending.push(change)
      if (state.flushScheduled) return
      state.flushScheduled = true
      const flush = () => {
        state.flushScheduled = false
        const pending = state.pending
        state.pending = []
        if (!platformAttached(state.lifecycle) || pending.length === 0) return
        try {
          transport.apply(pending)
        } catch (error) {
          // `binding.previous` was advanced when this batch was scheduled, but
          // the platform never received it. Invalidate every baseline in the
          // batch so the next change sends a whole value; the failed batch
          // itself is intentionally not replayed.
          for (const change of pending) {
            const index = bindingIndexOf(change)
            if (index == null) continue
            const binding = state.core.bindings[index]
            if (binding) binding.previous = INVALID_BASELINE
          }
          notifyComponentError(state, error)
          reportTransportError(error)
        }
      }
      if (typeof queueMicrotask === 'function') queueMicrotask(flush)
      else Promise.resolve().then(flush)
    }

    const applyBinding = (index: number, value: unknown) => {
      const binding = state.core.bindings[index]
      if (!binding) return
      if (binding.loadingBoundary != null || binding.errorBoundary != null) binding.settled = true
      clearAsync(state, index)
      const key = listBindings[index]
      // Scalar bindings in one effect group are recomputed together. Skip the
      // unchanged ones so one signal write only produces its own data path,
      // which also keeps the template engine on its binding-map path longer.
      if (!key && Object.is(value, binding.previous)) return
      const name = `b${index}`
      const { payload, baseline } = materialize(index, value)
      const changes = key
        ? diffList(binding.previous, payload, key, name, transport.canSplice)
        : null
      schedule(changes ?? [{ path: [name], value: payload }])
      binding.previous = baseline
    }

    // Status conditions are projected directly from the same signals the
    // binding effects use. Their own effect can be held by an unrelated pending
    // read in the component; the direct write keeps the fallback state visible.
    state.applyStatus = (index, value) => applyBinding(index, value)
    for (const status of config.asyncStatus ?? []) {
      const project = () =>
        applyBinding(
          status.index,
          status.kind === 'loading'
            ? loadingOf(state.boundaries, status.boundary)
            : erroredOf(state.boundaries, status.boundary),
        )
      if (typeof queueMicrotask === 'function') queueMicrotask(project)
      else Promise.resolve().then(project)
    }

    const boundaryIndexes = new Map<number, number[]>()
    state.core.bindings.forEach((binding, index) => {
      const boundary = binding?.loadingBoundary
      if (!binding?.memo || boundary == null) return
      const indexes = boundaryIndexes.get(boundary) ?? []
      indexes.push(index)
      boundaryIndexes.set(boundary, indexes)
    })
    runWithOwner(state.owner, () => {
      for (const [boundary, indexes] of boundaryIndexes) {
        createEffect(
          () => {
            state.statusVersion[0]()
            // Initial pending is captured by `markAsync`; `isPending` has no
            // value to report until the first content has landed.
            if (hasBoundaryPending(state.boundaries, boundary)) return
            const pending = indexes.some((index) => {
              const binding = state.core.bindings[index]
              return (
                binding?.settled === true &&
                binding.memo != null &&
                isPending(binding.memo)
              )
            })
            setLoading(state.boundaries, boundary, pending)
            applyAsyncStatus(state, boundary, 'loading')
          },
          {
            effect() {},
            error(error) {
              if (!isNotReady(error)) state.error = error
            },
          },
        )
      }
    })

    // `Loading on` is a dependency trigger: on a change after mount, show the
    // fallback again if anything under this boundary is still pending. Solid
    // holds a frame for the new content; Glaze has no held frame, so a change
    // with nothing pending does nothing (the status effect will show it when a
    // pending read starts).
    runWithOwner(state.owner, () => {
      for (const [boundary, fn] of state.boundaries.loadingOn) {
        let first = true
        try {
          createEffect(fn, {
            effect() {
              if (first) {
                first = false
                return
              }
              armLoading(state, boundary)
            },
            error(error) {
              if (!isNotReady(error)) state.error = error
            },
          })
        } catch (error) {
          if (!isNotReady(error)) state.error = error
        }
      }
    })

    for (const ref of state.refs.filter(Boolean)) createNodeRef(component, ref.id, ref.fn)

    const createBindingEffect = (index: number) => {
      const binding = state.core.bindings[index]
      const fn = binding?.read
      if (!binding || !fn) return
      let first = true
      try {
        createEffect(fn, {
          effect(value) {
            if (first) {
              first = false
              if (Object.is(value, binding.initial)) return
            }
            try {
              applyBinding(index, value)
            } catch (error) {
              if (!isNotReady(error)) state.error = error
              markAsync(state, index, error)
              reportError(state, index, error)
            }
          },
          error(error) {
            // A failed compute keeps the last applied value; later changes can
            // recover, and other bindings keep their own effects running.
            first = false
            if (!isNotReady(error)) state.error = error
            markAsync(state, index, error)
            reportError(state, index, error)
          },
        })
      } catch (error) {
        // Even a synchronous effect-creation failure must not stop the
        // remaining bindings from being created.
        reportError(state, index, error)
      }
    }

    // Scalar bindings are grouped so a component with many fields does not
    // create one effect per field. Groups stay small so one change does not
    // recompute a large page; list bindings keep their own effect because
    // arrays can be expensive to diff.
    const statusIndexes = new Set((config.asyncStatus ?? []).map((status) => status.index))
    const scalarIndexes: number[] = []
    state.core.bindings.forEach((binding, index) => {
      if (!binding?.read || Object.hasOwn(listBindings, index) || statusIndexes.has(index)) return
      scalarIndexes.push(index)
    })
    const groupSize =
      Number.isInteger(config.bindingGroupSize) && config.bindingGroupSize! > 0
        ? config.bindingGroupSize!
        : SCALAR_BINDING_GROUP
    const scalarGroups: number[][] = []
    for (let offset = 0; offset < scalarIndexes.length; offset += groupSize) {
      scalarGroups.push(scalarIndexes.slice(offset, offset + groupSize))
    }

    runWithOwner(state.owner, () => {
      for (const group of scalarGroups) {
        let first = true
        try {
          createEffect(
            () =>
              group.map((index) => {
                try {
                  return { index, value: state.core.bindings[index]!.read!() }
                } catch (error) {
                  if (!isNotReady(error)) state.error = error
                  markAsync(state, index, error)
                  reportError(state, index, error)
                  return { index, value: undefined, failed: true }
                }
              }),
            {
              effect(values) {
                if (first) {
                  first = false
                  const unchanged = values.every((item) => {
                    if (item.failed || item.value === undefined) return true
                    return Object.is(item.value, state.core.bindings[item.index]?.initial)
                  })
                  if (unchanged) return
                }
                for (const item of values) {
                  if (item.failed) continue
                  try {
                    applyBinding(item.index, item.value)
                  } catch (error) {
                    reportError(state, item.index, error)
                  }
                }
              },
              error(error) {
                first = false
                if (!isNotReady(error)) state.error = error
                for (const index of group) markAsync(state, index, error)
                reportError(state, group[0] ?? 0, error)
              },
            },
          )
        } catch (error) {
          reportError(state, group[0] ?? 0, error)
        }
      }
      state.core.bindings.forEach((binding, index) => {
        if (binding?.read && Object.hasOwn(listBindings, index) && !statusIndexes.has(index)) {
          createBindingEffect(index)
        }
      })
    })
    state.effectsInstalled = true
  }

  return Component({
    data: config.data ?? {},
    properties,
    observers,
    // glass-easel defaults to initializing properties after `created`, which
    // would make the first binding pass see every prop as null. Initialize them
    // before `created` so the first paint already has real prop values.
    options: { propertyEarlyInit: true },
    lifetimes: {
      created(this: any) {
        const state: InstanceState = {
          core: { bindings: [] },
          boundaries: createBoundaryState(),
          lifecycle: initialLifecycle(deferredContext),
          events: [],
          refs: [],
          pending: [],
          statusVersion: createSignal(0),
          asyncStatus: config.asyncStatus,
          applyStatus: null,
          flushScheduled: false,
          effectsInstalled: false,
          pageVisible: createSignal(true),
          pageSize: createSignal(initialPageSize()),
          pageEvents: new Map(),
          pageEventVersion: createSignal(0),
          pageHandlers: new Map(),
          errorHandlers: [],
          movedHandlers: [],
          beforeDetachHandlers: [],
          props: Object.create(null),
          propsProxy: null,
          owner: null,
          dispose: null,
          error: undefined,
        }
        this.__glaze = state

        for (const name of signalNames) {
          state.props[name] = createSignal(normalizePropValue(this.properties?.[name]))
        }
        const sourceNames =
          Object.keys(propMap).length > 0 ? Object.keys(propMap) : publicPropertyNames
        state.propsProxy = new Proxy(
          {},
          {
            get: (_, key: string | symbol) => {
              if (typeof key !== 'string') return undefined
              if (key === STRUCTURED_PROP) return undefined
              if (Object.hasOwn(eventProps, key)) {
                const eventName = eventProps[key]!
                return (...args: unknown[]) =>
                  this.triggerEvent(eventName, args.length <= 1 ? args[0] : args, GLAZE_EVENT_OPTIONS)
              }
              const mapped = Object.hasOwn(propMap, key) ? propMap[key]! : key
              if (mapped !== CONTEXT_PROP && !isPrototypePropName(mapped)) {
                const structured = state.props[STRUCTURED_PROP]?.[0]()
                if (
                  structured != null &&
                  typeof structured === 'object' &&
                  Object.hasOwn(structured, mapped)
                ) {
                  // Match the WXML projection: an explicit undefined field is
                  // treated as absent, while a null field is a real value.
                  const value = (structured as Record<string, unknown>)[mapped]
                  if (value !== undefined) return normalizePropValue(value)
                }
              }
              return Object.hasOwn(state.props, mapped) ? state.props[mapped]![0]() : undefined
            },
            has: (_, key: string | symbol) =>
              typeof key === 'string' &&
              key !== STRUCTURED_PROP &&
              (Object.hasOwn(eventProps, key) ||
                Object.hasOwn(propMap, key) ||
                Object.hasOwn(state.props, key)),
            set: () => {
              throw new TypeError(
                'Glaze props are read-only; assign to a local signal or store instead',
              )
            },
            deleteProperty: () => {
              throw new TypeError(
                'Glaze props are read-only; assign to a local signal or store instead',
              )
            },
            defineProperty: () => {
              throw new TypeError(
                'Glaze props are read-only; assign to a local signal or store instead',
              )
            },
            ownKeys: () => [...new Set([...sourceNames, ...Object.keys(eventProps)])],
            getOwnPropertyDescriptor: (_, key: string | symbol) =>
              typeof key === 'string' &&
              key !== STRUCTURED_PROP &&
              (Object.hasOwn(eventProps, key) ||
                Object.hasOwn(propMap, key) ||
                Object.hasOwn(state.props, key))
                ? { enumerable: true, configurable: true }
                : undefined,
          },
        )

        if (!deferredContext) {
          state.lifecycle = mountImmediately(state.lifecycle)
          mount(this, state)
        }
      },

      attached(this: any) {
        const state: InstanceState | undefined = this.__glaze
        if (!state) return
        const phase = state.lifecycle
        // A repeated `attached`, including one recorded while waiting for a
        // deferred root, is a no-op (the old `state.active` guard).
        if (
          phase.phase === 'attached' ||
          (phase.phase === 'waiting-context' && phase.attachedBeforeMount)
        ) {
          return
        }
        if (phase.phase === 'waiting-context') {
          // No root yet: record the platform attach without building effects.
          state.lifecycle = attachWhileWaiting(phase)
        } else if (phase.phase === 'detached') {
          // Re-attaching after `detached`: rebuild the disposed root first.
          state.lifecycle = reattach(phase)
          mount(this, state)
        } else if (phase.phase === 'unmounted') {
          state.lifecycle = attachLifecycle(mountImmediately(phase))
          mount(this, state)
        } else {
          state.lifecycle = attachLifecycle(phase)
        }
        attach(this, state)
      },

      ready(this: any) {
        const state: InstanceState | undefined = this.__glaze
        if (!state || !deferredContext || hasRoot(state.lifecycle)) return
        // A platform that detached before `ready` must not get a root from a
        // late ready: nothing would own that root until the next attach.
        if (state.lifecycle.phase === 'detached') return
        // A context passed through the property bridge is not available while
        // `created` runs (the parent's first setData may land afterwards).
        // Wait for `ready`, when the property is materialized, then build the
        // provider chain and the component's normal setup. Without a value the
        // providers are skipped and `useContext` falls back to its default.
        // `ready` always mounts and attaches (as before); the phase only
        // records whether the platform had attached before the root existed.
        state.lifecycle = readyMount(state.lifecycle)
        mount(this, state)
        attach(this, state)
      },

      error(this: any, error: unknown) {
        const state: InstanceState | undefined = this.__glaze
        if (!state) return
        notifyComponentError(state, error)
      },

      moved(this: any) {
        const state: InstanceState | undefined = this.__glaze
        if (!state) return
        for (const handler of [...state.movedHandlers]) {
          try {
            handler()
          } catch (error) {
            notifyComponentError(state, error)
            reportUnhandledComponentError(state, error)
          }
        }
      },

      beforeDetach(this: any) {
        const state: InstanceState | undefined = this.__glaze
        if (!state) return
        for (const handler of [...state.beforeDetachHandlers]) {
          try {
            handler()
          } catch (error) {
            notifyComponentError(state, error)
            reportUnhandledComponentError(state, error)
          }
        }
      },

      detached(this: any) {
        const state: InstanceState | undefined = this.__glaze
        if (!state) return
        // Keep the state (including prop signals) so a later `attached` can
        // rebuild the disposed root instead of seeing a dead instance.
        state.lifecycle = detachLifecycle(state.lifecycle)
        state.pending = []
        state.flushScheduled = false
        // Match the old detached behavior: event and ref callbacks stop until
        // the root is rebuilt on re-attach.
        state.events.length = 0
        state.refs.length = 0
        state.errorHandlers.length = 0
        state.movedHandlers.length = 0
        state.beforeDetachHandlers.length = 0
        state.pageHandlers.clear()
        state.applyStatus = null
        state.effectsInstalled = false
        state.dispose?.()
        state.dispose = null
        state.owner = null
      },
    },
    pageLifetimes: {
      show(this: any) {
        this.__glaze?.pageVisible[1](true)
      },
      hide(this: any) {
        this.__glaze?.pageVisible[1](false)
      },
      resize(this: any, event: unknown) {
        const size = pageSizeFrom(event)
        if (size) this.__glaze?.pageSize[1](size)
      },
      routeDone(this: any, event: unknown) {
        const state: InstanceState | undefined = this.__glaze
        if (state) emitPageEvent(state, 'routeDone', event)
      },
    },
    methods,
  })
}
