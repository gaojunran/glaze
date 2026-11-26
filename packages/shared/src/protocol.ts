// The generated mini-program component contract. Compiler and runtime both
// read these names; keep them here so the two packages cannot drift.

export const STRUCTURED_PROP = 'glazeprops'
export const CONTEXT_PROP = 'glazecontext'
export const PAGE_PROP = 'glazepage'
export const LIST_KEY_WHOLE = '*this'

export type PageContextValue = {
  id: string
  query?: Record<string, unknown>
}

/**
 * Mini-program property names are lowercased. A prop whose lowercased name is
 * an `Object.prototype` member would read the prototype in WXML while the
 * runtime uses an own-property check, so these names never enter the compact
 * `glazeprops` object and always use the scalar property path.
 */
const PROTOTYPE_PROP_NAMES = new Set(
  Object.getOwnPropertyNames(Object.prototype).map((name) => name.toLowerCase()),
)

export const isPrototypePropName = (name: string) =>
  PROTOTYPE_PROP_NAMES.has(name.toLowerCase())

export const bindingKey = (index: number) => `b${index}`
export const eventHandlerName = (index: number) => `e${index}`
export const refId = (index: number) => `glaze-r${index}`

export const dataIndexKey = (level: number) =>
  level === 0 ? 'glazeIndex' : `glazeIndex${level}`
export const dataIndexAttr = (level: number) =>
  level === 0 ? 'data-glaze-index' : `data-glaze-index${level}`

export type AsyncStatusKind = 'loading' | 'error' | 'settled'
export type AsyncStatusEntry = {
  index: number
  kind: AsyncStatusKind
  boundary: number
}
export type AsyncBoundaryKind = 'loading' | 'error'
export type AsyncBoundaryRegion = 'content' | 'fallback'
/**
 * One real async boundary in the component's tree. `content` lists the data
 * bindings the boundary owns directly; the runtime wraps them in a real
 * Solid `createLoadingBoundary`/`createErrorBoundary`, so nearest-catch and
 * first-load pending come from Solid. Refetch pending still comes from the
 * runtime's `isPending` projection.
 */
export type AsyncBoundaryDescriptor = {
  id: number
  kind: AsyncBoundaryKind
  parent: number | null
  region: AsyncBoundaryRegion
  content: number[]
  children: number[]
  keepPrevious?: boolean
}
export type BoundaryContextEntry = { name: string; key: string }

export type GeneratedConfigJson = {
  data?: Record<string, unknown>
  properties?: string[]
  propMap?: Record<string, string>
  eventProps?: Record<string, string>
  propSignals?: string[]
  structuredProps?: boolean
  pageContext?: boolean
  pageRoot?: boolean
  componentFramework?: 'exparser'
  boundaryContexts?: BoundaryContextEntry[]
  asyncStatus?: AsyncStatusEntry[]
  boundaries?: AsyncBoundaryDescriptor[]
  bindingGroupSize?: number
  listBindings?: Record<string, string | null>
  listFields?: Record<string, string[]>
  handlerCount?: number
}
