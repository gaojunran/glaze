import {
  createEffect,
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
  reportBindingError,
  SCALAR_BINDING_GROUP,
} from './data.ts'
import { listOps, listPatch } from './list.ts'
import { withProvider } from './provider.ts'
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
export { withProvider } from './provider.ts'
export { listOps, listPatch } from './list.ts'
export type { GlazeComponentConfig, GlazeContext } from './types.ts'

export function defineGlazeComponent(config: GlazeComponentConfig): unknown {
  const propertyNames = config.properties ?? []
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
    propertyNames.map((name) => [name, { type: null, value: null }]),
  )
  const observers = Object.fromEntries(
    propertyNames.map((name) => [
      name,
      function observeProperty(this: { __glaze?: InstanceState | null }, value: unknown) {
        this.__glaze?.props[name]?.[1](normalizePropValue(value))
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
    state.events.length = 0
    state.refs.length = 0
    state.initial.length = 0
    state.previous.length = 0
    state.owner = null

    state.dispose = createRoot((dispose) => {
      config.setup(
        {
          bind(index, fn) {
            state.bindings[index] = fn
          },
          event(index, fn) {
            state.events[index] = fn
          },
          ref(index, fn) {
            state.refs[index] = { id: `glaze-r${index}`, fn }
          },
        },
        state.propsProxy!,
      )
      state.owner = getOwner()

      const initial: Record<string, unknown> = {}
      state.bindings.forEach((fn, index) => {
        if (!fn) return
        try {
          const value = fn()
          state.initial[index] = value
          state.previous[index] = snapshotValue(index, value)
          initial[`b${index}`] = normalizeDataValue(value)
        } catch (error) {
          // One async or broken binding must not prevent the component from
          // rendering the remaining values.
          reportBindingError(index, error)
        }
      })
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

    const refs = state.refs.filter(Boolean)
    if (refs.length > 0) {
      const query =
        (component as { createSelectorQuery?: () => any }).createSelectorQuery?.() ??
        (globalThis as unknown as { wx: any }).wx.createSelectorQuery().in(component)
      for (const ref of refs) {
        query.select(`#${ref.id}`).boundingClientRect((rect: unknown) => {
          ref.fn(rect ? { id: ref.id, ...(rect as Record<string, unknown>) } : null)
        })
      }
      query.exec()
    }

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
              reportBindingError(index, error)
            }
          },
          error(error) {
            // A failed compute keeps the last applied value; later changes can
            // recover, and other bindings keep their own effects running.
            first = false
            reportBindingError(index, error)
          },
        })
      } catch (error) {
        // Even a synchronous effect-creation failure must not stop the
        // remaining bindings from being created.
        reportBindingError(index, error)
      }
    }

    // Scalar bindings are grouped so a component with many fields does not
    // create one effect per field. Groups stay small so one change does not
    // recompute a large page; list bindings keep their own effect because
    // arrays can be expensive to diff.
    const scalarIndexes: number[] = []
    state.bindings.forEach((fn, index) => {
      if (!fn || Object.hasOwn(listBindings, index)) return
      scalarIndexes.push(index)
    })
    const scalarGroups: number[][] = []
    for (let offset = 0; offset < scalarIndexes.length; offset += SCALAR_BINDING_GROUP) {
      scalarGroups.push(scalarIndexes.slice(offset, offset + SCALAR_BINDING_GROUP))
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
                  reportBindingError(index, error)
                  return { index, value: undefined }
                }
              }),
            {
              effect(values) {
                if (first) {
                  first = false
                  const unchanged = values.every(
                    (item) => item.value === undefined || Object.is(item.value, state.initial[item.index]),
                  )
                  if (unchanged) return
                }
                for (const item of values) {
                  try {
                    applyBinding(item.index, item.value)
                  } catch (error) {
                    reportBindingError(item.index, error)
                  }
                }
              },
              error(error) {
                first = false
                reportBindingError(group[0] ?? 0, error)
              },
            },
          )
        } catch (error) {
          reportBindingError(group[0] ?? 0, error)
        }
      }
      state.bindings.forEach((fn, index) => {
        if (Object.hasOwn(listBindings, index)) createBindingEffect(index)
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
          events: [],
          refs: [],
          initial: [],
          previous: [],
          pending: [],
          flushScheduled: false,
          props: Object.create(null),
          propsProxy: null,
          owner: null,
          dispose: null,
          mounted: false,
          active: false,
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

        mount(this, state)
      },

      attached(this: any) {
        const state: InstanceState | undefined = this.__glaze
        if (!state || state.active) return
        // Re-attaching after `detached`: the old root was disposed, so build a
        // fresh one before restoring effects.
        if (!state.mounted) mount(this, state)
        state.active = true
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
        state.dispose?.()
        state.dispose = null
        state.owner = null
        state.mounted = false
      },
    },
    methods,
  })
}
