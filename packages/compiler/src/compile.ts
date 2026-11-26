import path from 'node:path'
import * as t from '@babel/types'
import { CONTEXT_PROP, PAGE_PROP } from '@glaze/shared'
import { codeOf, containsJsx, isStaticPropertyKey, walkAst } from './ast.ts'
import { STRUCTURED_PROPS, WXS_SOURCE, WXS_VALUE_SOURCE } from './constants.ts'
import { collectAsyncReadWarnings } from './diagnostics.ts'
import { emitModule } from './emit.ts'
import { eventNameFor, splitEventBinding } from './events.ts'
import { parseComponent, collectImports } from './parse.ts'
import { compileNode } from './elements.ts'
import { rewriteContextAccess } from './context.ts'
import { groupableProps, hasGroupableProps, isEventProp } from './props.ts'
import type {
  AnyNode,
  BoundaryContext,
  CompileOptions,
  CompileResult,
  CompilerContext,
  EmitOptions,
} from './types.ts'

/**
 * Supported in the first wave:
 * - a default-exported function with zero or one props parameter;
 * - static JSX structure, dynamic text and attributes;
 * - <Show when={...}> and <For each={...} key="...">;
 * - imported Solid components with scalar props;
 * - native elements and DOM-like event props (onClick, onInput, ...).
 *
 * Everything else is a compile error on purpose. Silent fallback would hide
 * exactly the cases where the mini-program runtime diverges from Solid.
 */

/** True when any generated fragment reads a prop that was not registered. */
export function hasUnregisteredPropRead(
  codes: string[],
  propName: string,
  propReads: Set<string>,
): boolean {
  const param = propName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const reference = new RegExp(
    `\\b${param}\\b\\s*(?:\\??\\.\\s*([A-Za-z_$][\\w$]*))?`,
    'g',
  )
  for (const code of codes) {
    for (const match of code.matchAll(reference)) {
      const name = match[1]
      if (!name || !propReads.has(name)) return true
    }
  }
  return false
}

export function hasMultipleProps(source: string): boolean {
  try {
    return hasGroupableProps(parseComponent(source).props)
  } catch {
    return false
  }
}

function rejectUnsupportedSolidHelpers(ast: AnyNode, fn: AnyNode): void {
  for (const node of ast.program.body) {
    if (!t.isImportDeclaration(node) || node.source.value !== 'solid-js') continue
    for (const specifier of node.specifiers) {
      if (!t.isImportSpecifier(specifier)) continue
      const imported = t.isIdentifier(specifier.imported)
        ? specifier.imported.name
        : specifier.imported.value
      if (imported !== 'children') continue
      const local = specifier.local.name
      let used = false
      walkAst(fn, (item) => {
        if (t.isIdentifier(item, { name: local })) used = true
      })
      if (used) {
        throw new Error(
          'The children() helper is not supported; use <slot /> in a component boundary or props.children in an inlined component',
        )
      }
    }
  }
}

/**
 * Read the declarations that shape the generated module: local names that
 * shadow the Solid control-flow names, and context identity. Pure over the
 * parsed AST.
 */
