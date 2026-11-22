import path from 'node:path'
import * as t from '@babel/types'
import { codeOf, containsJsx, walkAst } from './ast.ts'
import { WXS_SOURCE } from './constants.ts'
import { emitModule } from './emit.ts'
import { eventNameFor, splitEventBinding } from './events.ts'
import { parseComponent, collectImports } from './parse.ts'
import { compileNode } from './elements.ts'
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
    contextNames,
    contextKeys,
    activeProviders: [],
    boundaryContexts: [],
    currentProvider: null,
    usesSlot: false,
    usesErrorBoundary: false,
    nextAsyncBoundary: 0,
    currentAsyncBoundary: null,
    asyncStatus: [],
    namedSlots: new Set<string>(),
    usesWxs: false,
    blocks: [
      {
        setup: statements.slice(0, returnIndex),
        propsParam: null,
        propGetters: [],
        provider: null,
      },
    ],
    currentBlock: 0,
    currentFile: options.sourceFile ?? null,
    inlineStack: options.sourceFile ? [options.sourceFile] : [],
    guards: [],
    inline: options.inline ?? false,
    resolveComponent: options.resolveComponent ?? null,
    addBinding(expression, listKey = null) {
      if (containsJsx(expression)) {
        throw new Error('JSX values are not supported in expressions; use a JSX branch or child')
      }
      const index = this.bindings.length
      this.bindings.push({
        code: this.guardCode(codeOf(expression)),
        listKey,
        block: this.currentBlock,
        asyncBoundary: this.currentAsyncBoundary,
      })
      return index
    },
    addEvent(expression, scope = null, custom = false) {
      const index = this.events.length
      this.events.push({ code: codeOf(expression), ast: expression, scope, custom, block: this.currentBlock })
      return index
    },
    addBindingCode(code, listKey = null) {
      const index = this.bindings.length
      this.bindings.push({
        code: this.guardCode(code),
        listKey,
        block: this.currentBlock,
        asyncBoundary: this.currentAsyncBoundary,
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
    addHelper(name) {
      this.helpers.add(name)
    },
    addWxs() {
      this.usesWxs = true
    },
    addRef(expression) {
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

  // Context used by a component boundary is passed as one JSON property. The
  // child wraps its setup in the providers it actually consumes, so a provider
  // in the parent can reach a separate mini-program component without sharing
  // its Solid owner.
  walkAst({ type: 'BlockStatement', body: statements.slice(0, returnIndex) }, (node) => {
    if (!t.isCallExpression(node) || !t.isIdentifier(node.callee, { name: 'useContext' })) return
    const argument = node.arguments[0]
    if (!t.isIdentifier(argument)) return
    const entry = contextKeys.get(argument.name)
    if (!entry?.imported) return
    if (!ctx.boundaryContexts.some((item) => item.key === entry.key)) {
      ctx.boundaryContexts.push({ name: argument.name, key: entry.key })
    }
  })

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

  const bodyWxml = compileNode(jsx, ctx, null)
  const wxml = ctx.usesWxs
    ? `<wxs module="glazeRange">${WXS_SOURCE}</wxs>${bodyWxml}`
    : bodyWxml
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
    components: ctx.components,
    inlineComponents: ctx.inlineComponents,
    assets: ctx.assets,
    bindingCount: ctx.bindings.length,
    handlerCount: ctx.events.length,
    refCount: ctx.refs.length,
  }
}
