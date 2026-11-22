import type { getOwner } from 'solid-js'

export type GlazeBinding = () => unknown
export type GlazeEventHandler = (event?: unknown) => void
export type GlazeProps = Record<string, unknown>


export type GlazeContextProvider = (props: {
  value: unknown
  children: () => unknown
}) => () => unknown


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

export type InstanceState = {
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
