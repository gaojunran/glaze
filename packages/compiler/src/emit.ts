import * as t from '@babel/types'
import { CONTEXT_PROP, bindingKey, dataIndexKey } from '@glaze/shared'
import { codeOf } from './ast.ts'
import { rewriteAccessorCalls } from './scope.ts'
import type { AnyNode, CompilerContext, EmitOptions, GeneratedConfigMetadata } from './types.ts'

export function emitModule(ast: AnyNode, ctx: CompilerContext, options: EmitOptions): string {
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

  const setupParams = options.propsParam ? `, ${options.propsParam}` : ''

  const renderRefs = (blockId) =>
    ctx.refs
      .map((ref, index) =>
        ref.block === blockId ? `    ctx.ref(${index}, ${ref.code});` : '',
      )
      .filter(Boolean)
      .join('\n')

  const bindingArgs = (binding) => {
    const loading = binding.asyncBoundary
    const error = binding.errorBoundary
    if (loading == null && error == null) return ''
    if (loading === error) return `, ${loading}`
    return `, ${loading ?? 'null'}, ${error ?? 'null'}`
  }

  const renderBindings = (blockId) =>
    ctx.bindings
      .map((binding, index) =>
        binding.block === blockId
          ? `    ctx.bind(${index}, () => (${binding.code})${bindingArgs(binding)});`
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
          ? `(${code})(__glazeEvent.detail)`
          : `(${code})(__glazeEvent)`
        if (!event.scope) {
          if (!event.custom) return `    ctx.event(${index}, (__glazeEvent) => (${code})(__glazeEvent));`
          return `    ctx.event(${index}, (__glazeEvent) => ${call});`
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
            const key = dataIndexKey(scope.level)
            const indexLine = `      const ${scope.index} = Number(__glazeEvent.currentTarget.dataset.${key});`
            if (scope.isIndexRepeat) {
              const offset = scope.offset ? ` + (${scope.offset})` : ''
              return scope.item === scope.index
                ? indexLine
                : `${indexLine}\n      const ${scope.item} = ${scope.index}${offset};`
            }
            return `${indexLine}\n      const ${scope.item} = (${scope.jsSource ?? scope.source})[${scope.index}];`
          })
          .join('\n')
        return `    ctx.event(${index}, (__glazeEvent) => {
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
      block.effects.join('\n'),
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
      return `  {\n    withProvider(${block.providerContext}, (${block.providerValue}), () => {\n${indent(inner, 6)}\n    }, () => (${block.providerValue}));\n  }`
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
  }], () => ${options.propsParam}.${CONTEXT_PROP}, () => {
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

  // The JSON half of the generated config. Its field order matches the original
  // hand-written emitter so the emitted code is byte-identical.
  const metadata: GeneratedConfigMetadata = {
    data: Object.fromEntries(ctx.bindings.map((_, index) => [bindingKey(index), null])),
    listBindings: Object.fromEntries(
      ctx.bindings
        .map((binding, index) => [index, binding.listKey])
        .filter(([, key]) => key),
    ),
    handlerCount: ctx.events.length,
  }
  if (options.propertyNames.length > 0) metadata.properties = options.propertyNames
  if (
    Object.keys(options.propMap).length > 0 &&
    options.propertyNames.some((name, index) => name !== options.props[index])
  ) {
    metadata.propMap = options.propMap
  }
  if (options.propSignals && options.propSignals.length !== options.propertyNames.length) {
    metadata.propSignals = options.propSignals
  }
  if (options.asyncStatus && options.asyncStatus.length > 0) {
    metadata.asyncStatus = options.asyncStatus
  }
  if (Object.keys(options.eventProps ?? {}).length > 0) metadata.eventProps = options.eventProps
  if (Object.keys(options.listFields ?? {}).length > 0) metadata.listFields = options.listFields
  if (options.structuredProps) metadata.structuredProps = true
  if (options.bindingGroupSize !== undefined) metadata.bindingGroupSize = options.bindingGroupSize
  if (hasBoundaryContext) {
    metadata.boundaryContexts = boundaryContexts.map((item) => ({
      name: item.name,
      key: item.key,
    }))
  }
  const renderMetadata = (config: GeneratedConfigMetadata) => {
    const line = (key: keyof GeneratedConfigMetadata, value: unknown) =>
      `  ${key}: ${JSON.stringify(value)},\n`
    return [
      config.properties && line('properties', config.properties),
      config.propMap && line('propMap', config.propMap),
      config.eventProps && line('eventProps', config.eventProps),
      config.propSignals && line('propSignals', config.propSignals),
      config.asyncStatus && line('asyncStatus', config.asyncStatus),
      config.structuredProps && line('structuredProps', config.structuredProps),
      config.bindingGroupSize !== undefined &&
        line('bindingGroupSize', config.bindingGroupSize),
      config.boundaryContexts && line('boundaryContexts', config.boundaryContexts),
      config.data && line('data', config.data),
      config.listBindings && line('listBindings', config.listBindings),
      config.listFields && line('listFields', config.listFields),
      // The original emitter always left a blank line before handlerCount.
      '\n',
      config.handlerCount !== undefined && line('handlerCount', config.handlerCount),
    ]
      .filter(Boolean)
      .join('')
  }
  return `${imports}
import { ${runtimeImports} } from "@glaze/runtime/mini";

${moduleStatements}

export default defineGlazeComponent({
${renderMetadata(metadata)}  setup(ctx${setupParams}) {
${setup}
  },
});
`
}
