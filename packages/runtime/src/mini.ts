import { createEffect, createRoot, getOwner, runWithOwner } from 'solid-js'

export type GlazeBinding = () => unknown
export type GlazeEventHandler = () => void

export type GlazeContext = {
  bind(index: number, fn: GlazeBinding): void
  event(index: number, fn: GlazeEventHandler): void
}

export type GlazeComponentConfig = {
  data?: Record<string, unknown>
  handlerCount?: number
  setup(ctx: GlazeContext): void
}

type InstanceState = {
  bindings: GlazeBinding[]
  events: GlazeEventHandler[]
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
  const methods: Record<string, unknown> = {}
  const handlerCount = config.handlerCount ?? 0
  for (let i = 0; i < handlerCount; i += 1) {
    const name = `e${i}`
    methods[name] = function handleEvent(this: { __glaze?: InstanceState | null }) {
      this.__glaze?.events[i]?.()
    }
  }

  return Component({
    data: config.data ?? {},
    lifetimes: {
      created(this: any) {
        const state: InstanceState = {
          bindings: [],
          events: [],
          owner: null,
          dispose: null,
        }
        this.__glaze = state

        state.dispose = createRoot((dispose) => {
          config.setup({
            bind(index, fn) {
              state.bindings[index] = fn
            },
            event(index, fn) {
              state.events[index] = fn
            },
          })
          state.owner = getOwner()

          const initial: Record<string, unknown> = {}
          state.bindings.forEach((fn, index) => {
            initial[`b${index}`] = fn()
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
                return
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
