import * as t from '@babel/types'
import { codeOf } from './ast.ts'
import { rewriteAccessorCalls } from './scope.ts'
import type { AnyNode, CompilerContext, EmitOptions } from './types.ts'

export function emitModule(ast: AnyNode, setupStatements: AnyNode[], ctx: CompilerContext, options: EmitOptions): string {
  const componentNames = new Set(
    [...ctx.components, ...ctx.inlineComponents].map((item) => item.name),
  )
  const imports = [
    ...ast.program.body
      .filter((node) => t.isImportDeclaration(node))
      .filter((node) => {
        const locals = node.specifiers.map((specifier) => specifier.local.name)
        const onlyComponents = locals.length > 0 && locals.every((name) => componentNames.has(name))
        return !(node.source.value.startsWith('.') && onlyComponents)
      })
      .map((node) => codeOf(node)),
    ...ctx.extraImports,
  ].join('\n')

  const moduleStatements = ast.program.body
    .flatMap((node) => {
      if (t.isImportDeclaration(node) || t.isExportDefaultDeclaration(node)) return []
      if (t.isExportNamedDeclaration(node)) {
        return node.declaration ? [codeOf(node.declaration)] : []
      }
      if (t.isExportAllDeclaration(node)) return []
      return [codeOf(node)]
    })
    .join('\n')

  const data = JSON.stringify(
    Object.fromEntries(ctx.bindings.map((_, index) => [`b${index}`, null])),
  )
  const listBindings = Object.fromEntries(
    ctx.bindings
      .map((binding, index) => [index, binding.listKey])
      .filter(([, key]) => key),
  )
  const properties =
    options.propertyNames.length > 0
      ? `  properties: ${JSON.stringify(options.propertyNames)},\n`
      : ''
  const propMap =
    Object.keys(options.propMap).length > 0 &&
    options.propertyNames.some((name, index) => name !== options.props[index])
      ? `  propMap: ${JSON.stringify(options.propMap)},\n`
      : ''
  const errorBoundary = options.errorBoundary ? '  errorBoundary: true,\n' : ''
  const eventProps =
    Object.keys(options.eventProps ?? {}).length > 0
      ? `  eventProps: ${JSON.stringify(options.eventProps)},\n`
      : ''
  const setupParams = options.propsParam ? `, ${options.propsParam}` : ''

  const renderRefs = (blockId) =>
    ctx.refs
      .map((ref, index) =>
        ref.block === blockId ? `    ctx.ref(${index}, ${ref.code});` : '',
      )
      .filter(Boolean)
      .join('\n')

  const renderBindings = (blockId) =>
    ctx.bindings
      .map((binding, index) =>
        binding.block === blockId
          ? `    ctx.bind(${index}, () => (${binding.code})${
              binding.asyncBoundary == null ? '' : `, ${binding.asyncBoundary}`
            });`
          : '',
      )
      .filter(Boolean)
      .join('\n')

  const renderEvents = (blockId) =>
    ctx.events
      .map((event, index) => {
        if (event.block !== blockId) return ''
        const code = event.scope
          ? codeOf(rewriteAccessorCalls(event.ast, event.scope, true))
          : event.code
        const call = event.custom
          ? `(${code})(event.detail)`
          : `(${code})(event)`
        if (!event.scope) {
          if (!event.custom) return `    ctx.event(${index}, (event) => (${code})(event));`
          return `    ctx.event(${index}, (event) => ${call});`
        }
        const chain = []
        for (let cursor = event.scope; cursor; cursor = cursor.parent) {
          chain.unshift(cursor)
        }
        const lines = chain
          .map((scope) => {
            if (scope.direct) {
              return `      const ${scope.eventItem ?? scope.item} = (${scope.direct});`
            }
            const key = scope.level === 0 ? 'glazeIndex' : `glazeIndex${scope.level}`
            const indexLine = `      const ${scope.index} = Number(event.currentTarget.dataset.${key});`
            if (scope.isIndexRepeat) {
              const offset = scope.offset ? ` + (${scope.offset})` : ''
              return scope.item === scope.index
                ? indexLine
                : `${indexLine}\n      const ${scope.item} = ${scope.index}${offset};`
            }
            return `${indexLine}\n      const ${scope.item} = (${scope.jsSource ?? scope.source})[${scope.index}];`
          })
          .join('\n')
        return `    ctx.event(${index}, (event) => {
${lines}
      return ${call};
    });`
      })
      .filter(Boolean)
      .join('\n')

  const indent = (code, spaces) =>
    code
      .split('\n')
      .map((line) => (line ? `${' '.repeat(spaces)}${line}` : line))
      .join('\n')

  const renderBlock = (blockId) => {
    const block = ctx.blocks[blockId]
    const body = [
      block.setup.map((node) => codeOf(node)).join('\n'),
      renderRefs(blockId),
      renderBindings(blockId),
      renderEvents(blockId),
    ]
      .filter(Boolean)
      .join('\n')

    if (block.providerContext) {
      const children = ctx.blocks
        .map((_, index) => (index !== blockId && ctx.blocks[index].provider === blockId ? renderBlock(index) : ''))
        .filter(Boolean)
        .join('\n')
      const inner = [body, children].filter(Boolean).join('\n')
      return `  {\n    withProvider(${block.providerContext}, (${block.providerValue}), () => {\n${indent(inner, 6)}\n    });\n  }`
    }

    const props = block.propsParam
      ? `    const ${block.propsParam} = {\n${block.propGetters
          .map((getter) => `      get ${getter.name}() { return (${getter.code}); },`)
          .join('\n')}\n    };\n`
      : ''

    if (blockId === 0) return body
    return `  {\n${props}${indent(body, 4)}\n  }`
  }

  const rawSetup = ctx.blocks
    .map((block, blockId) => (block.provider === null ? renderBlock(blockId) : ''))
    .filter(Boolean)
    .join('\n')

  const boundaryContexts = options.boundaryContexts ?? []
  const hasBoundaryContext = boundaryContexts.length > 0
  const setup = hasBoundaryContext
    ? `  // Values cross the mini-program property bridge; the child re-enters each
  // provider it consumes before running its own setup.
  withBoundaryContexts([${
    boundaryContexts
      .map((item) => `{ context: ${item.name}, key: ${JSON.stringify(item.key)} }`)
      .join(', ')
  }], ${options.propsParam}.glazecontext, () => {
${indent(rawSetup, 4)}
  });`
    : rawSetup

  const hasProvider = ctx.blocks.some((block) => block.providerContext)
  const helpers = [...ctx.helpers]
  const runtimeImports = [
    'defineGlazeComponent',
    ...(hasProvider ? ['withProvider'] : []),
    ...(hasBoundaryContext ? ['withBoundaryContexts'] : []),
    ...helpers,
  ].join(', ')
  return `${imports}
import { ${runtimeImports} } from "@glaze/runtime/mini";

${moduleStatements}

export default defineGlazeComponent({
${properties}${propMap}${eventProps}${errorBoundary}${
    options.bindingGroupSize === undefined
      ? ''
      : `  bindingGroupSize: ${options.bindingGroupSize},\n`
  }${hasBoundaryContext ? `  boundaryContexts: ${JSON.stringify(boundaryContexts.map((item) => ({ name: item.name, key: item.key })))},\n` : ''}  data: ${data},
  listBindings: ${JSON.stringify(listBindings)},
  handlerCount: ${ctx.events.length},
  refCount: ${ctx.refs.length},
  setup(ctx${setupParams}) {
${setup}
  },
});
`
}
