import type { getOwner } from 'solid-js'
import type { BoundaryState } from './boundary.ts'
import type { LifecycleState } from './lifecycle.ts'
import type { RuntimeStateCore } from './state.ts'

export type GlazeBinding = () => unknown
export type GlazeEventHandler = (event?: unknown) => void
export type GlazeProps = Record<string, unknown>
export type DataPath = (string | number)[]
export type DataChange =
  | { path: DataPath; value: unknown; splice?: never }
  | { path: DataPath; splice: { index: number; del: number; inserts: unknown[] }; value?: never }


export type PageSize = {
  windowWidth: number
  windowHeight: number
}

export type AppLaunchOptions = {
  path?: string
  query?: Record<string, string>
  scene?: number
  referrerInfo?: Record<string, unknown>
  [key: string]: unknown
}

export type AppShowHandler = (options: AppLaunchOptions | undefined) => void

export type PageEventName =
  | 'scroll'
  | 'shareAppMessage'
  | 'shareTimeline'
  | 'addToFavorites'
  | 'tabItemTap'
  | 'saveExitState'
  | 'pullDownRefresh'
  | 'reachBottom'
  | 'routeDone'

export type PageEventPayloads = {
  scroll: { scrollTop: number; scrollLeft?: number }
  shareAppMessage: Record<string, unknown>
  shareTimeline: Record<string, unknown>
  addToFavorites: Record<string, unknown>
  tabItemTap: { index: number; pagePath: string; text: string }
  saveExitState: Record<string, unknown>
  pullDownRefresh: undefined
  reachBottom: undefined
  routeDone: { path?: string }
}

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
  /** The fourth boundary is the nearest Errored; the third is the nearest Loading. */
  bind(
    index: number,
    fn: GlazeBinding,
    loadingBoundary?: number | null,
    errorBoundary?: number | null,
  ): void
  event(index: number, fn: GlazeEventHandler): void
  ref(index: number, fn: (node: unknown) => void): void
  context(context: GlazeContextProvider): () => unknown
  loadingOn(boundary: number, fn: () => unknown): void
  reset(boundary: number): void
  loading(boundary: number): boolean
  errored(boundary: number): boolean
  error(boundary: number): unknown
  errorArray(boundary: number): unknown[]
  /** True while the page is visible; starts true and follows pageLifetimes. */
  pageVisible(): boolean
  /** Latest page size from pageLifetimes.resize; seeded from wx.getWindowInfo when available. */
  pageSize(): PageSize | null
  /** True while the app is in the foreground. */
  appVisible(): boolean
  /** Launch options captured from `wx.getLaunchOptionsSync` when available. */
  appLaunchOptions(): AppLaunchOptions | undefined
  onAppShow(handler: AppShowHandler): () => void
  onAppHide(handler: () => void): () => void
  onAppError(handler: (error: unknown) => void): () => void
  onUnhandledRejection(handler: (reason: unknown) => void): () => void
  /** Latest payload for a page-level event. */
  pageEvent<K extends PageEventName>(name: K): PageEventPayloads[K] | undefined
  /** Subscribe to a page-level event; the returned value is a synchronous result. */
  onPageEvent<K extends PageEventName>(
    name: K,
    handler: (payload: PageEventPayloads[K]) => unknown,
  ): () => void
  /** Subscribe to component errors, including binding failures. */
  onComponentError(handler: (error: unknown) => void): () => void
  onComponentMoved(handler: () => void): () => void
  onBeforeDetach(handler: () => void): () => void
}

export type GlazeComponentConfig = {
  data?: Record<string, unknown>
  bindingGroupSize?: number
  boundaryContexts?: { name: string; key: string }[]
  asyncStatus?: { index: number; kind: 'loading' | 'error'; boundary: number }[]
  properties?: string[]
  propMap?: Record<string, string>
  propSignals?: string[]
  eventProps?: Record<string, string>
  listBindings?: Record<string, string>
  listFields?: Record<string, string[]>
  structuredProps?: boolean
  handlerCount?: number
  setup(ctx: GlazeContext, props: GlazeProps): void
}

export type InstanceState = {
  core: RuntimeStateCore
  boundaries: BoundaryState
  events: GlazeEventHandler[]
  refs: { id: string; fn: (node: unknown) => void }[]
  pending: DataChange[]
  statusVersion: [() => number, (value: number) => void]
  applyStatus: ((index: number, value: unknown) => void) | null
  flushScheduled: boolean
  /** True once a root's binding effects are installed; reset on mount/detach. */
  effectsInstalled: boolean
  pageVisible: [() => boolean, (value: boolean) => void]
  pageSize: [() => PageSize | null, (value: PageSize | null) => void]
  pageEvents: Map<PageEventName, unknown>
  pageEventVersion: [() => number, (value: number) => void]
  pageHandlers: Map<PageEventName, Set<(payload: unknown) => unknown>>
  errorHandlers: ((error: unknown) => void)[]
  movedHandlers: (() => void)[]
  beforeDetachHandlers: (() => void)[]
  props: Record<string, [() => unknown, (value: unknown) => void]>
  propsProxy: GlazeProps | null
  owner: ReturnType<typeof getOwner>
  dispose: (() => void) | null
  lifecycle: LifecycleState
  asyncStatus?: { index: number; kind: 'loading' | 'error'; boundary: number }[]
  error: unknown
}
