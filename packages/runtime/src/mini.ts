import { createEffect, createRoot, createSignal, getOwner, runWithOwner } from 'solid-js'

export type GlazeBinding = () => unknown
export type GlazeEventHandler = () => void
export type GlazeProps = Record<string, unknown>

export type GlazeContext = {
  bind(index: number, fn: GlazeBinding): void
  event(index: number, fn: GlazeEventHandler): void
}

export type GlazeComponentConfig = {
  data?: Record<string, unknown>
  properties?: string[]
  handlerCount?: number
  setup(ctx: GlazeContext, props: GlazeProps): void
}

type InstanceState = {
  bindings: GlazeBinding[]
  events: GlazeEventHandler[]
  initial: unknown[]
  props: Record<string, [() => unknown, (value: unknown) => void]>
  owner: ReturnType<typeof getOwner>
  dispose: (() => void) | null
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
    methods[name] = function handleEvent(this: { __glaze?: InstanceState | null }) {
      this.__glaze?.events[i]?.()
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
          initial: [],
          props: {},
          owner: null,
          dispose: null,
        }
        this.__glaze = state

        for (const name of propertyNames) {
          state.props[name] = createSignal(this.properties?.[name] ?? null)
        }
        const props = new Proxy(
          {},
          {
            get: (_, key: string) => state.props[key]?.[0](),
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
            },
            props,
          )
          state.owner = getOwner()

          const initial: Record<string, unknown> = {}
          state.bindings.forEach((fn, index) => {
            state.initial[index] = fn()
            initial[`b${index}`] = state.initial[index]
          })
          this.setData(initial)
          return dispose
        })
      },

      attached(this: any) {
        const state: InstanceState | undefined = this.__glaze
        if (!state?.owner) return

        runWithOwner(state.owner, () => {
          state.bindings.forEach((fn, index) => {
            let first = true
            createEffect(fn, (value) => {
              if (first) {
                first = false
                if (Object.is(value, state.initial[index])) return
              }
              this.setData({ [`b${index}`]: value })
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
