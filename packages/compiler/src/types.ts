
import type { CompileWarning } from './diagnostics.ts'
import type {
  AsyncStatusEntry,
  BoundaryContextEntry,
  GeneratedConfigJson,
} from '@glaze/shared/protocol'

export type AnyNode = any

export type CompileOptions = {
  inline?: boolean
  bindingGroupSize?: number
  sourceFile?: string
  structuredProps?: boolean
  pageContext?: boolean
  pageRoot?: boolean
  /** Set when the project runs on the legacy exparser component framework. */
  componentFramework?: 'exparser'
  resolveComponent?: (
    name: string,
    source: string,
    fromFile?: string,
  ) => string | {
    source: string
    file?: string
    structuredProps?: boolean
    pageContext?: boolean
  } | null
}

export type ComponentRef = { name: string; source: string; fromFile?: string; file?: string }
export type AssetEntry = { token: string; specifier: string; fromFile: string | null }
export type BindingEntry = {
  code: string
  listKey: string | null
  block: number
  asyncBoundary: number | null
  errorBoundary: number | null
  listFields: string[] | null
}
export type EventEntry = { code: string; ast: AnyNode; scope: Scope | null; custom: boolean; block: number }
export type RefEntry = { code: string; block: number }
export type PropGetter = { name: string; code: string; expression: AnyNode }
export type ContextProvider = { name: string; key: string; imported: boolean; code: string }
export type BoundaryContext = BoundaryContextEntry
export type Block = {
  setup: AnyNode[]
  effects: string[]
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
  directKey?: string
  eventItem?: string
  listBinding?: number | null
  itemAst?: AnyNode
}
export type CompileResult = {
  wxml: string
  js: string
  props: string[]
  propertyNames: string[]
  propMap: Record<string, string>
  eventProps: Record<string, string>
  usesSlot: boolean
  namedSlots: string[]
  boundaryContexts: BoundaryContext[]
  asyncStatus: AsyncStatusEntry[]
  propSignals: string[]
  listFields: Record<string, string[]>
  components: ComponentRef[]
  inlineComponents: ComponentRef[]
  assets: AssetEntry[]
  bindingCount: number
  handlerCount: number
  structuredProps: boolean
  pageContext: boolean
  pageRoot: boolean
  warnings: CompileWarning[]
}

/**
 * The JSON metadata the compiler writes into the generated component config.
 * Serialized by ./emit.ts; `setup` is code, not JSON, and stays outside it.
 */
export type GeneratedConfigMetadata = Pick<
  GeneratedConfigJson,
  | 'data'
  | 'properties'
  | 'propMap'
  | 'eventProps'
  | 'propSignals'
  | 'structuredProps'
  | 'pageContext'
  | 'pageRoot'
  | 'componentFramework'
  | 'boundaryContexts'
  | 'asyncStatus'
  | 'bindingGroupSize'
  | 'listBindings'
  | 'listFields'
  | 'handlerCount'
>
export type EmitOptions = {
  bindingGroupSize?: number
  propsParam: string | null
  props: string[]
  propertyNames: string[]
  propMap: Record<string, string>
  eventProps: Record<string, string>
  usesSlot: boolean
  namedSlots: string[]
  boundaryContexts: BoundaryContext[]
  asyncStatus: AsyncStatusEntry[]
  propSignals: string[]
  listFields: Record<string, string[]>
  structuredProps?: boolean
  pageContext?: boolean
  pageRoot?: boolean
  componentFramework?: 'exparser'
}
export type RevealGroupEntry = {
  slots: number[]
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
  structuredProps: boolean
  pageContext: boolean
  pageRoot: boolean
  contextNames: Set<string>
  importedContexts: Set<string>
  contextKeys: Map<string, { key: string; imported: boolean }>
  activeProviders: ContextProvider[]
  boundaryContexts: BoundaryContext[]
  currentProvider: number | null
  usesSlot: boolean
  nextAsyncBoundary: number
  currentLoadingBoundary: number | null
  currentErrorBoundary: number | null
  currentRevealGroup: RevealGroupEntry | null
  asyncStatus: AsyncStatusEntry[]
  listProjectionBlocked: Set<number>
  namedSlots: Set<string>
  usesWxs: boolean
  usesWxsValue: boolean
  localNames: Set<string>
  blocks: Block[]
  currentBlock: number
  currentFile: string | null
  sourceText: string
  program: AnyNode
  inlineStack: string[]
  guards: string[]
  refForbidden: number
  inline: boolean
  resolveComponent: CompileOptions['resolveComponent'] | null
  addBinding(expression: AnyNode, listKey?: string | null): number
  notePropReads(expression: AnyNode | AnyNode[]): void
  addEvent(expression: AnyNode, scope?: Scope | null, custom?: boolean): number
  addBindingCode(code: string, listKey?: string | null, reads?: AnyNode | AnyNode[] | null): number
  addEffectCode(code: string, reads?: AnyNode | AnyNode[] | null): void
  addSetupStatement(statement: AnyNode): void
  guardCode(code: string): string
  withGuard<T>(guard: string | null, fn: () => T): T
  withRefForbidden<T>(fn: () => T): T
  addHelper(name: string): void
  addWxs(): void
  addWxsValue(): void
  addRef(expression: AnyNode): number
  addComponent(name: string, source: string, fromFile?: string | null): void
}
