
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
export type BindingEntry = { code: string; listKey: string | null; block: number }
export type EventEntry = { code: string; ast: AnyNode; scope: Scope | null; custom: boolean; block: number }
export type RefEntry = { code: string; block: number }
export type PropGetter = { name: string; code: string; expression: AnyNode }
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
  namedSlots: string[]
  components: ComponentRef[]
  inlineComponents: ComponentRef[]
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
  namedSlots: string[]
}
export type CompilerContext = {
  bindings: BindingEntry[]
  events: EventEntry[]
  refs: RefEntry[]
  helpers: Set<string>
  components: ComponentRef[]
  inlineComponents: ComponentRef[]
  imports: Map<string, string>
  knownImports: Set<string>
  extraImports: string[]
  inlineChildren: string | null
  inlinePropsParam: string | null
  inlineChildrenUsed: boolean
  inlineChildrenCount: number
  rootPropsParam: string | null
  contextNames: Set<string>
  currentProvider: number | null
  usesSlot: boolean
  namedSlots: Set<string>
  usesWxs: boolean
  blocks: Block[]
  currentBlock: number
  currentFile: string | null
  inlineStack: string[]
  guards: string[]
  inline: boolean
  resolveComponent: CompileOptions['resolveComponent'] | null
  addBinding(expression: AnyNode, listKey?: string | null): number
  addEvent(expression: AnyNode, scope?: Scope | null, custom?: boolean): number
  addBindingCode(code: string, listKey?: string | null): number
  guardCode(code: string): string
  withGuard<T>(guard: string | null, fn: () => T): T
  addHelper(name: string): void
  addWxs(): void
  addRef(expression: AnyNode): number
  addComponent(name: string, source: string, fromFile?: string | null): void
}
