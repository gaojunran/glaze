import {
  createEffect,
  createRoot,
  createSignal,
  getOwner,
  NotReadyError,
  runWithOwner,
} from 'solid-js'

export function className(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value.map(className).filter(Boolean).join(' ')
  }
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .filter(([, active]) => active)
      .map(([name]) => name)
      .join(' ')
  }
  return ''
}

export function styleName(value: unknown): string {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return ''
  return Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item != null && item !== '')
    .map(([key, item]) => `${key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}:${item}`)
    .join(';')
}

export type GlazeBinding = () => unknown
export type GlazeEventHandler = (event?: unknown) => void
export type GlazeProps = Record<string, unknown>

export type GlazeContextProvider = (props: {
  value: unknown
  children: () => unknown
}) => () => unknown

/**
 * Run inline child setup inside a Solid context provider.
 *
 * Solid's provider is a component that sets the context while its children
 * accessor runs. Calling the provider directly and draining its memo keeps
 * that window open for the compiled child blocks, which are ordinary
 * statements rather than a JSX child tree.
 */
export function withProvider(
  context: GlazeContextProvider,
  value: unknown,
  setup: () => void,
): void {
  const provider = context({
    value,
    children: () => {
      setup()
      return ''
    },
  })
  provider()
}

export type GlazeContext = {
  bind(index: number, fn: GlazeBinding): void
  event(index: number, fn: GlazeEventHandler): void
  ref(index: number, fn: (node: unknown) => void): void
}

export type GlazeComponentConfig = {
  data?: Record<string, unknown>
  properties?: string[]
  propMap?: Record<string, string>
  eventProps?: Record<string, string>
  listBindings?: Record<string, string>
  handlerCount?: number
  refCount?: number
  setup(ctx: GlazeContext, props: GlazeProps): void
}

type InstanceState = {
  bindings: GlazeBinding[]
  events: GlazeEventHandler[]
  refs: { id: string; fn: (node: unknown) => void }[]
  initial: unknown[]
  previous: unknown[]
  pending: Record<string, unknown>
  flushScheduled: boolean
  props: Record<string, [() => unknown, (value: unknown) => void]>
  propsProxy: GlazeProps | null
  owner: ReturnType<typeof getOwner>
  dispose: (() => void) | null
  mounted: boolean
  active: boolean
}

type ListOp = { index: number; del: number; inserts: unknown[] }

const keyOf = (item: unknown, key: string) =>
  (item as Record<string, unknown> | null | undefined)?.[key]

/** Internal helper, exported for unit tests. */
export function listOps(previous: unknown, next: unknown, key: string): ListOp[] | null {
  if (!Array.isArray(previous) || !Array.isArray(next)) return null
  if (key === '*this') return null

  let prefix = 0
  while (
    prefix < previous.length &&
    prefix < next.length &&
    Object.is(keyOf(previous[prefix], key), keyOf(next[prefix], key))
  ) {
    prefix += 1
  }

  let suffix = 0
  while (
    suffix < previous.length - prefix &&
    suffix < next.length - prefix &&
    Object.is(
      keyOf(previous[previous.length - 1 - suffix], key),
      keyOf(next[next.length - 1 - suffix], key),
    )
  ) {
    suffix += 1
  }

  if (prefix === previous.length && prefix === next.length) return null
  if (prefix === previous.length) {
    return [{ index: prefix, del: 0, inserts: next.slice(prefix) }]
  }
  if (prefix === next.length) {
    return [{ index: prefix, del: previous.length - prefix, inserts: [] }]
  }
  return [
    {
      index: prefix,
      del: previous.length - prefix - suffix,
      inserts: next.slice(prefix, next.length - suffix),
    },
  ]
}

/** Internal helper, exported for unit tests. */
export function listPatch(
  previous: unknown,
  next: unknown,
  key: string,
  binding: string,
): Record<string, unknown> | null {
  if (!Array.isArray(previous) || !Array.isArray(next)) return null
  if (key === '*this') return null
  if (previous.length !== next.length) return null

  const previousIndex = new Map(previous.map((item, index) => [item?.[key], index]))
  const patch: Record<string, unknown> = {}

  for (let index = 0; index < next.length; index += 1) {
    const item = next[index]
    const beforeIndex = previousIndex.get(item?.[key])
    if (beforeIndex !== index) return null

    const before = previous[beforeIndex]
    if (before === item) continue
    for (const field of Object.keys(item)) {
      if (before && Object.is(before[field], item[field])) continue
      if (!before || !(field in before)) return null
      patch[`${binding}[${index}].${field}`] = item[field]
    }
    for (const field of Object.keys(before ?? {})) {
      if (!(field in item)) return null
    }
  }

  return patch
}

