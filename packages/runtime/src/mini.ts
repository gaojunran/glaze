import { createEffect, createRoot, createSignal, getOwner, runWithOwner } from 'solid-js'

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
  owner: ReturnType<typeof getOwner>
  dispose: (() => void) | null
}

type ListOp = { index: number; del: number; inserts: unknown[] }

const keyOf = (item: unknown, key: string) =>
  (item as Record<string, unknown> | null | undefined)?.[key]

function listOps(previous: unknown, next: unknown, key: string): ListOp[] | null {
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

function listPatch(previous: unknown, next: unknown, key: string, binding: string) {
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

  const properties = Object.fromEntries(
    propertyNames.map((name) => [name, { type: null, value: null }]),
  )
  const observers = Object.fromEntries(
    propertyNames.map((name) => [
      name,
      function observeProperty(this: { __glaze?: InstanceState | null }, value: unknown) {
        this.__glaze?.props[name]?.[1](value)
      },
    ]),
  )

  return Component({
    data: config.data ?? {},
    properties,
    observers,
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
          props: {},
          owner: null,
          dispose: null,
        }
        this.__glaze = state

        for (const name of propertyNames) {
          state.props[name] = createSignal(this.properties?.[name] ?? null)
        }
        const eventProps = config.eventProps ?? {}
        const props = new Proxy(
          {},
          {
            get: (_, key: string) => {
              const eventName = eventProps[key]
              if (eventName) {
                return (...args: unknown[]) =>
                  this.triggerEvent(eventName, args.length <= 1 ? args[0] : args)
              }
              return state.props[key]?.[0]()
            },
          },
        )

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
            props,
          )
          state.owner = getOwner()

          const initial: Record<string, unknown> = {}
          state.bindings.forEach((fn, index) => {
            state.initial[index] = fn()
            state.previous[index] = state.initial[index]
            initial[`b${index}`] = state.initial[index]
          })
          this.setData(initial)
          return dispose
        })
      },

      attached(this: any) {
        const state: InstanceState | undefined = this.__glaze
        if (!state?.owner) return

        const schedule = (data: Record<string, unknown>) => {
          Object.assign(state.pending, data)
          if (state.flushScheduled) return
          state.flushScheduled = true
          const flush = () => {
            state.flushScheduled = false
            const pending = state.pending
            state.pending = {}
            if (Object.keys(pending).length > 0) this.setData(pending)
          }
          if (typeof queueMicrotask === 'function') queueMicrotask(flush)
          else Promise.resolve().then(flush)
        }

        const applyBinding = (index: number, value: unknown) => {
          const key = config.listBindings?.[index]
          const binding = `b${index}`
          const patch = key ? listPatch(state.previous[index], value, key, binding) : null
          if (patch) {
            if (Object.keys(patch).length > 0) schedule(patch)
          } else {
            const ops = key ? listOps(state.previous[index], value, key) : null
            if (
              ops &&
              typeof this.spliceArrayDataOnPath === 'function' &&
              typeof this.groupUpdates === 'function'
            ) {
              this.groupUpdates(() => {
                for (const op of ops) {
                  this.spliceArrayDataOnPath([binding], op.index, op.del, op.inserts)
                }
              })
            } else {
              schedule({ [binding]: value })
            }
          }
          state.previous[index] = value
        }

        const query =
          this.createSelectorQuery?.() ??
          (globalThis as unknown as { wx: any }).wx.createSelectorQuery().in(this)
        for (const ref of state.refs) {
          if (!ref) continue
          query.select(`#${ref.id}`).boundingClientRect((rect: unknown) => {
            ref.fn(rect ? { id: ref.id, ...rect } : null)
          })
        }
        query.exec()

        runWithOwner(state.owner, () => {
          state.bindings.forEach((fn, index) => {
            let first = true
            createEffect(fn, (value) => {
              if (first) {
                first = false
                if (Object.is(value, state.initial[index])) return
              }
              applyBinding(index, value)
            })
          })
        })
      },

      detached(this: any) {
        this.__glaze?.dispose?.()
        this.__glaze = null
      },
    },
    methods,
  })
}
