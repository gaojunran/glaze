import type { getOwner } from 'solid-js'

export type GlazeBinding = () => unknown
export type GlazeEventHandler = (event?: unknown) => void
export type GlazeProps = Record<string, unknown>
export type DataPath = (string | number)[]
export type DataChange =
  | { path: DataPath; value: unknown; splice?: never }
  | { path: DataPath; splice: { index: number; del: number; inserts: unknown[] }; value?: never }


export type GlazeNodeRect = {
  id?: string
  left?: number
  top?: number
  right?: number
  bottom?: number
  width?: number
  height?: number
  [key: string]: unknown
}

export type GlazeNode = GlazeNodeRect & {
  getBoundingClientRect(): Promise<GlazeNodeRect | null>
  querySelector(selector: string): Promise<GlazeNode | null>
  querySelectorAll(selector: string): Promise<GlazeNode[]>
  scrollIntoView(options?: { duration?: number; offset?: number }): Promise<boolean>
}

export type GlazeContextProvider = (props: {
  value: unknown
  children: () => unknown
}) => () => unknown


export type GlazeContext = {
  bind(index: number, fn: GlazeBinding): void
  event(index: number, fn: GlazeEventHandler): void
  ref(index: number, fn: (node: unknown) => void): void
  loading(): boolean
  errored(): boolean
}

export type GlazeComponentConfig = {
  data?: Record<string, unknown>
  bindingGroupSize?: number
  boundaryContexts?: { name: string; key: string }[]
  errorBoundary?: boolean
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
  pending: DataChange[]
  flushScheduled: boolean
  props: Record<string, [() => unknown, (value: unknown) => void]>
  propsProxy: GlazeProps | null
  owner: ReturnType<typeof getOwner>
  dispose: (() => void) | null
  mounted: boolean
  active: boolean
  loading: [() => boolean, (value: boolean) => void]
  errored: [() => boolean, (value: boolean) => void]
  pendingAsync: Set<number>
  errorBindings: Set<number>
  error: unknown
}