function analyzeComponent(
  parsed: ReturnType<typeof parseComponent>,
  options: CompileOptions,
) {
  const { ast, statements, returnIndex } = parsed
  // Top-level declarations shadow the Solid control-flow names. A local
  // `function Show` must compile as a component reference, not as <Show>.
  const localNames = new Set<string>()
  for (const node of ast.program.body) {
    if ((t.isFunctionDeclaration(node) || t.isClassDeclaration(node)) && node.id) {
      localNames.add(node.id.name)
    }
    if (t.isVariableDeclaration(node)) {
      for (const declarator of node.declarations) {
        if (t.isIdentifier(declarator.id)) localNames.add(declarator.id.name)
      }
    }
  }
  for (const node of statements.slice(0, returnIndex)) {
    if (t.isFunctionDeclaration(node) && node.id) localNames.add(node.id.name)
    if (t.isVariableDeclaration(node)) {
      for (const declarator of node.declarations) {
        if (t.isIdentifier(declarator.id)) localNames.add(declarator.id.name)
      }
    }
  }

  const contextNames = new Set<string>()
  const importedContexts = new Set<string>()
  const contextKeys = new Map<string, { key: string; imported: boolean }>()
  walkAst(ast, (node) => {
    if (!t.isVariableDeclarator(node) || !t.isIdentifier(node.id) || !node.init) return
    if (
      t.isCallExpression(node.init) &&
      t.isIdentifier(node.init.callee, { name: 'createContext' })
    ) {
      contextNames.add(node.id.name)
      contextKeys.set(node.id.name, {
        key: `${options.sourceFile ?? '<inline>'}#${node.id.name}`,
        imported: false,
      })
    }
  })
  // An import is only a context when the file uses it as one: passed to
  // `useContext`, or provided through `Context.Provider`. Without this set,
  // every imported component with a `value` prop would compile as a provider.
  walkAst(ast, (node) => {
    if (
      t.isCallExpression(node) &&
      t.isIdentifier(node.callee, { name: 'useContext' }) &&
      t.isIdentifier(node.arguments[0])
    ) {
      importedContexts.add(node.arguments[0].name)
      return
    }
    if (
      t.isJSXMemberExpression(node) &&
      t.isJSXIdentifier(node.object) &&
      t.isJSXIdentifier(node.property, { name: 'Provider' })
    ) {
      importedContexts.add(node.object.name)
    }
  })
  for (const node of ast.program.body) {
    if (!t.isImportDeclaration(node)) continue
    const source = node.source.value
    const resolved =
      source.startsWith('.') && options.sourceFile
        ? path.resolve(path.dirname(options.sourceFile), source)
        : source
    for (const specifier of node.specifiers) {
      const local = specifier.local.name
      if (!importedContexts.has(local)) continue
      if (t.isImportSpecifier(specifier)) {
        const imported = t.isIdentifier(specifier.imported)
          ? specifier.imported.name
          : specifier.imported.value
        contextKeys.set(local, {
          key: `${resolved}#${imported}`,
          imported: true,
        })
      } else if (t.isImportDefaultSpecifier(specifier)) {
        contextKeys.set(local, {
          key: `${resolved}#default`,
          imported: true,
        })
      }
    }
  }

  return { localNames, contextNames, importedContexts, contextKeys }
}

/**
 * Decide the child component property interface. Runs before template
 * compilation so prop projections see the final property names.
 */
function finalizeProps(
  props: string[],
  boundaryContexts: BoundaryContext[],
  structured: boolean,
  pageContext: boolean,
) {
  const eventProps = Object.fromEntries(
    props
      .filter((name) => isEventProp(name))
      .map((name) => {
        const binding = splitEventBinding(name)
        return [name, eventNameFor(binding?.base ?? name)]
      }),
  )
  if (props.some((name) => name.toLowerCase() === STRUCTURED_PROPS)) {
    throw new Error(
      `Component props may not use the reserved compiler property "${STRUCTURED_PROPS}"`,
    )
  }
  // The parent cannot pass this name either; declaring it would emit a property
  // that always collides with the compiled context bridge.
  if (props.some((name) => name.toLowerCase() === CONTEXT_PROP)) {
    throw new Error(
      `Component props may not use the reserved compiler property "${CONTEXT_PROP}"`,
    )
  }
  if (props.some((name) => name.toLowerCase() === PAGE_PROP)) {
    throw new Error(
      `Component props may not use the reserved compiler property "${PAGE_PROP}"`,
    )
  }
  const plainProps = [
    ...props.filter((name) => !Object.hasOwn(eventProps, name)),
    ...(boundaryContexts.length > 0 ? [CONTEXT_PROP] : []),
    ...(pageContext ? [PAGE_PROP] : []),
  ]
  // A one-prop child has no property fan-out to remove, and its parent keeps
  // the normal attribute path; do not add the compact property or fallback.
  const structuredProps = structured && hasGroupableProps(plainProps)
  const propertyNames = plainProps.map((name) => name.toLowerCase())
  if (new Set(propertyNames).size !== propertyNames.length) {
    throw new Error('Component props collide after lowercasing to mini-program property names')
  }
  if (propertyNames.some((name) => /^b\d+$/.test(name))) {
    throw new Error('Component props may not use compiler data keys such as b0')
  }
  const propMap = Object.fromEntries(plainProps.map((name, index) => [name, propertyNames[index]]))
  return { eventProps, plainProps, propertyNames, propMap, structuredProps }
}

