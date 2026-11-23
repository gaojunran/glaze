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
  focus(): Promise<boolean>
  blur(): Promise<boolean>
  getAttribute(name: string): Promise<unknown>
  setAttribute(name: string, value: unknown): Promise<boolean>
  scrollIntoView(options?: { duration?: number; offset?: number }): Promise<boolean>
}

export type GlazeContextProvider = (props: {
  value: unknown
  children: () => unknown
}) => () => unknown


export type GlazeContext = {
  bind(index: number, fn: GlazeBinding, asyncBoundary?: number | null): void
  event(index: number, fn: GlazeEventHandler): void
  ref(index: number, fn: (node: unknown) => void): void
  context(context: GlazeContextProvider): () => unknown
  loadingOn(boundary: number, fn: () => unknown): void
  reset(boundary: number): void
  loading(boundary: number): boolean
  errored(boundary: number): boolean
  error(boundary: number): unknown
  errorArray(boundary: number): unknown[]
}

export type GlazeComponentConfig = {
  data?: Record<string, unknown>
  bindingGroupSize?: number
  boundaryContexts?: { name: string; key: string }[]
  errorBoundary?: boolean
  asyncStatus?: { index: number; kind: 'loading' | 'error'; boundary: number }[]
  properties?: string[]
  propMap?: Record<string, string>
  propSignals?: string[]
  eventProps?: Record<string, string>
  listBindings?: Record<string, string>
  handlerCount?: number
  refCount?: number
  setup(ctx: GlazeContext, props: GlazeProps): void
}

export type InstanceState = {
  bindings: GlazeBinding[]
  bindingFns: GlazeBinding[]
  bindingMemos: (GlazeBinding | null)[]
  events: GlazeEventHandler[]
  refs: { id: string; fn: (node: unknown) => void }[]
  initial: unknown[]
  previous: unknown[]
  pending: DataChange[]
  asyncPending: Map<number, Set<number>>
  loadingOn: Map<number, () => unknown>
  settled: boolean[]
  statusVersion: [() => number, (value: number) => void]
  applyStatus: ((index: number, value: unknown) => void) | null
  flushScheduled: boolean
  props: Record<string, [() => unknown, (value: unknown) => void]>
  propsProxy: GlazeProps | null
  owner: ReturnType<typeof getOwner>
  dispose: (() => void) | null
  mounted: boolean
  everMounted: boolean
  active: boolean
  loadingSignals: Map<number, [() => boolean, (value: boolean) => void]>
  errorSignals: Map<number, [() => boolean, (value: boolean) => void]>
  bindingBoundaries: (number | null)[]
  bindingErrorBoundaries: (number | null)[]
  bindingSources: unknown[]
  fallbackSources: unknown[]
  errorBindings: Map<number, Map<unknown, Set<number>>>
  errorValues: Map<number, Map<unknown, unknown>>
  errorValueSignals: Map<number, [() => unknown, (value: unknown) => void]>
  resetSignals: Map<number, [() => number, (value: number) => void]>
  asyncStatus?: { index: number; kind: 'loading' | 'error'; boundary: number }[]
  error: unknown
}
