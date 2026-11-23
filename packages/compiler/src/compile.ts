import path from 'node:path'
import * as t from '@babel/types'
import { codeOf, containsJsx, isStaticPropertyKey, walkAst } from './ast.ts'
import { WXS_SOURCE, WXS_VALUE_SOURCE } from './constants.ts'
import { emitModule } from './emit.ts'
import { eventNameFor, splitEventBinding } from './events.ts'
import { parseComponent, collectImports } from './parse.ts'
import { compileNode } from './elements.ts'
import { rewriteContextAccess } from './context.ts'
import type {
  AnyNode,
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
export function compileComponent(source: string, options: CompileOptions = {}): CompileResult {
  const parsed = parseComponent(source)
  const { ast, statements, returnIndex, jsx, propsParam, props } = parsed

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
  for (const node of ast.program.body) {
    if (!t.isImportDeclaration(node)) continue
    const source = node.source.value
    const resolved =
      source.startsWith('.') && options.sourceFile
        ? path.resolve(path.dirname(options.sourceFile), source)
        : source
    for (const specifier of node.specifiers) {
      if (t.isImportSpecifier(specifier)) {
        const imported = t.isIdentifier(specifier.imported)
          ? specifier.imported.name
          : specifier.imported.value
        contextKeys.set(specifier.local.name, {
          key: `${resolved}#${imported}`,
          imported: true,
        })
      } else if (t.isImportDefaultSpecifier(specifier)) {
        contextKeys.set(specifier.local.name, {
          key: `${resolved}#default`,
          imported: true,
        })
      }
    }
  }

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
    contextNames,
    contextKeys,
    activeProviders: [],
    boundaryContexts: [],
    currentProvider: null,
    usesSlot: false,
    usesErrorBoundary: false,
    nextAsyncBoundary: 0,
    currentLoadingBoundary: null,
    currentErrorBoundary: null,
    asyncStatus: [],
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
      })
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
      })
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

  const eventProps = Object.fromEntries(
    props
      .filter((name) => /^on[A-Z]/.test(name))
      .map((name) => {
        const binding = splitEventBinding(name)
        return [name, eventNameFor(binding?.base ?? name)]
      }),
  )
  const plainProps = [
    ...props.filter((name) => !eventProps[name]),
    ...(ctx.boundaryContexts.length > 0 ? ['glazecontext'] : []),
  ]
  const propertyNames = plainProps.map((name) => name.toLowerCase())
  if (new Set(propertyNames).size !== propertyNames.length) {
    throw new Error('Component props collide after lowercasing to mini-program property names')
  }
  if (propertyNames.some((name) => /^b\d+$/.test(name))) {
    throw new Error('Component props may not use compiler data keys such as b0')
  }
  const propMap = Object.fromEntries(plainProps.map((name, index) => [name, propertyNames[index]]))
  ctx.propMap = propMap
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
        ...block.propGetters.map((getter) => getter.code),
        ...(block.providerValue ? [block.providerValue] : []),
      ]),
    ]
    const param = propsParam.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const reference = new RegExp(
      `\\b${param}\\b\\s*(?:\\??\\.\\s*([A-Za-z_$][\\w$]*))?`,
      'g',
    )
    for (const code of audit) {
      for (const match of code.matchAll(reference)) {
        const name = match[1]
        if (!name || !ctx.propReads.has(name)) {
          ctx.allPropsRead = true
          break
        }
      }
      if (ctx.allPropsRead) break
    }
  }

  const propSignals = plainProps
    .filter((name) => ctx.allPropsRead || ctx.propReads.has(name))
    .map((name) => propMap[name])
  if (ctx.boundaryContexts.length > 0 && !propSignals.includes('glazecontext')) {
    propSignals.push('glazecontext')
  }

  const effectivePropsParam =
    propsParam?.name ?? (ctx.boundaryContexts.length > 0 ? '__glazeProps' : null)
  const js = emitModule(ast, statements.slice(0, returnIndex), ctx, {
    bindingGroupSize: options.bindingGroupSize,
    propsParam: effectivePropsParam,
    props: plainProps,
    propertyNames,
    propMap,
    eventProps,
    usesSlot: ctx.usesSlot,
    errorBoundary: ctx.usesErrorBoundary,
    namedSlots: [...ctx.namedSlots],
    boundaryContexts: ctx.boundaryContexts,
    asyncStatus: ctx.asyncStatus,
    propSignals,
  })

  return {
    wxml,
    js,
    props: plainProps,
    propertyNames,
    propMap,
    eventProps,
    usesSlot: ctx.usesSlot,
    errorBoundary: ctx.usesErrorBoundary,
    namedSlots: [...ctx.namedSlots],
    boundaryContexts: ctx.boundaryContexts,
    asyncStatus: ctx.asyncStatus,
    propSignals,
    components: ctx.components,
    inlineComponents: ctx.inlineComponents,
    assets: ctx.assets,
    bindingCount: ctx.bindings.length,
    handlerCount: ctx.events.length,
    refCount: ctx.refs.length,
  }
}
