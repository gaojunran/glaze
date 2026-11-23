
export type AnyNode = any

export type CompileOptions = {
  inline?: boolean
  bindingGroupSize?: number
  sourceFile?: string
  resolveComponent?: (
    name: string,
    source: string,
    fromFile?: string,
  ) => string | { source: string; file?: string } | null
}

export type ComponentRef = { name: string; source: string; fromFile?: string; file?: string }
export type AssetEntry = { token: string; specifier: string; fromFile: string | null }
export type BindingEntry = {
  code: string
  listKey: string | null
  block: number
  asyncBoundary: number | null
}
export type EventEntry = { code: string; ast: AnyNode; scope: Scope | null; custom: boolean; block: number }
export type RefEntry = { code: string; block: number }
export type PropGetter = { name: string; code: string; expression: AnyNode }
export type ContextProvider = { name: string; key: string; imported: boolean; code: string }
export type BoundaryContext = { name: string; key: string }
export type Block = {
  setup: AnyNode[]
  propsParam: string | null
  propGetters: PropGetter[]
  provider: number | null
  providerContext?: string
  providerValue?: string
}
export type Scope = {
  item: string
  index: string
  source: string | null
  jsSource: string | null
  offset?: string
  parent: Scope | null
  level: number
  itemAccessor?: boolean
  indexAccessor?: boolean
  isIndexRepeat?: boolean
  aliases?: Record<string, string[]>
  direct?: string
  eventItem?: string
}
export type CompileResult = {
  wxml: string
  js: string
  props: string[]
  propertyNames: string[]
  propMap: Record<string, string>
  eventProps: Record<string, string>
  usesSlot: boolean
  errorBoundary: boolean
  namedSlots: string[]
  boundaryContexts: BoundaryContext[]
  asyncStatus: { index: number; kind: 'loading' | 'error'; boundary: number }[]
  propSignals: string[]
  components: ComponentRef[]
  inlineComponents: ComponentRef[]
  assets: AssetEntry[]
  bindingCount: number
  handlerCount: number
  refCount: number
}
export type EmitOptions = {
  bindingGroupSize?: number
  propsParam: string | null
  props: string[]
  propertyNames: string[]
  propMap: Record<string, string>
  eventProps: Record<string, string>
  usesSlot: boolean
  errorBoundary: boolean
  namedSlots: string[]
  boundaryContexts: BoundaryContext[]
  asyncStatus: { index: number; kind: 'loading' | 'error'; boundary: number }[]
  propSignals: string[]
}
export type CompilerContext = {
  bindings: BindingEntry[]
  events: EventEntry[]
  refs: RefEntry[]
  helpers: Set<string>
  components: ComponentRef[]
  inlineComponents: ComponentRef[]
  assets: AssetEntry[]
  imports: Map<string, string>
  knownImports: Set<string>
  extraImports: string[]
  inlineChildren: string | null
  inlinePropsParam: string | null
  inlineChildrenUsed: boolean
  inlineChildrenCount: number
  rootPropsParam: string | null
  propMap: Record<string, string>
  propReads: Set<string>
  allPropsRead: boolean
  contextNames: Set<string>
  contextKeys: Map<string, { key: string; imported: boolean }>
  activeProviders: ContextProvider[]
  boundaryContexts: BoundaryContext[]
  currentProvider: number | null
  usesSlot: boolean
  usesErrorBoundary: boolean
  nextAsyncBoundary: number
  currentAsyncBoundary: number | null
  asyncStatus: { index: number; kind: 'loading' | 'error'; boundary: number }[]
  namedSlots: Set<string>
  usesWxs: boolean
  usesWxsValue: boolean
  localNames: Set<string>
  blocks: Block[]
  currentBlock: number
  currentFile: string | null
  inlineStack: string[]
  guards: string[]
  refForbidden: number
  inline: boolean
  resolveComponent: CompileOptions['resolveComponent'] | null
  addBinding(expression: AnyNode, listKey?: string | null): number
  notePropReads(expression: AnyNode | AnyNode[]): void
  addEvent(expression: AnyNode, scope?: Scope | null, custom?: boolean): number
  addBindingCode(code: string, listKey?: string | null, reads?: AnyNode | AnyNode[] | null): number
  guardCode(code: string): string
  withGuard<T>(guard: string | null, fn: () => T): T
  withRefForbidden<T>(fn: () => T): T
  addHelper(name: string): void
  addWxs(): void
  addWxsValue(): void
  addRef(expression: AnyNode): number
  addComponent(name: string, source: string, fromFile?: string | null): void
}