declare const Component: (config: Record<string, unknown>) => unknown

const normalizePropValue = (value: unknown): unknown => (value === null ? undefined : value)

// Mini-program `setData` rejects `undefined`; WXML renders `null` as empty.
const normalizeDataValue = (value: unknown): unknown => (value === undefined ? null : value)

/** Internal helper, exported for unit tests. */
export function dataPath(key: string): (string | number)[] {
  const path: (string | number)[] = []
  let index = 0
  while (index < key.length) {
    if (key[index] === '.') {
      index += 1
      continue
    }
    if (key[index] === '[') {
      const end = key.indexOf(']', index)
      if (end < 0) throw new Error(`Invalid data path: ${key}`)
      const segment = key.slice(index + 1, end)
      path.push(/^\d+$/.test(segment) ? Number(segment) : segment)
      index = end + 1
      continue
    }
    let end = index
    while (end < key.length && key[end] !== '.' && key[end] !== '[') end += 1
    path.push(key.slice(index, end))
    index = end
  }
  return path
}

function reportBindingError(index: number, error: unknown): void {
  // Async resources below a binding legitimately throw while settling; only
  // surface unexpected failures so they do not disappear behind the guard.
  if (error instanceof NotReadyError) return
  const errorConsole = (globalThis as { console?: Console }).console
  errorConsole?.error?.(`[glaze] binding b${index} failed`, error)
}

/**
 * Mini-program component runtime for compiler output.
 *
 * The compiler emits `data` placeholders, a binding count via `ctx.bind`, and
 * handlers via `ctx.event`. This wrapper runs the user's Solid setup once per
 * instance, computes initial binding values before the first paint, then
 * forwards later binding changes through `setData` paths.
 */
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
    const schedule = (data: Record<string, unknown>) => {
      Object.assign(state.pending, data)
      if (state.flushScheduled) return
      state.flushScheduled = true
      const flush = () => {
        state.flushScheduled = false
        const pending = state.pending
        state.pending = {}
        if (!state.active || Object.keys(pending).length === 0) return
        if (
          typeof component.replaceDataOnPath === 'function' &&
          typeof component.groupUpdates === 'function'
        ) {
          component.groupUpdates(() => {
            for (const [key, value] of Object.entries(pending)) {
              component.replaceDataOnPath(dataPath(key), value)
            }
          })
          return
        }
        component.setData(pending)
      }
      if (typeof queueMicrotask === 'function') queueMicrotask(flush)
      else Promise.resolve().then(flush)
    }

    const applyBinding = (index: number, value: unknown) => {
      const key = listBindings[index]
      const binding = `b${index}`
      const patch = key ? listPatch(state.previous[index], value, key, binding) : null
      if (patch) {
        const data = Object.fromEntries(
          Object.entries(patch).map(([key, item]) => [key, normalizeDataValue(item)]),
        )
        if (Object.keys(data).length > 0) schedule(data)
      } else {
        const ops = key ? listOps(state.previous[index], value, key) : null
        if (
          ops &&
          typeof component.spliceArrayDataOnPath === 'function' &&
          typeof component.groupUpdates === 'function'
        ) {
          component.groupUpdates(() => {
            for (const op of ops) {
              component.spliceArrayDataOnPath([binding], op.index, op.del, op.inserts)
            }
          })
        } else {
          schedule({ [binding]: normalizeDataValue(value) })
        }
      }
      state.previous[index] = snapshotValue(index, value)
    }

    const refs = state.refs.filter(Boolean)
    if (refs.length > 0) {
      const query =
        component.createSelectorQuery?.() ??
        (globalThis as unknown as { wx: any }).wx.createSelectorQuery().in(component)
      for (const ref of refs) {
        query.select(`#${ref.id}`).boundingClientRect((rect: unknown) => {
          ref.fn(rect ? { id: ref.id, ...rect } : null)
        })
      }
      query.exec()
    }

    runWithOwner(state.owner, () => {
      state.bindings.forEach((fn, index) => {
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
          pending: {},
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
                  this.triggerEvent(eventName, args.length <= 1 ? args[0] : args)
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
        state.pending = {}
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