export function compileComponent(source: string, options: CompileOptions = {}): CompileResult {
  const parsed = parseComponent(source)
  rejectUnsupportedSolidHelpers(parsed.ast, parsed.fn)
  const { ast, statements, returnIndex, jsx, propsParam, props } = parsed
  const { localNames, contextNames, importedContexts, contextKeys } = analyzeComponent(parsed, options)

  const ctx: CompilerContext = {
    bindings: [],
    events: [],
    refs: [],
    helpers: new Set<string>(),
    components: [],
    inlineComponents: [],
    assets: [],
    imports: collectImports(ast),
    knownImports: new Set(
      ast.program.body
        .filter((node) => t.isImportDeclaration(node))
        .flatMap((node) => node.specifiers.map((specifier) => specifier.local.name)),
    ),
    extraImports: [],
    inlineChildren: null,
    inlinePropsParam: null,
    inlineChildrenUsed: false,
    inlineChildrenCount: 0,
    rootPropsParam: propsParam?.name ?? null,
    propMap: {},
    propReads: new Set<string>(),
    allPropsRead: false,
    structuredProps: options.structuredProps === true,
    pageContext: options.pageContext === true,
    pageRoot: options.pageRoot === true,
    contextNames,
    importedContexts,
    contextKeys,
    activeProviders: [],
    boundaryContexts: [],
    currentProvider: null,
    usesSlot: false,
    nextAsyncBoundary: 0,
    currentLoadingBoundary: null,
    currentErrorBoundary: null,
    currentBoundary: null,
    currentBoundaryRegion: 'content',
    currentRevealGroup: null,
    asyncStatus: [],
    boundaries: [],
    listProjectionBlocked: new Set<number>(),
    namedSlots: new Set<string>(),
    usesWxs: false,
    usesWxsValue: false,
    localNames,
    blocks: [
      {
        setup: statements.slice(0, returnIndex),
        effects: [],
        propsParam: null,
        propGetters: [],
        provider: null,
      },
    ],
    currentBlock: 0,
    currentFile: options.sourceFile ?? null,
    sourceText: source,
    program: ast.program,
    inlineStack: options.sourceFile ? [options.sourceFile] : [],
    guards: [],
    refForbidden: 0,
    inline: options.inline ?? false,
    resolveComponent: options.resolveComponent ?? null,
    notePropReads(expression) {
      const rootName = propsParam?.name
      if (!rootName) return
      const visit = (node, parent) => {
        if (!node || typeof node.type !== 'string') return
        if (t.isIdentifier(node, { name: rootName })) {
          if (
            !(
              parent &&
              (t.isMemberExpression(parent) || t.isOptionalMemberExpression(parent)) &&
              parent.object === node
            ) &&
            !isStaticPropertyKey(node, parent)
          ) {
            this.allPropsRead = true
          }
          return
        }
        const member =
          t.isMemberExpression(node) || t.isOptionalMemberExpression(node)
        if (member && t.isIdentifier(node.object, { name: rootName })) {
          if (!node.computed && t.isIdentifier(node.property)) {
            this.propReads.add(node.property.name)
          } else {
            this.allPropsRead = true
          }
          if (node.computed) visit(node.property, node)
          return
        }
        for (const key of t.VISITOR_KEYS[node.type] ?? []) {
          const value = node[key]
          if (Array.isArray(value)) value.forEach((child) => visit(child, node))
          else visit(value, node)
        }
      }
      for (const item of Array.isArray(expression) ? expression : [expression]) {
        visit(item, null)
      }
    },
    addBinding(expression, listKey = null) {
      this.notePropReads(expression)
      if (containsJsx(expression)) {
        throw new Error('JSX values are not supported in expressions; use a JSX branch or child')
      }
      const index = this.bindings.length
      this.bindings.push({
        code: this.guardCode(codeOf(expression)),
        listKey,
        block: this.currentBlock,
        asyncBoundary: this.currentLoadingBoundary,
        errorBoundary: this.currentErrorBoundary,
        listFields: null,
      })
      const boundary = this.currentBoundary
      if (boundary != null && this.currentBoundaryRegion === 'content') {
        this.boundaries[boundary]?.content.push(index)
      }
      return index
    },
    addEvent(expression, scope = null, custom = false) {
      this.notePropReads(expression)
      const index = this.events.length
      this.events.push({ code: codeOf(expression), ast: expression, scope, custom, block: this.currentBlock })
      return index
    },
    addEffectCode(code, reads = null) {
      if (reads) this.notePropReads(reads)
      this.blocks[this.currentBlock].effects.push(code)
    },
    addSetupStatement(statement) {
      this.blocks[this.currentBlock].setup.push(statement)
    },
    addBindingCode(code, listKey = null, reads = null) {
      if (reads) this.notePropReads(reads)
      const index = this.bindings.length
      this.bindings.push({
        code: this.guardCode(code),
        listKey,
        block: this.currentBlock,
        asyncBoundary: this.currentLoadingBoundary,
        errorBoundary: this.currentErrorBoundary,
        listFields: null,
      })
      const boundary = this.currentBoundary
      if (boundary != null && this.currentBoundaryRegion === 'content') {
        this.boundaries[boundary]?.content.push(index)
      }
      return index
    },
    guardCode(code) {
      if (this.guards.length === 0) return code
      const guard = this.guards.map((item) => `(${item})`).join(' && ')
      return `(${guard}) ? (${code}) : undefined`
    },
    withGuard(guard, fn) {
      if (!guard) return fn()
      this.guards.push(guard)
      try {
        return fn()
      } finally {
        this.guards.pop()
      }
    },
    withRefForbidden(fn) {
      this.refForbidden += 1
      try {
        return fn()
      } finally {
        this.refForbidden -= 1
      }
    },
    addHelper(name) {
      this.helpers.add(name)
    },
    addWxs() {
      this.usesWxs = true
    },
    addWxsValue() {
      this.usesWxsValue = true
    },
    addRef(expression) {
      this.notePropReads(expression)
      const index = this.refs.length
      this.refs.push({ code: codeOf(expression), block: this.currentBlock })
      return index
    },
    addComponent(name, source, fromFile = this.currentFile) {
      if (!this.components.some((item) => item.name === name)) {
        this.components.push({ name, source, ...(fromFile ? { fromFile } : {}) })
      }
    },
  }

  for (const statement of statements.slice(0, returnIndex)) {
    ctx.notePropReads(statement)
  }

  // Context used by a component boundary is passed as one JSON property. The
  // child wraps its setup in the providers it actually consumes, so a provider
  // in the parent can reach a separate mini-program component without sharing
  // its Solid owner.
  const providedHere = new Set<string>()
  walkAst(jsx, (node) => {
    if (!t.isJSXElement(node)) return
    const name = node.openingElement.name
    if (t.isJSXIdentifier(name)) providedHere.add(name.name)
    if (
      t.isJSXMemberExpression(name) &&
      t.isJSXIdentifier(name.object) &&
      t.isJSXIdentifier(name.property, { name: 'Provider' })
    ) {
      providedHere.add(name.object.name)
    }
  })
  const collectBoundaryContexts = (root) =>
    walkAst(root, (node) => {
      if (!t.isCallExpression(node) || !t.isIdentifier(node.callee, { name: 'useContext' })) return
      const argument = node.arguments[0]
      if (!t.isIdentifier(argument)) return
      const entry = contextKeys.get(argument.name)
      // A context provided in this component is consumed through that inline
      // provider. Only a context owned by an outer component needs the
      // boundary property.
      if (!entry || providedHere.has(argument.name)) return
      if (!ctx.boundaryContexts.some((item) => item.key === entry.key)) {
        ctx.boundaryContexts.push({ name: argument.name, key: entry.key })
      }
    })
  collectBoundaryContexts({ type: 'BlockStatement', body: statements.slice(0, returnIndex) })
  collectBoundaryContexts(jsx)

  // `useContext` returns a reader in generated code so object and primitive
  // values both follow provider updates. The source keeps its normal Solid
  // shape; only the generated AST is rewritten.
  rewriteContextAccess(...statements)

  const {
    eventProps,
    plainProps,
    propertyNames,
    propMap,
    structuredProps,
  } = finalizeProps(props, ctx.boundaryContexts, ctx.structuredProps, ctx.pageContext)
  ctx.structuredProps = structuredProps
  ctx.propMap = propMap
  const warnings = collectAsyncReadWarnings(ast, propsParam?.name ?? null)
  const bodyWxml = compileNode(jsx, ctx, null)
  const wxs = [
    ctx.usesWxs ? `<wxs module="glazeRange">${WXS_SOURCE}</wxs>` : '',
    ctx.usesWxsValue ? `<wxs module="glazeValue">${WXS_VALUE_SOURCE}</wxs>` : '',
  ].join('')
  const wxml = `${wxs}${bodyWxml}`
  // Fail closed: code fragments that still mention `props` must already have
  // been registered at their generation point. This catches a new generation
  // path that forgot to call `notePropReads`; an unregistered read would
  // otherwise make the runtime omit the signal and read `undefined`.
  if (propsParam && !ctx.allPropsRead) {
    const audit = [
      ...statements.slice(0, returnIndex).map((node) => codeOf(node)),
      ...ctx.bindings.map((binding) => binding.code),
      ...ctx.events.map((event) => event.code),
      ...ctx.refs.map((ref) => ref.code),
      ...ctx.blocks.flatMap((block) => [
        ...block.setup.map((node) => codeOf(node)),
        ...block.effects,
        ...block.propGetters.map((getter) => getter.code),
        ...(block.providerValue ? [block.providerValue] : []),
      ]),
    ]
    if (hasUnregisteredPropRead(audit, propsParam.name, ctx.propReads)) {
      ctx.allPropsRead = true
    }
  }

  const propSignals = plainProps
    .filter((name) => ctx.allPropsRead || ctx.propReads.has(name))
    .map((name) => propMap[name])
  if (ctx.boundaryContexts.length > 0 && !propSignals.includes(CONTEXT_PROP)) {
    propSignals.push(CONTEXT_PROP)
  }

  const effectivePropsParam =
    propsParam?.name ?? (ctx.boundaryContexts.length > 0 ? '__glazeProps' : null)
  const listFields = Object.fromEntries(
    ctx.bindings.flatMap((binding, index) =>
      binding.listFields && binding.listFields.length > 0
        ? [[String(index), binding.listFields] as const]
        : [],
    ),
  )
  const js = emitModule(ast, ctx, {
    bindingGroupSize: options.bindingGroupSize,
    propsParam: effectivePropsParam,
    props: plainProps,
    propertyNames,
    propMap,
    eventProps,
    usesSlot: ctx.usesSlot,
    namedSlots: [...ctx.namedSlots],
    boundaryContexts: ctx.boundaryContexts,
    asyncStatus: ctx.asyncStatus,
    boundaries: ctx.boundaries,
    propSignals,
    listFields,
    structuredProps: ctx.structuredProps,
    pageContext: ctx.pageContext,
    pageRoot: ctx.pageRoot,
    componentFramework: options.componentFramework,
  })

  return {
    wxml,
    js,
    props: plainProps,
    propertyNames,
    propMap,
    eventProps,
    usesSlot: ctx.usesSlot,
    namedSlots: [...ctx.namedSlots],
    boundaryContexts: ctx.boundaryContexts,
    asyncStatus: ctx.asyncStatus,
    boundaries: ctx.boundaries,
    propSignals,
    listFields,
    components: ctx.components,
    inlineComponents: ctx.inlineComponents,
    assets: ctx.assets,
    bindingCount: ctx.bindings.length,
    handlerCount: ctx.events.length,
    structuredProps: ctx.structuredProps,
    pageContext: ctx.pageContext,
    pageRoot: ctx.pageRoot,
    warnings,
  }
}
