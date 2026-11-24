// The generated mini-program component contract. Compiler and runtime both
// read these names; keep them here so the two packages cannot drift.

export const STRUCTURED_PROP = 'glazeprops'
export const CONTEXT_PROP = 'glazecontext'
export const LIST_KEY_WHOLE = '*this'

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

export type AsyncStatusKind = 'loading' | 'error'
export type AsyncStatusEntry = {
  index: number
  kind: AsyncStatusKind
  boundary: number
}
export type BoundaryContextEntry = { name: string; key: string }

export type GeneratedConfigJson = {
  data?: Record<string, unknown>
  properties?: string[]
  propMap?: Record<string, string>
  eventProps?: Record<string, string>
  propSignals?: string[]
  structuredProps?: boolean
  boundaryContexts?: BoundaryContextEntry[]
  asyncStatus?: AsyncStatusEntry[]
  bindingGroupSize?: number
  listBindings?: Record<string, string | null>
  listFields?: Record<string, string[]>
  handlerCount?: number
}
