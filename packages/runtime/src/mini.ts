import {
  createEffect,
  createMemo,
  isPending,
  NotReadyError,
  createRoot,
  createSignal,
  getOwner,
  runWithOwner,
} from 'solid-js'
import {
  dataKey,
  normalizeDataValue,
  normalizePropValue,
  GLAZE_EVENT_OPTIONS,
  reportBindingError as logBindingError,
  SCALAR_BINDING_GROUP,
} from './data.ts'
import { listOps, listPatch } from './list.ts'
import { withBoundaryContexts, withProvider } from './provider.ts'
import { createNodeRef } from './ref.ts'
declare const Component: (options: Record<string, unknown>) => unknown

import type {
  GlazeBinding,
  GlazeComponentConfig,
  DataChange,
  GlazeContext,
  GlazeProps,
  InstanceState,
} from './types.ts'

export { className, styleName } from './styles.ts'
export { withBoundaryContexts, withProvider } from './provider.ts'
export { listOps, listPatch } from './list.ts'
export type { GlazeComponentConfig, GlazeContext, GlazeNode } from './types.ts'

export function defineGlazeComponent(config: GlazeComponentConfig): unknown {
  const propertyNames = config.properties ?? []
  const isNotReady = (error: unknown) =>
    error instanceof NotReadyError || (error as { name?: string } | null)?.name === 'NotReadyError'
  const reportError = (index: number, error: unknown) => {
    if (!config.errorBoundary) logBindingError(index, error)
  }
  const BINDING_ERROR = Symbol('glaze.bindingError')
  type BindingResult = { value: unknown } | { [BINDING_ERROR]: unknown }
  const isBindingError = (result: BindingResult): result is { [BINDING_ERROR]: unknown } =>
    Object.hasOwn(result, BINDING_ERROR)
  type BoundarySignal = [() => boolean, (value: boolean) => void]
  type BoundaryValueSignal = [() => unknown, (value: unknown) => void]
  const boundarySignal = (
    signals: Map<number, BoundarySignal>,
    boundary: number,
  ): BoundarySignal => {
    let signal = signals.get(boundary)
    if (!signal) {
      signal = createSignal(false)
      signals.set(boundary, signal)
    }
    return signal
  }
  const boundaryValueSignal = (
    signals: Map<number, BoundaryValueSignal>,
    boundary: number,
  ): BoundaryValueSignal => {
    let signal = signals.get(boundary)
    if (!signal) {
      signal = createSignal<unknown>(null)
      signals.set(boundary, signal)
    }
    return signal
  }
  const normalizeAsyncError = (error: unknown): unknown => {
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
  const sourceKey = (state: InstanceState, index: number, error: unknown) => {
    const source = (error as { source?: unknown } | null)?.source
    if (source != null) return source
    let fallback = state.fallbackSources[index]
    if (fallback === undefined) {
      fallback = { binding: index }
      state.fallbackSources[index] = fallback
    }
    return fallback
  }
  const clearAsync = (state: InstanceState, index: number) => {
    const boundary = state.bindingBoundaries[index]
    if (boundary == null) return
    const pending = state.asyncPending.get(boundary)
    if (pending?.delete(index)) {
      if (pending.size === 0) state.asyncPending.delete(boundary)
      state.statusVersion[1](state.statusVersion[0]() + 1)
      const loading = pending.size > 0
      boundarySignal(state.loadingSignals, boundary)[1](loading)
      applyAsyncStatus(state, boundary, 'loading')
    }
    const source = state.bindingSources[index]
    const sources = state.errorBindings.get(boundary)
    if (sources) {
      const consumers = sources.get(source)
      consumers?.delete(index)
      if (consumers?.size === 0) {
        sources.delete(source)
        state.errorValues.get(boundary)?.delete(source)
      }
      if (sources.size === 0) state.errorBindings.delete(boundary)
      boundarySignal(state.errorSignals, boundary)[1](sources.size > 0)
      applyAsyncStatus(state, boundary, 'error')
    }
    const errors = state.errorValues.get(boundary)
    if (errors) {
      if (errors.size === 0) state.errorValues.delete(boundary)
      boundaryValueSignal(state.errorValueSignals, boundary)[1](
        errors.size > 0 ? normalizeAsyncError(errors.values().next().value) : null,
      )
    }
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
            ? boundarySignal(state.loadingSignals, boundary)[0]()
            : boundarySignal(state.errorSignals, boundary)[0](),
        )
      if (typeof queueMicrotask === 'function') queueMicrotask(project)
      else Promise.resolve().then(project)
    }
  }
  const markAsync = (state: InstanceState, index: number, error: unknown) => {
    const boundary = state.bindingBoundaries[index]
    if (boundary == null) return
    if (isNotReady(error)) {
      const pending = state.asyncPending.get(boundary) ?? new Set<number>()
      if (pending.has(index)) return
      pending.add(index)
      state.asyncPending.set(boundary, pending)
      boundarySignal(state.loadingSignals, boundary)[1](true)
      applyAsyncStatus(state, boundary, 'loading')
      return
    }
    const source = sourceKey(state, index, error)
    state.bindingSources[index] = source
    const sources = state.errorBindings.get(boundary) ?? new Map<unknown, Set<number>>()
    const consumers = sources.get(source) ?? new Set<number>()
    if (consumers.has(index)) return
    consumers.add(index)
    sources.set(source, consumers)
    state.errorBindings.set(boundary, sources)
    boundarySignal(state.errorSignals, boundary)[1](true)
    applyAsyncStatus(state, boundary, 'error')
    const values = state.errorValues.get(boundary) ?? new Map<unknown, unknown>()
    values.set(source, error)
    state.errorValues.set(boundary, values)
    boundaryValueSignal(state.errorValueSignals, boundary)[1](normalizeAsyncError(error))
  }
  const deferredContext = (config.boundaryContexts?.length ?? 0) > 0
  const methods: Record<string, unknown> = {}
  const handlerCount = config.handlerCount ?? 0
  for (let i = 0; i < handlerCount; i += 1) {
    const name = `e${i}`
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
      name === 'glazecontext' ? { type: Object, value: null } : { type: null, value: null },
    ]),
  )
  const observers = Object.fromEntries(
    propertyNames.map((name) => [
      name,
      function observeProperty(this: { __glaze?: InstanceState | null }, value: unknown) {
        const state = this.__glaze
        state?.props[name]?.[1](normalizePropValue(value))
        if (
          name === 'glazecontext' &&
          state &&
          deferredContext &&
          !state.mounted &&
          state.props.glazecontext?.[0]() != null
        ) {
          mount(this, state)
          if (state.active) attach(this, state)
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

  const isListBinding = (index: number) => Object.hasOwn(listBindings, index)
  const snapshotValue = (index: number, value: unknown) =>
    isListBinding(index) && Array.isArray(value) ? value.slice() : value

  const mount = (component: any, state: InstanceState) => {
    state.bindings.length = 0
    state.bindingFns.length = 0
    state.asyncPending.clear()
    state.bindingMemos.length = 0
    state.settled.length = 0
    state.events.length = 0
    state.refs.length = 0
    state.initial.length = 0
    state.previous.length = 0
    state.errorBindings.clear()
    state.errorValues.clear()
    state.bindingBoundaries.length = 0
    state.bindingSources.length = 0
    state.fallbackSources.length = 0
    state.loadingSignals.forEach((signal) => signal[1](false))
    state.errorSignals.forEach((signal) => signal[1](false))
    state.errorValueSignals.forEach((signal) => signal[1](null))
    state.error = undefined
    state.owner = null

    state.dispose = createRoot((dispose) => {
      config.setup(
        {
          bind(index, fn, asyncBoundary = null) {
            state.bindingFns[index] = fn
            state.bindings[index] = fn
            state.bindingBoundaries[index] = asyncBoundary
          },
          event(index, fn) {
            state.events[index] = fn
          },
          ref(index, fn) {
            state.refs[index] = { id: `glaze-r${index}`, fn }
          },
          loading: (boundary) => boundarySignal(state.loadingSignals, boundary)[0](),
          errored: (boundary) => boundarySignal(state.errorSignals, boundary)[0](),
          error: (boundary) => boundaryValueSignal(state.errorValueSignals, boundary)[0](),
          errorArray: (boundary) => {
            const value = boundaryValueSignal(state.errorValueSignals, boundary)[0]()
            return value == null ? [] : [value]
          },
        },
        state.propsProxy!,
      )
      state.owner = getOwner()

      const initial: Record<string, unknown> = {}
      state.bindingFns.forEach((fn, index) => {
        if (!fn) return
        try {
          const value = fn()
          state.initial[index] = value
          state.previous[index] = snapshotValue(index, value)
          initial[`b${index}`] = normalizeDataValue(value)
        } catch (error) {
          // One async or broken binding must not prevent the component from
          // rendering the remaining values.
          if (!isNotReady(error)) state.error = error
          markAsync(state, index, error)
          reportError(index, error)
        }
      })
      // Components with async boundaries get one memo per binding. The memo
      // is a real Solid graph node, so the data effects and status probes read
      // the same cached value instead of evaluating the expression twice.
      // Initial values above still call the raw binding first: a memo created
      // before that pass could cache a first-attempt error and never retry.
      if (state.bindingBoundaries.some((boundary) => boundary != null)) {
        for (const boundary of new Set(state.bindingBoundaries)) {
          if (boundary != null) boundarySignal(state.loadingSignals, boundary)
        }
        state.bindingMemos = state.bindingFns.map((fn, index) => {
          if (!fn) return null
          // A memo is a real Solid graph node. Real (non-NotReady) failures
          // become values so they cannot halt the reactive system; the data
          // effect unwraps the error and keeps the existing skip/log path.
          return createMemo<BindingResult>(
            () => {
              try {
                return { value: fn() }
              } catch (error) {
                if (isNotReady(error)) throw error
                return { [BINDING_ERROR]: error }
              }
            },
            isListBinding(index) ? { equals: false } : undefined,
          )
        })
        state.bindings = state.bindingMemos.map((memo) =>
          memo
            ? () => {
                const result = memo() as BindingResult
                if (isBindingError(result)) throw result[BINDING_ERROR]
                return result.value
              }
            : undefined!,
        )
      }
      // Pending/error signals remain runtime-owned; the memos above keep each
      // binding a single cached Solid graph node.
      component.setData(initial)
      return dispose
    })
    state.mounted = true
  }

  const attach = (component: any, state: InstanceState) => {
    const applyPending = (pending: DataChange[]) => {
      const dataGroup = (
        Component as unknown as {
          getDataProxy?: (comp: unknown) => {
            getChanges?: () => unknown[]
            setChanges?: (changes: unknown[]) => void
            applyDataUpdates?: () => void
          }
        }
      ).getDataProxy?.(component) ??
        (
          component as {
            _$dataGroup?: {
              getChanges?: () => unknown[]
              setChanges?: (changes: unknown[]) => void
              applyDataUpdates?: () => void
            }
          }
        )._$dataGroup
      if (
        dataGroup &&
        typeof dataGroup.getChanges === 'function' &&
        typeof dataGroup.setChanges === 'function' &&
        typeof dataGroup.applyDataUpdates === 'function'
      ) {
        // Keep changes another writer queued before this flush, then append
        // ours as glass-easel's own DataChange tuples. This is the same queue
        // `replaceDataOnPath`/`spliceArrayDataOnPath` fill, but it avoids one
        // component method call per field and applies replace + splice in one
        // template update.
        const queued = dataGroup.getChanges()
        dataGroup.setChanges([
          ...queued,
          ...pending.map((change) =>
            change.splice
              ? [
                  change.path,
                  change.splice.inserts,
                  change.splice.index,
                  change.splice.del,
                ]
              : [change.path, normalizeDataValue(change.value), undefined, undefined],
          ),
        ])
        dataGroup.applyDataUpdates()
        return
      }
      if (
        typeof component.groupUpdates === 'function' &&
        (typeof component.replaceDataOnPath === 'function' ||
          typeof component.spliceArrayDataOnPath === 'function')
      ) {
        const replacements: DataChange[] = []
        component.groupUpdates(() => {
          for (const change of pending) {
            if (change.splice) {
              component.spliceArrayDataOnPath?.(
                change.path,
                change.splice.index,
                change.splice.del,
                change.splice.inserts,
              )
            } else if (typeof component.replaceDataOnPath === 'function') {
              component.replaceDataOnPath(change.path, normalizeDataValue(change.value))
            } else {
              replacements.push(change)
            }
          }
        })
        if (replacements.length > 0) {
          component.setData(
            Object.fromEntries(
              replacements.map((change) => [dataKey(change.path), normalizeDataValue(change.value)]),
            ),
          )
        }
        return
      }
      component.setData(
        Object.fromEntries(
          pending
            .filter((change) => !change.splice)
            .map((change) => [dataKey(change.path), normalizeDataValue(change.value)]),
        ),
      )
    }

    const schedule = (changes: DataChange[]) => {
      if (changes.length === 0) return
      for (const change of changes) state.pending.push(change)
      if (state.flushScheduled) return
      state.flushScheduled = true
      const flush = () => {
        state.flushScheduled = false
        const pending = state.pending
        state.pending = []
        if (!state.active || pending.length === 0) return
        applyPending(pending)
      }
      if (typeof queueMicrotask === 'function') queueMicrotask(flush)
      else Promise.resolve().then(flush)
    }

    const applyBinding = (index: number, value: unknown) => {
      if (state.bindingBoundaries[index] != null) state.settled[index] = true
      clearAsync(state, index)
      const key = listBindings[index]
      // Scalar bindings in one effect group are recomputed together. Skip the
      // unchanged ones so one signal write only produces its own data path,
      // which also keeps the template engine on its binding-map path longer.
      if (!key && Object.is(value, state.previous[index])) return
      const binding = `b${index}`
      const patch = key ? listPatch(state.previous[index], value, key, binding) : null
      if (patch) {
        schedule(patch)
      } else {
        const ops =
          key && typeof component.spliceArrayDataOnPath === 'function'
            ? listOps(state.previous[index], value, key)
            : null
        if (ops) {
          schedule(
            ops.map((op) => ({
              path: [binding] as (string | number)[],
              splice: op,
            })),
          )
        } else {
          schedule([{ path: [binding], value }])
        }
      }
      state.previous[index] = snapshotValue(index, value)
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
            ? boundarySignal(state.loadingSignals, status.boundary)[0]()
            : boundarySignal(state.errorSignals, status.boundary)[0](),
        )
      if (typeof queueMicrotask === 'function') queueMicrotask(project)
      else Promise.resolve().then(project)
    }

    const boundaryIndexes = new Map<number, number[]>()
    state.bindingMemos.forEach((memo, index) => {
      const boundary = state.bindingBoundaries[index]
      if (memo && boundary != null) {
        const indexes = boundaryIndexes.get(boundary) ?? []
        indexes.push(index)
        boundaryIndexes.set(boundary, indexes)
      }
    })
    for (const [boundary, indexes] of boundaryIndexes) {
      createEffect(
        () => {
          state.statusVersion[0]()
          // Initial pending is captured by `markAsync`; `isPending` has no
          // value to report until the first content has landed.
          if ((state.asyncPending.get(boundary)?.size ?? 0) > 0) return
          const pending = indexes.some(
            (index) => state.settled[index] && isPending(state.bindingFns[index]!),
          )
          boundarySignal(state.loadingSignals, boundary)[1](pending)
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

    for (const ref of state.refs.filter(Boolean)) createNodeRef(component, ref.id, ref.fn)

    const createBindingEffect = (index: number) => {
      const fn = state.bindings[index]
      if (!fn) return
      let first = true
      try {
        createEffect(fn, {
          effect(value) {
            if (first) {
              first = false
              if (Object.is(value, state.initial[index])) return
            }
            try {
              applyBinding(index, value)
            } catch (error) {
              if (!isNotReady(error)) state.error = error
              markAsync(state, index, error)
              reportError(index, error)
            }
          },
          error(error) {
            // A failed compute keeps the last applied value; later changes can
            // recover, and other bindings keep their own effects running.
            first = false
            if (!isNotReady(error)) state.error = error
            markAsync(state, index, error)
            reportError(index, error)
          },
        })
      } catch (error) {
        // Even a synchronous effect-creation failure must not stop the
        // remaining bindings from being created.
        reportError(index, error)
      }
    }

    // Scalar bindings are grouped so a component with many fields does not
    // create one effect per field. Groups stay small so one change does not
    // recompute a large page; list bindings keep their own effect because
    // arrays can be expensive to diff.
    const statusIndexes = new Set((config.asyncStatus ?? []).map((status) => status.index))
    const scalarIndexes: number[] = []
    state.bindings.forEach((fn, index) => {
      if (!fn || Object.hasOwn(listBindings, index) || statusIndexes.has(index)) return
      scalarIndexes.push(index)
    })
    const hasAsyncBoundary = state.bindingBoundaries.some((boundary) => boundary != null)
    const groupSize = hasAsyncBoundary
      ? 1
      : Number.isInteger(config.bindingGroupSize) && config.bindingGroupSize! > 0
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
                  return { index, value: state.bindings[index]!() }
                } catch (error) {
                  if (!isNotReady(error)) state.error = error
                  markAsync(state, index, error)
                  reportError(index, error)
                  return { index, value: undefined, failed: true }
                }
              }),
            {
              effect(values) {
                if (first) {
                  first = false
                  const unchanged = values.every(
                    (item) =>
                      item.failed ||
                      item.value === undefined ||
                      Object.is(item.value, state.initial[item.index]),
                  )
                  if (unchanged) return
                }
                for (const item of values) {
                  if (item.failed) continue
                  try {
                    applyBinding(item.index, item.value)
                  } catch (error) {
                    reportError(item.index, error)
                  }
                }
              },
              error(error) {
                first = false
                if (!isNotReady(error)) state.error = error
                for (const index of group) markAsync(state, index, error)
                reportError(group[0] ?? 0, error)
              },
            },
          )
        } catch (error) {
          reportError(group[0] ?? 0, error)
        }
      }
      state.bindings.forEach((fn, index) => {
        if (Object.hasOwn(listBindings, index) && !statusIndexes.has(index)) createBindingEffect(index)
      })
    })
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
          bindings: [],
          bindingFns: [],
          bindingMemos: [],
          events: [],
          refs: [],
          initial: [],
          previous: [],
          pending: [],
          asyncPending: new Map(),
          settled: [],
          statusVersion: createSignal(0),
          asyncStatus: config.asyncStatus,
          applyStatus: null,
          flushScheduled: false,
          props: Object.create(null),
          propsProxy: null,
          owner: null,
          dispose: null,
          mounted: false,
          active: false,
          loadingSignals: new Map(),
          errorSignals: new Map(),
          bindingBoundaries: [],
          bindingSources: [],
          fallbackSources: [],
          errorBindings: new Map(),
          errorValues: new Map(),
          errorValueSignals: new Map(),
          error: undefined,
        }
        this.__glaze = state

        for (const name of propertyNames) {
          state.props[name] = createSignal(normalizePropValue(this.properties?.[name]))
        }
        const sourceNames =
          Object.keys(propMap).length > 0 ? Object.keys(propMap) : propertyNames
        state.propsProxy = new Proxy(
          {},
          {
            get: (_, key: string | symbol) => {
              if (typeof key !== 'string') return undefined
              if (Object.hasOwn(eventProps, key)) {
                const eventName = eventProps[key]!
                return (...args: unknown[]) =>
                  this.triggerEvent(eventName, args.length <= 1 ? args[0] : args, GLAZE_EVENT_OPTIONS)
              }
              const mapped = Object.hasOwn(propMap, key) ? propMap[key]! : key
              return Object.hasOwn(state.props, mapped) ? state.props[mapped]![0]() : undefined
            },
            has: (_, key: string | symbol) =>
              typeof key === 'string' &&
              (Object.hasOwn(eventProps, key) ||
                Object.hasOwn(propMap, key) ||
                Object.hasOwn(state.props, key)),
            ownKeys: () => [...new Set([...sourceNames, ...Object.keys(eventProps)])],
            getOwnPropertyDescriptor: (_, key: string | symbol) =>
              typeof key === 'string' &&
              (Object.hasOwn(eventProps, key) ||
                Object.hasOwn(propMap, key) ||
                Object.hasOwn(state.props, key))
                ? { enumerable: true, configurable: true }
                : undefined,
          },
        )

        if (!deferredContext) mount(this, state)
      },

      attached(this: any) {
        const state: InstanceState | undefined = this.__glaze
        if (!state || state.active) return
        // Re-attaching after `detached`: the old root was disposed, so build a
        // fresh one before restoring effects.
        if (!state.mounted && !deferredContext) mount(this, state)
        state.active = true
        attach(this, state)
      },

      ready(this: any) {
        const state: InstanceState | undefined = this.__glaze
        if (!state || !deferredContext || state.mounted) return
        // A context passed through the property bridge is not available while
        // `created` runs (the parent's first setData may land afterwards).
        // Wait for `ready`, when the property is materialized, then build the
        // provider chain and the component's normal setup. Without a value the
        // providers are skipped and `useContext` falls back to its default.
        mount(this, state)
        attach(this, state)
      },

      detached(this: any) {
        const state: InstanceState | undefined = this.__glaze
        if (!state) return
        // Keep the state (including prop signals) so a later `attached` can
        // rebuild the disposed root instead of seeing a dead instance.
        state.active = false
        state.pending = []
        state.flushScheduled = false
        // Match the old detached behavior: event and ref callbacks stop until
        // the root is rebuilt on re-attach.
        state.events.length = 0
        state.refs.length = 0
        state.applyStatus = null
        state.dispose?.()
        state.dispose = null
        state.owner = null
        state.mounted = false
      },
    },
    methods,
  })
}
