import { parse } from '@babel/parser'
import generatorModule from '@babel/generator'
import * as t from '@babel/types'

const generate = generatorModule.default ?? generatorModule

const WXS_SOURCE = `function range(count, from) {
  var n = (count - 0) || 0;
  var start = (from - 0) || 0;
  var list = [];
  for (var i = 0; i < n; i += 1) list.push(start + i);
  return list;
}
function single(value) { return [value]; }
module.exports = { range: range, single: single };`

const EVENT_MAP = {
  onClick: 'tap',
  onTap: 'tap',
  onInput: 'input',
  onChange: 'change',
  onConfirm: 'confirm',
  onFocus: 'focus',
  onBlur: 'blur',
  onSubmit: 'submit',
  onReset: 'reset',
  onLongPress: 'longpress',
  onLongTap: 'longtap',
  onTouchStart: 'touchstart',
  onTouchMove: 'touchmove',
  onTouchEnd: 'touchend',
  onTouchCancel: 'touchcancel',
}

// Longest suffixes first: onClickCaptureCatch must not be read as onClickCatch.
const EVENT_BINDINGS = [
  ['CaptureCatch', 'capture-catch'],
  ['CaptureMutBind', 'capture-mut-bind'],
  ['Capture', 'capture-bind'],
  ['MutBind', 'mut-bind'],
  ['Catch', 'catch'],
  ['', 'bind'],
]

const COMPONENT_EVENT_PREFIX = {
  bind: 'bind:',
  catch: 'catch:',
  'mut-bind': 'mut-bind:',
  'capture-bind': 'capture-bind:',
  'capture-catch': 'capture-catch:',
  'capture-mut-bind': 'capture-mut-bind:',
}

const NATIVE_EVENT_PREFIX = {
  bind: 'bind',
  catch: 'catch',
  'mut-bind': 'mut-bind:',
  'capture-bind': 'capture-bind:',
  'capture-catch': 'capture-catch:',
  'capture-mut-bind': 'capture-mut-bind:',
}

const splitEventBinding = (prop) => {
  for (const [suffix, kind] of EVENT_BINDINGS) {
    if (suffix && !prop.endsWith(suffix)) continue
    const base = suffix ? prop.slice(0, -suffix.length) : prop
    if (!/^on[A-Z]/.test(base)) continue
    return { base, kind }
  }
  return null
}

const eventAttrFor = (kind, eventName, custom) =>
  `${(custom ? COMPONENT_EVENT_PREFIX : NATIVE_EVENT_PREFIX)[kind]}${eventName}`

const escapeText = (value) =>
  value.replace(/[&<>{}]/g, (char) => {
    if (char === '&') return '&amp;'
    if (char === '<') return '&lt;'
    if (char === '>') return '&gt;'
    if (char === '{') return '&#123;'
    return '&#125;'
  })

const escapeAttr = (value) => escapeText(value).replace(/"/g, '&quot;')

const normalizeText = (value) => {
  const lines = value.replace(/\r\n?/g, '\n').split('\n')
  let first = -1
  let last = -1
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() !== '') {
      if (first === -1) first = i
      last = i
    }
  }
  if (first === -1) return ''
  const parts = []
  for (let i = first; i <= last; i += 1) {
    let line = lines[i]
    if (i !== first) line = line.replace(/^\s+/, '')
    if (i !== last) line = line.replace(/\s+$/, '')
    if (line !== '') parts.push(line)
  }
  return parts.join(' ')
}

const isWhitespaceText = (node) =>
  t.isJSXText(node) && normalizeText(node.value) === ''

const tagName = (name) => {
  if (t.isJSXIdentifier(name)) return name.name
  throw new Error('Unsupported JSX member tag')
}

const getAttribute = (node, name) =>
  node.openingElement.attributes.find(
    (attr) => t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name, { name }),
  )

function expandAttributes(attributes) {
  const expanded = []
  for (const attr of attributes) {
    if (t.isJSXAttribute(attr)) {
      expanded.push(attr)
      continue
    }
    if (!t.isJSXSpreadAttribute(attr) || !t.isObjectExpression(attr.argument)) {
      throw new Error('Only object literals can be spread into JSX attributes')
    }
    for (const property of attr.argument.properties) {
      if (!t.isObjectProperty(property) || property.computed) {
        throw new Error('JSX spread object must use static keys')
      }
      const key = t.isIdentifier(property.key)
        ? property.key.name
        : t.isStringLiteral(property.key)
          ? property.key.value
          : null
      if (!key) throw new Error('JSX spread object must use static keys')
      expanded.push(
        t.jsxAttribute(
          t.jsxIdentifier(key),
          t.isStringLiteral(property.value)
            ? property.value
            : t.jsxExpressionContainer(property.value),
        ),
      )
    }
  }
  return expanded
}

const getExpression = (attr) => {
  if (!attr) return null
  if (attr.value == null) return t.booleanLiteral(true)
  if (t.isStringLiteral(attr.value)) return t.stringLiteral(attr.value.value)
  if (t.isJSXExpressionContainer(attr.value)) {
    if (t.isJSXEmptyExpression(attr.value.expression)) return null
    return attr.value.expression
  }
  throw new Error('Unsupported attribute value')
}

const codeOf = (node) => generate(node).code

const eventNameFor = (prop) => {
  const rest = prop.slice(2)
  return rest.charAt(0).toLowerCase() + rest.slice(1)
}

const kebabCase = (name) =>
  name
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()

const containsJsx = (node) => {
  let found = false
  walkAst(node, (item) => {
    if (t.isJSXElement(item) || t.isJSXFragment(item)) found = true
  })
  return found
}

const walkAst = (node, visit) => {
  if (!node || typeof node.type !== 'string') return
  visit(node)
  for (const key of t.VISITOR_KEYS[node.type] ?? []) {
    const child = node[key]
    if (Array.isArray(child)) child.forEach((item) => walkAst(item, visit))
    else walkAst(child, visit)
  }
}

/**
 * Compile one Solid component source into a mini-program component pair.
 *
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
export function compileComponent(source, options = {}) {
  const parsed = parseComponent(source)
  const { ast, statements, returnIndex, jsx, propsParam, props } = parsed

  const contextNames = new Set()
  walkAst({ type: 'Program', body: statements }, (node) => {
    if (!t.isVariableDeclarator(node) || !t.isIdentifier(node.id) || !node.init) return
    if (
      t.isCallExpression(node.init) &&
      t.isIdentifier(node.init.callee, { name: 'createContext' })
    ) {
      contextNames.add(node.id.name)
    }
  })

  const ctx = {
    bindings: [],
    events: [],
    refs: [],
    helpers: new Set(),
    components: [],
    inlineComponents: [],
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
    currentProvider: null,
    usesSlot: false,
    namedSlots: new Set(),
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

  const eventProps = Object.fromEntries(
    props
      .filter((name) => /^on[A-Z]/.test(name))
      .map((name) => {
        const binding = splitEventBinding(name)
        return [name, eventNameFor(binding?.base ?? name)]
      }),
  )
  const plainProps = props.filter((name) => !eventProps[name])
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
  const js = emitModule(ast, statements.slice(0, returnIndex), ctx, {
    propsParam: propsParam?.name ?? null,
    props: plainProps,
    propertyNames,
    propMap,
    eventProps,
    usesSlot: ctx.usesSlot,
    namedSlots: [...ctx.namedSlots],
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
    components: ctx.components,
    inlineComponents: ctx.inlineComponents,
    bindingCount: ctx.bindings.length,
    handlerCount: ctx.events.length,
    refCount: ctx.refs.length,
  }
}

function parseComponent(source) {
  const ast = parse(source, {
    sourceType: 'module',
    plugins: ['typescript', 'jsx'],
  })

  const fn = findComponentFunction(ast)
  if (!fn) throw new Error('No default-exported component function found')
  if (fn.params.length > 1) {
    throw new Error('Component accepts at most one props parameter')
  }
  const propsParam = fn.params[0] ?? null
  if (propsParam && !t.isIdentifier(propsParam)) {
    throw new Error('Destructuring props is not reactive; use props.name instead')
  }
  const props = propsParam ? collectProps(propsParam.name, fn.body) : []

  const statements = functionStatements(fn)
  const returnIndex = statements.findIndex((node) => t.isReturnStatement(node))
  if (returnIndex < 0) throw new Error('Component function does not return JSX')
  if (returnIndex !== statements.length - 1) {
    throw new Error('Component must return JSX as its last top-level statement')
  }

  const jsx = statements[returnIndex].argument
  if (!t.isJSXElement(jsx) && !t.isJSXFragment(jsx)) {
    throw new Error('Component must return a JSX element')
  }

  return { ast, fn, statements, returnIndex, jsx, propsParam, props }
}

function findComponentFunction(ast) {
  for (const node of ast.program.body) {
    if (!t.isExportDefaultDeclaration(node)) continue
    const declaration = node.declaration
    if (t.isFunctionDeclaration(declaration)) return declaration
    if (t.isArrowFunctionExpression(declaration) || t.isFunctionExpression(declaration)) {
      return declaration
    }
    if (t.isIdentifier(declaration)) {
      const match = ast.program.body.find(
        (item) =>
          (t.isFunctionDeclaration(item) && item.id?.name === declaration.name) ||
          (t.isVariableDeclaration(item) &&
            item.declarations.some(
              (declarator) =>
                t.isIdentifier(declarator.id, { name: declaration.name }) &&
                declarator.init &&
                (t.isArrowFunctionExpression(declarator.init) ||
                  t.isFunctionExpression(declarator.init)),
            )),
      )
      if (match) {
        if (t.isFunctionDeclaration(match)) return match
        const declarator = match.declarations.find(
          (item) => t.isIdentifier(item.id, { name: declaration.name }),
        )
        return declarator?.init ?? null
      }
    }
  }
  return null
}

function functionStatements(fn) {
  if (t.isBlockStatement(fn.body)) return fn.body.body
  return [t.returnStatement(fn.body)]
}

function collectImports(ast) {
  const imports = new Map()
  for (const node of ast.program.body) {
    if (!t.isImportDeclaration(node)) continue
    for (const specifier of node.specifiers) {
      if (t.isImportDefaultSpecifier(specifier) || t.isImportSpecifier(specifier)) {
        imports.set(specifier.local.name, node.source.value)
      }
    }
  }
  return imports
}

function collectProps(paramName, body) {
  const props = new Set()
  const visit = (node) => {
    if (!node || typeof node.type !== 'string') return
    if (
      t.isFunction(node) &&
      node.params.some((param) => t.isIdentifier(param, { name: paramName }))
    ) {
      return
    }
    if (t.isMemberExpression(node) || t.isOptionalMemberExpression(node)) {
      if (t.isIdentifier(node.object, { name: paramName })) {
        if (!t.isIdentifier(node.property)) {
          throw new Error(`Computed prop access is not supported; use props.name instead`)
        }
        props.add(node.property.name)
      }
    }
    for (const key of t.VISITOR_KEYS[node.type] ?? []) {
      const child = node[key]
      if (Array.isArray(child)) child.forEach(visit)
      else visit(child)
    }
  }
  visit(body)
  return [...props].sort()
}

function emitModule(ast, setupStatements, ctx, options) {
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
        binding.block === blockId ? `    ctx.bind(${index}, () => (${binding.code}));` : '',
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

  const setup = ctx.blocks
    .map((block, blockId) => (block.provider === null ? renderBlock(blockId) : ''))
    .filter(Boolean)
    .join('\n')

  const hasProvider = ctx.blocks.some((block) => block.providerContext)
  const helpers = [...ctx.helpers]
  const runtimeImports = [
    'defineGlazeComponent',
    ...(hasProvider ? ['withProvider'] : []),
    ...helpers,
  ].join(', ')
  return `${imports}
import { ${runtimeImports} } from "@glaze/runtime/mini";

${moduleStatements}

export default defineGlazeComponent({
${properties}${propMap}${eventProps}  data: ${data},
  listBindings: ${JSON.stringify(listBindings)},
  handlerCount: ${ctx.events.length},
  refCount: ${ctx.refs.length},
  setup(ctx${setupParams}) {
${setup}
  },
});
`
}

function pushScopeIndexAttrs(attrs, scope) {
  for (let cursor = scope; cursor; cursor = cursor.parent) {
    if (cursor.direct) continue
    const attr = cursor.level === 0 ? 'data-glaze-index' : `data-glaze-index${cursor.level}`
    if (!attrs.some((item) => item.startsWith(`${attr}=`))) {
      attrs.push(`${attr}="{{${cursor.index}}}"`)
    }
  }
}

const directiveText = (extraAttrs) =>
  extraAttrs.length > 0 ? ` ${extraAttrs.join(' ')}` : ''

const wrapDirectives = (wxml, extraAttrs) =>
  extraAttrs.length > 0 ? `<block${directiveText(extraAttrs)}>${wxml}</block>` : wxml

function compileNode(node, ctx, scope, extraAttrs = []) {
  if (t.isJSXElement(node)) return compileElement(node, ctx, scope, extraAttrs)
  if (t.isJSXFragment(node)) {
    const children = compileChildren(node.children, ctx, scope)
    return wrapDirectives(`<block>${children}</block>`, extraAttrs)
  }
  if (t.isJSXText(node)) {
    return wrapDirectives(escapeText(normalizeText(node.value)), extraAttrs)
  }
  if (t.isJSXExpressionContainer(node)) {
    return wrapDirectives(
      compileExpressionChild(node.expression, ctx, scope),
      extraAttrs,
    )
  }
  throw new Error('Unsupported JSX child')
}

function compileElement(node, ctx, scope, extraAttrs = []) {
  const tag = node.openingElement.name
  if (
    t.isJSXMemberExpression(tag) &&
    t.isJSXIdentifier(tag.property, { name: 'Provider' })
  ) {
    return wrapDirectives(compileProvider(node, ctx, scope), extraAttrs)
  }
  const name = tagName(tag)
  if (t.isJSXIdentifier(tag) && ctx.contextNames.has(name)) {
    return wrapDirectives(compileProvider(node, ctx, scope), extraAttrs)
  }
  if (name === 'Show') return wrapDirectives(compileShow(node, ctx, scope), extraAttrs)
  if (name === 'For') return wrapDirectives(compileFor(node, ctx, scope), extraAttrs)
  if (name === 'Switch') return wrapDirectives(compileSwitch(node, ctx, scope), extraAttrs)
  if (name === 'Repeat') return wrapDirectives(compileRepeat(node, ctx, scope), extraAttrs)
  if (name === 'Match') {
    throw new Error('<Match> must be a direct child of <Switch>')
  }
  if (name === 'slot') {
    const slotName = getAttribute(node, 'name')
    const value = slotName && slotName.value && t.isStringLiteral(slotName.value)
      ? slotName.value.value
      : null
    if (value) ctx.namedSlots.add(value)
    else ctx.usesSlot = true
  }
  if (/^[A-Z]/.test(name)) {
    return compileComponentElement(node, ctx, scope, extraAttrs)
  }

  const attrs = []
  for (const attr of expandAttributes(node.openingElement.attributes)) {
    if (!t.isJSXAttribute(attr)) {
      throw new Error('JSX spread attributes are not supported')
    }
    const attrName = t.isJSXIdentifier(attr.name) ? attr.name.name : null
    if (!attrName) throw new Error('Unsupported JSX attribute name')
    if (attrName === 'key') continue
    if (attrName === 'ref') {
      if (scope) {
        throw new Error('ref inside <For>, <Show> or <Match> is not supported yet')
      }
      if (
        node.openingElement.attributes.some(
          (item) => t.isJSXAttribute(item) && t.isJSXIdentifier(item.name, { name: 'id' }),
        )
      ) {
        throw new Error('An element with ref cannot also set id')
      }
      const expression = getExpression(attr)
      if (!expression) throw new Error('ref requires a callback')
      if (containsJsx(expression)) throw new Error('ref cannot be JSX')
      const index = ctx.addRef(expression)
      attrs.push(`id="glaze-r${index}"`)
      continue
    }

    const expression = getExpression(attr)
    if (expression == null) continue

    if (/^on[A-Z]/.test(attrName)) {
      const binding = splitEventBinding(attrName)
      if (!binding || !EVENT_MAP[binding.base]) {
        throw new Error(`Unsupported event "${attrName}" on a native element`)
      }
      if (containsJsx(expression)) {
        throw new Error(`Event handler "${attrName}" cannot be JSX`)
      }
      const index = ctx.addEvent(expression, scope)
      attrs.push(`${eventAttrFor(binding.kind, EVENT_MAP[binding.base], false)}="e${index}"`)
      pushScopeIndexAttrs(attrs, scope)
      continue
    }

    if (attrName === 'innerHTML' || attrName === 'textContent') {
      throw new Error(`"${attrName}" is not supported; render child nodes instead`)
    }
    const propName = attrName === 'className' ? 'class' : attrName
    if (t.isStringLiteral(expression) || t.isNumericLiteral(expression)) {
      attrs.push(`${propName}="${escapeAttr(String(expression.value))}"`)
      continue
    }
    if (propName === 'class' && (t.isObjectExpression(expression) || t.isArrayExpression(expression))) {
      attrs.push(classAttr(expression, ctx, scope))
      continue
    }
    if (propName === 'style' && t.isObjectExpression(expression)) {
      attrs.push(styleAttr(expression, ctx, scope))
      continue
    }

    if (scope) {
      attrs.push(`${propName}="{{${inlineExpression(expression, scope, ctx)}}}"`)
    } else {
      const index = ctx.addBinding(expression)
      attrs.push(`${propName}="{{b${index}}}"`)
    }
  }

  const allAttrs = [...attrs, ...extraAttrs]
  const attrText = allAttrs.length > 0 ? ` ${allAttrs.join(' ')}` : ''
  const children = compileChildren(node.children, ctx, scope)
  if (children === '') return `<${name}${attrText} />`
  return `<${name}${attrText}>${children}</${name}>`
}

function compileComponentElement(node, ctx, scope, extraAttrs = []) {
  const name = tagName(node.openingElement.name)
  const source = ctx.imports.get(name)
  if (!source) {
    throw new Error(`Component <${name}> must be imported from a relative file`)
  }
  if (!source.startsWith('.')) {
    throw new Error(`Component <${name}> must come from a relative file, got "${source}"`)
  }
  const inlined = inlineComponent(node, ctx, scope, name, source)
  if (inlined != null) return wrapDirectives(inlined, extraAttrs)

  ctx.addComponent(name, source, ctx.currentFile)

  const attrs = []
  for (const attr of expandAttributes(node.openingElement.attributes)) {
    if (!t.isJSXAttribute(attr)) {
      throw new Error('JSX spread attributes are not supported')
    }
    const attrName = t.isJSXIdentifier(attr.name) ? attr.name.name : null
    if (!attrName) throw new Error('Unsupported JSX attribute name')
    if (attrName === 'key') continue
    if (attrName === 'ref') {
      throw new Error('ref on a component is not supported yet')
    }
    if (/^on[A-Z]/.test(attrName)) {
      const expression = getExpression(attr)
      if (expression == null) continue
      if (containsJsx(expression)) {
        throw new Error(`Event handler "${attrName}" cannot be JSX`)
      }
      const binding = splitEventBinding(attrName) ?? { base: attrName, kind: 'bind' }
      const index = ctx.addEvent(expression, scope, true)
      attrs.push(
        `${eventAttrFor(binding.kind, eventNameFor(binding.base), true)}="e${index}"`,
      )
      pushScopeIndexAttrs(attrs, scope)
      continue
    }
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(attrName)) {
      throw new Error(`Component prop "${attrName}" must be a valid identifier`)
    }

    const propName = attrName.toLowerCase()
    const expression = getExpression(attr)
    if (expression == null) continue
    if (propName === 'class' && (t.isObjectExpression(expression) || t.isArrayExpression(expression))) {
      attrs.push(classAttr(expression, ctx, scope))
      continue
    }
    if (propName === 'style' && t.isObjectExpression(expression)) {
      attrs.push(styleAttr(expression, ctx, scope))
      continue
    }
    if (t.isStringLiteral(expression)) {
      attrs.push(`${propName}="${escapeAttr(expression.value)}"`)
      continue
    }
    if (t.isNumericLiteral(expression)) {
      attrs.push(`${propName}="{{${expression.value}}}"`)
      continue
    }
    if (scope) {
      attrs.push(`${propName}="{{${inlineExpression(expression, scope, ctx)}}}"`)
    } else {
      const index = ctx.addBinding(expression)
      attrs.push(`${propName}="{{b${index}}}"`)
    }
  }

  const allAttrs = [...attrs, ...extraAttrs]
  const attrText = allAttrs.length > 0 ? ` ${allAttrs.join(' ')}` : ''
  const children = compileChildren(node.children, ctx, scope)
  if (children === '') return `<${kebabCase(name)}${attrText} />`
  return `<${kebabCase(name)}${attrText}>${children}</${kebabCase(name)}>`
}

function usesSlotElement(node) {
  let found = false
  walkAst(node, (item) => {
    if (
      t.isJSXElement(item) &&
      t.isJSXIdentifier(item.openingElement.name, { name: 'slot' })
    ) {
      found = true
    }
  })
  return found
}

const LOOP_IMPURE_SOLID = new Set([
  'createSignal',
  'createMemo',
  'createEffect',
  'createRenderEffect',
  'createComputed',
  'createDeferred',
  'createReaction',
  'createSelector',
  'createResource',
  'createStore',
  'createMutable',
  'modifyMutable',
  'createRoot',
  'runWithOwner',
  'getOwner',
  'useContext',
  'onMount',
  'onCleanup',
  'onSettled',
  'createContext',
  'batch',
  'flush',
])

/**
 * A component may be inlined inside a loop only when it is a pure projection
 * of its props: no setup statements, no state/lifecycle/context calls. Keeping
 * this check before any import mutation makes the fallback boundary side-effect
 * free.
 */
function isLoopInlineEligible(child) {
  if (child.returnIndex !== 0) return false
  const impureNames = new Set(LOOP_IMPURE_SOLID)
  for (const node of child.ast.program.body) {
    if (!t.isImportDeclaration(node)) continue
    if (!node.source.value.startsWith('solid-js')) continue
    for (const specifier of node.specifiers) {
      if (!t.isImportSpecifier(specifier)) continue
      const imported = specifier.imported.name ?? specifier.imported.value
      if (impureNames.has(imported)) return false
    }
  }
  let impure = false
  walkAst(child.fn, (node) => {
    if (
      t.isCallExpression(node) &&
      t.isIdentifier(node.callee) &&
      impureNames.has(node.callee.name)
    ) {
      impure = true
    }
    if (t.isJSXAttribute(node) && t.isJSXIdentifier(node.name, { name: 'ref' })) {
      impure = true
    }
  })
  return !impure
}

/**
 * Replace `props.name` in an inlined child with the parent expression supplied
 * by the JSX attribute. `props.children` is left in place so the existing
 * inline-children path can substitute the compiled parent WXML.
 */
function substituteInlineProps(node, propsParam, propMap, name) {
  if (!propsParam) return node
  const visit = (value) => {
    if (!value || typeof value !== 'object') return value
    if (t.isMemberExpression(value) || t.isOptionalMemberExpression(value)) {
      if (t.isIdentifier(value.object, { name: propsParam })) {
        if (value.computed || !t.isIdentifier(value.property)) {
          throw new Error(
            `<${name}> uses a computed props access; use props.name instead`,
          )
        }
        const propName = value.property.name
        if (propName === 'children') return value
        const expression = propMap.get(propName)
        return expression ? t.cloneNode(expression, true) : t.identifier('undefined')
      }
    }
    if (t.isIdentifier(value, { name: propsParam })) {
      throw new Error(
        `<${name}> uses the props object as a whole; pass individual props instead`,
      )
    }
    for (const key of t.VISITOR_KEYS[value.type] ?? []) {
      if (skipChildKey(value, key)) continue
      const child = value[key]
      if (Array.isArray(child)) {
        value[key] = child.map((item) => visit(item))
      } else if (child && typeof child === 'object') {
        value[key] = visit(child)
      }
    }
    return value
  }
  return visit(node)
}

function inlineComponentInLoop(
  ctx,
  scope,
  name,
  source,
  child,
  childFile,
  propGetters,
  childrenWxml,
  hasChildren,
) {
  const propMap = new Map(propGetters.map((getter) => [getter.name, getter.expression]))
  const jsx = substituteInlineProps(
    t.cloneNode(child.jsx, true),
    child.propsParam?.name ?? null,
    propMap,
    name,
  )

  const previousChildren = ctx.inlineChildren
  const previousPropsParam = ctx.inlinePropsParam
  const previousUsed = ctx.inlineChildrenUsed
  const previousCount = ctx.inlineChildrenCount
  const previousFile = ctx.currentFile
  ctx.inlineChildren = childrenWxml
  ctx.inlinePropsParam = child.propsParam?.name ?? null
  ctx.inlineChildrenUsed = false
  ctx.inlineChildrenCount = 0
  ctx.currentFile = childFile

  let wxml
  let childrenUsed = false
  let childrenCount = 0
  try {
    wxml = compileNode(jsx, ctx, scope)
    childrenUsed = ctx.inlineChildrenUsed
    childrenCount = ctx.inlineChildrenCount
  } finally {
    ctx.currentFile = previousFile
    ctx.inlineChildren = previousChildren
    ctx.inlinePropsParam = previousPropsParam
    ctx.inlineChildrenUsed = previousUsed
    ctx.inlineChildrenCount = previousCount
  }

  if (hasChildren && !childrenUsed) {
    throw new Error(`<${name}> does not render props.children`)
  }
  if (childrenCount > 1) {
    throw new Error(`<${name}> renders props.children more than once`)
  }

  ctx.inlineComponents.push({ name, source, ...(childFile ? { file: childFile } : {}) })
  return wxml
}

function inlineComponent(node, ctx, scope, name, source) {
  if (!ctx.inline || !ctx.resolveComponent) return null

  const resolved = ctx.resolveComponent(name, source, ctx.currentFile)
  const childSource = typeof resolved === 'string' ? resolved : resolved?.source
  if (!childSource) return null
  const childFile = typeof resolved === 'object' ? resolved.file ?? ctx.currentFile : ctx.currentFile
  const identity = childFile ?? `${ctx.currentFile ?? ''}:${source}`
  if (ctx.inlineStack.includes(identity)) return null
  ctx.inlineStack.push(identity)
  try {
  let child
  try {
    child = parseComponent(childSource)
  } catch {
    return null
  }
  if (usesSlotElement(child.jsx)) return null
  const inLoop = Boolean(scope)
  if (inLoop && !isLoopInlineEligible(child)) return null
  const body = child.ast.program.body
  for (const node of body) {
    if (!t.isImportDeclaration(node)) continue
    if (node.source.value === 'solid-js') {
      for (const specifier of node.specifiers) {
        const local = specifier.local.name
        const existing = ctx.imports.get(local)
        if (existing !== undefined) {
          if (existing !== 'solid-js') return null
          continue
        }
        ctx.imports.set(local, 'solid-js')
        ctx.knownImports.add(local)
        if (t.isImportSpecifier(specifier)) {
          const imported = specifier.imported.name ?? specifier.imported.value
          const alias = imported === local ? '' : ` as ${local}`
          ctx.extraImports.push(`import { ${imported}${alias} } from "solid-js";`)
        } else if (t.isImportDefaultSpecifier(specifier)) {
          ctx.extraImports.push(`import ${local} from "solid-js";`)
        } else {
          ctx.extraImports.push(`import * as ${local} from "solid-js";`)
        }
      }
      continue
    }
    if (!node.source.value.startsWith('.')) return null
    const locals = node.specifiers.map((specifier) => specifier.local.name)
    if (locals.some((local) => !/^[A-Z]/.test(local))) return null
    for (const local of locals) {
      const existing = ctx.imports.get(local)
      if (existing !== undefined && existing !== node.source.value) return null
      ctx.imports.set(local, node.source.value)
      ctx.knownImports.add(local)
    }
  }
  if (
    body.some(
      (item) =>
        t.isVariableDeclaration(item) ||
        t.isFunctionDeclaration(item) ||
        t.isExpressionStatement(item) ||
        t.isExportNamedDeclaration(item) ||
        t.isExportAllDeclaration(item),
    )
  ) {
    return null
  }

  const propGetters = []
  for (const attr of node.openingElement.attributes) {
    if (!t.isJSXAttribute(attr)) return null
    const attrName = t.isJSXIdentifier(attr.name) ? attr.name.name : null
    if (!attrName) return null
    if (attrName === 'key') continue
    if (attrName === 'ref') return null
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(attrName)) return null

    const expression = getExpression(attr)
    if (expression == null) continue
    if (containsJsx(expression)) {
      throw new Error('JSX values are not supported in component props; use children instead')
    }
    propGetters.push({ name: attrName, code: codeOf(expression), expression })
  }

  if (propGetters.length > 0 && !child.propsParam) return null

  const hasChildren = node.children.some((child) => !isWhitespaceText(child))
  if (hasChildren && !child.propsParam) return null
  const childrenWxml = hasChildren ? compileChildren(node.children, ctx, scope) : ''

  if (inLoop) {
    return inlineComponentInLoop(
      ctx,
      scope,
      name,
      source,
      child,
      childFile,
      propGetters,
      childrenWxml,
      hasChildren,
    )
  }

  const blockId = ctx.blocks.length
  ctx.blocks.push({
    setup: child.statements.slice(0, child.returnIndex),
    propsParam: child.propsParam?.name ?? null,
    propGetters,
    provider: ctx.currentProvider,
  })

  const previousBlock = ctx.currentBlock
  const previousChildren = ctx.inlineChildren
  const previousPropsParam = ctx.inlinePropsParam
  const previousUsed = ctx.inlineChildrenUsed
  const previousCount = ctx.inlineChildrenCount
  ctx.currentBlock = blockId
  ctx.inlineChildren = childrenWxml
  ctx.inlinePropsParam = child.propsParam?.name ?? null
  ctx.inlineChildrenUsed = false
  ctx.inlineChildrenCount = 0

  const previousFile = ctx.currentFile
  ctx.currentFile = childFile
  const wxml = compileNode(child.jsx, ctx, null)
  const childrenUsed = ctx.inlineChildrenUsed
  const childrenCount = ctx.inlineChildrenCount

  ctx.currentBlock = previousBlock
  ctx.currentFile = previousFile
  ctx.inlineChildren = previousChildren
  ctx.inlinePropsParam = previousPropsParam
  ctx.inlineChildrenUsed = previousUsed
  ctx.inlineChildrenCount = previousCount

  if (hasChildren && !childrenUsed) {
    throw new Error(`<${name}> does not render props.children`)
  }
  if (childrenCount > 1) {
    throw new Error(`<${name}> renders props.children more than once`)
  }

  ctx.inlineComponents.push({ name, source, ...(childFile ? { file: childFile } : {}) })
  return wxml
  } finally {
    ctx.inlineStack.pop()
  }
}

function compileChildren(children, ctx, scope) {
  return children
    .map((child) => {
      if (isWhitespaceText(child)) return ''
      return compileNode(child, ctx, scope)
    })
    .join('')
}

function isPropsMember(expression, propName, member) {
  return (
    t.isMemberExpression(expression) &&
    t.isIdentifier(expression.object, { name: propName }) &&
    t.isIdentifier(expression.property, { name: member })
  )
}

function compileProvider(node, ctx, scope) {
  if (scope) {
    throw new Error('<Context.Provider> is not supported inside <For>, <Show> or <Match>')
  }
  const tag = node.openingElement.name
  if (t.isJSXMemberExpression(tag) && !t.isJSXIdentifier(tag.object)) {
    throw new Error('Context provider must be a plain identifier object')
  }
  const valueAttr = getAttribute(node, 'value')
  const value = valueAttr ? getExpression(valueAttr) : null
  if (!value) throw new Error('A Context provider requires a value expression')
  if (containsJsx(value)) {
    throw new Error('A Context provider value cannot be JSX')
  }
  const contextName = t.isJSXMemberExpression(tag)
    ? tag.object.name
    : t.isJSXIdentifier(tag)
      ? tag.name
      : null
  if (!contextName) throw new Error('Unsupported context provider form')

  const blockId = ctx.blocks.length
  ctx.blocks.push({
    setup: [],
    propsParam: null,
    propGetters: [],
    provider: ctx.currentProvider,
    providerContext: contextName,
    providerValue: codeOf(value),
  })

  const previous = ctx.currentProvider
  const previousBlock = ctx.currentBlock
  ctx.currentProvider = blockId
  ctx.currentBlock = blockId
  const children = compileChildren(node.children, ctx, scope)
  ctx.currentProvider = previous
  ctx.currentBlock = previousBlock
  return children
}

function compileExpressionChild(expression, ctx, scope) {
  if (
    ctx.inlineChildren != null &&
    ctx.inlinePropsParam &&
    isPropsMember(expression, ctx.inlinePropsParam, 'children')
  ) {
    ctx.inlineChildrenUsed = true
    ctx.inlineChildrenCount += 1
    return ctx.inlineChildren
  }
  if (
    ctx.inlineChildren == null &&
    ctx.rootPropsParam &&
    isPropsMember(expression, ctx.rootPropsParam, 'children')
  ) {
    ctx.usesSlot = true
    return '<slot />'
  }
  if (t.isJSXElement(expression) || t.isJSXFragment(expression)) {
    return compileNode(expression, ctx, scope)
  }
  if (t.isStringLiteral(expression) || t.isNumericLiteral(expression)) {
    return escapeText(String(expression.value))
  }
  if (t.isBooleanLiteral(expression) || t.isNullLiteral(expression)) {
    return ''
  }
  if (t.isLogicalExpression(expression) && expression.operator === '&&') {
    if (t.isJSXElement(expression.right) || t.isJSXFragment(expression.right)) {
      return compileConditional(expression.left, expression.right, null, ctx, scope)
    }
  }
  if (t.isConditionalExpression(expression)) {
    const { consequent, alternate } = expression
    const isJsx = (node) => t.isJSXElement(node) || t.isJSXFragment(node)
    const isEmpty = (node) =>
      node == null ||
      t.isNullLiteral(node) ||
      (t.isBooleanLiteral(node) && node.value === false) ||
      (t.isIdentifier(node, { name: 'undefined' }))
    if (isJsx(consequent) && isJsx(alternate)) {
      return compileConditional(expression.test, consequent, alternate, ctx, scope)
    }
    if (isJsx(consequent) && isEmpty(alternate)) {
      return compileConditional(expression.test, consequent, null, ctx, scope)
    }
    if (isEmpty(consequent) && isJsx(alternate)) {
      return compileConditional(
        t.unaryExpression('!', expression.test, true),
        alternate,
        null,
        ctx,
        scope,
      )
    }
  }
  if (containsJsx(expression)) {
    throw new Error('JSX values are not supported in expressions; use a JSX branch or child')
  }
  if (scope) return `{{${inlineExpression(expression, scope, ctx)}}}`
  const index = ctx.addBinding(expression)
  return `{{b${index}}}`
}

function compileConditional(test, consequent, alternate, ctx, scope) {
  const condition = conditionExpression(test, ctx, scope)
  const guard = scope ? null : codeOf(test)
  const thenNode = ctx.withGuard(guard, () =>
    compileNode(consequent, ctx, scope, [`wx:if="{{${condition}}}"`]),
  )
  if (!alternate) return thenNode
  const elseNode = ctx.withGuard(guard ? `!(${guard})` : null, () =>
    compileNode(alternate, ctx, scope, ['wx:else']),
  )
  return `${thenNode}${elseNode}`
}

function compileCallbackBranch(fn, label, when, keyed, ctx, scope, directive) {
  const firstParam = fn.params[0]
  const destructured = t.isObjectPattern(firstParam) || t.isArrayPattern(firstParam)
  if (destructured && !keyed) {
    throw new Error(`Destructuring a ${label} value requires keyed`)
  }
  const param = destructured
    ? '__glazeValue'
    : t.isIdentifier(firstParam)
      ? firstParam.name
      : 'value'
  const callback = callbackBody(fn, label, [param])
  const aliases = mergeAliases(
    destructured ? patternAliases(firstParam, [param]) : null,
    callback.aliases,
  )
  const body = callback.jsx
  if (!t.isJSXElement(body) && !t.isJSXFragment(body)) {
    throw new Error(`${label} callback must return JSX`)
  }

  const whenCode = scope ? inlineExpression(when, scope, ctx) : codeOf(when)
  const jsWhenCode = scope ? codeOf(rewriteAccessorCalls(when, scope, true)) : codeOf(when)
  const condition = scope ? whenCode : `b${ctx.addBinding(when)}`
  const indexName = scope ? `__glazeIndex${scope.level + 1}` : '__glazeIndex'

  if (!keyed) {
    const itemScope = {
      item: param,
      itemAst: scope
        ? rewriteAccessorCalls(when, scope)
        : t.identifier(condition),
      eventItem: `__glazeValue${scope ? scope.level + 1 : ''}`,
      index: indexName,
      source: `[(${whenCode})]`,
      jsSource: `[(${jsWhenCode})]`,
      direct: jsWhenCode,
      directKey: scope ? null : condition,
      parent: scope,
      level: scope ? scope.level + 1 : 0,
      itemAccessor: true,
      indexAccessor: false,
      aliases,
    }
    const content = ctx.withGuard(scope ? null : codeOf(when), () =>
      compileNode(body, ctx, itemScope),
    )
    return `<block ${directive}="{{${condition}}}">${content}</block>`
  }

  const itemName = destructured
    ? scope
      ? `__glazeValue${scope.level + 1}`
      : '__glazeValue'
    : param
  const itemScope = {
    item: itemName,
    index: indexName,
    source: `[(${whenCode})]`,
    jsSource: `[(${jsWhenCode})]`,
    parent: scope,
    level: scope ? scope.level + 1 : 0,
    itemAccessor: false,
    indexAccessor: false,
    aliases,
  }
  const content = compileNode(body, ctx, itemScope)
  let valuesExpr
  if (scope) {
    ctx.addWxs()
    valuesExpr = `glazeRange.single(${whenCode})`
  } else {
    const values = ctx.addBindingCode(`[(${whenCode})]`)
    valuesExpr = `b${values}`
  }
  const loop = `<block wx:for="{{${valuesExpr}}}" wx:for-item="${itemName}" wx:for-index="${indexName}" wx:key="*this">${content}</block>`
  return `<block ${directive}="{{${condition}}}">${loop}</block>`
}

function compileShowCallback(node, ctx, scope, when, keyed, fn, fallback) {
  const thenNode = compileCallbackBranch(fn, '<Show>', when, keyed, ctx, scope, 'wx:if')
  if (!fallback) return thenNode
  const guard = scope ? null : `!(${codeOf(when)})`
  const elseNode = ctx.withGuard(guard, () =>
    compileNode(fallback, ctx, scope, ['wx:else']),
  )
  return `${thenNode}${elseNode}`
}

function compileShow(node, ctx, scope) {
  const when = getExpression(getAttribute(node, 'when'))
  if (!when) throw new Error('<Show> requires a when expression')
  const keyedAttr = getAttribute(node, 'keyed')
  let keyed = false
  if (keyedAttr) {
    const keyedExpression = getExpression(keyedAttr)
    if (!t.isBooleanLiteral(keyedExpression)) {
      throw new Error('<Show> keyed must be a boolean')
    }
    keyed = keyedExpression.value
  }
  const fallback = getExpression(getAttribute(node, 'fallback'))
  const children = node.children.filter((child) => !isWhitespaceText(child))
  if (children.length === 0) throw new Error('<Show> requires a child')

  if (
    children.length === 1 &&
    t.isJSXExpressionContainer(children[0]) &&
    (t.isArrowFunctionExpression(children[0].expression) ||
      t.isFunctionExpression(children[0].expression))
  ) {
    return compileShowCallback(node, ctx, scope, when, keyed, children[0].expression, fallback)
  }

  const condition = conditionExpression(when, ctx, scope)
  const guard = scope ? null : codeOf(when)
  const thenNode = ctx.withGuard(guard, () =>
    children.length === 1
      ? compileNode(children[0], ctx, scope, [`wx:if="{{${condition}}}"`])
      : `<block wx:if="{{${condition}}}">${compileChildren(children, ctx, scope)}</block>`,
  )

  if (!fallback) return thenNode
  const elseNode = ctx.withGuard(guard ? `!(${guard})` : null, () =>
    compileNode(fallback, ctx, scope, ['wx:else']),
  )
  return `${thenNode}${elseNode}`
}

function compileSwitch(node, ctx, scope) {
  const children = node.children.filter((child) => !isWhitespaceText(child))
  const matches = children.filter(
    (child) => t.isJSXElement(child) && t.isJSXIdentifier(child.openingElement.name, { name: 'Match' }),
  )
  if (matches.length !== children.length) {
    throw new Error('<Switch> accepts only <Match> children and a fallback prop')
  }
  if (matches.length === 0) {
    const emptyFallback = getAttribute(node, 'fallback')
    if (!emptyFallback) throw new Error('<Switch> requires a <Match> or fallback')
    const expression = getExpression(emptyFallback)
    if (!expression || (!t.isJSXElement(expression) && !t.isJSXFragment(expression))) {
      throw new Error('<Switch> fallback must be JSX')
    }
    return compileNode(expression, ctx, scope)
  }

  const whenCodes = matches.map((match) => {
    const when = getExpression(getAttribute(match, 'when'))
    if (!when) throw new Error('<Match> requires a when expression')
    return codeOf(when)
  })
  let output = ''
  matches.forEach((match, index) => {
    const when = getExpression(getAttribute(match, 'when'))
    if (!when) throw new Error('<Match> requires a when expression')
    const keyedAttr = getAttribute(match, 'keyed')
    let keyed = false
    if (keyedAttr) {
      const keyedExpression = getExpression(keyedAttr)
      if (!t.isBooleanLiteral(keyedExpression)) {
        throw new Error('<Match> keyed must be a boolean')
      }
      keyed = keyedExpression.value
    }
    const body = match.children.filter((child) => !isWhitespaceText(child))
    if (body.length === 0) throw new Error('<Match> requires a child')

    const callback =
      body.length === 1 &&
      t.isJSXExpressionContainer(body[0]) &&
      (t.isArrowFunctionExpression(body[0].expression) ||
        t.isFunctionExpression(body[0].expression))
        ? body[0].expression
        : null
    if (callback) {
      const directive = index === 0 ? 'wx:if' : 'wx:elif'
      output += compileCallbackBranch(callback, '<Match>', when, keyed, ctx, scope, directive)
      return
    }

    const condition = conditionExpression(when, ctx, scope)
    const directive = index === 0 ? `wx:if="{{${condition}}}"` : `wx:elif="{{${condition}}}"`
    const guard = scope
      ? null
      : [whenCodes[index], ...whenCodes.slice(0, index).map((item) => `!(${item})`)]
          .map((item) => `(${item})`)
          .join(' && ')
    output += ctx.withGuard(guard, () =>
      body.length === 1
        ? compileNode(body[0], ctx, scope, [directive])
        : `<block ${directive}>${compileChildren(body, ctx, scope)}</block>`,
    )
  })

  const fallback = getAttribute(node, 'fallback')
  if (fallback) {
    const expression = getExpression(fallback)
    if (!expression || (!t.isJSXElement(expression) && !t.isJSXFragment(expression))) {
      throw new Error('<Switch> fallback must be JSX')
    }
    const guard = scope
      ? null
      : whenCodes.map((item) => `!(${item})`).join(' && ')
    output += ctx.withGuard(guard, () =>
      compileNode(expression, ctx, scope, ['wx:else']),
    )
  }

  return output
}

function patternAliases(pattern, base, aliases = {}) {
  if (t.isObjectPattern(pattern)) {
    for (const property of pattern.properties) {
      if (!t.isObjectProperty(property)) {
        throw new Error('Rest elements in destructured For/Show items are not supported')
      }
      const key = t.isIdentifier(property.key)
        ? property.key.name
        : t.isStringLiteral(property.key)
          ? property.key.value
          : null
      if (!key) throw new Error('Destructured item keys must be static')
      const path = [...base, key]
      assignAlias(property.value, path, aliases)
    }
    return aliases
  }
  if (t.isArrayPattern(pattern)) {
    pattern.elements.forEach((element, index) => {
      if (element) assignAlias(element, [...base, index], aliases)
    })
    return aliases
  }
  throw new Error('Unsupported destructuring pattern')
}

function assignAlias(node, path, aliases) {
  if (t.isIdentifier(node)) {
    aliases[node.name] = path
    return
  }
  if (t.isAssignmentPattern(node)) {
    throw new Error('Destructured defaults are not supported in For/Show callbacks')
  }
  if (t.isObjectPattern(node) || t.isArrayPattern(node)) {
    patternAliases(node, path, aliases)
    return
  }
  throw new Error('Unsupported destructuring pattern')
}

function aliasValue(name, scope) {
  for (let cursor = scope; cursor; cursor = cursor.parent) {
    if (cursor.aliases?.[name] !== undefined) return cursor.aliases[name]
  }
  return null
}

function buildMember(path) {
  return path.slice(1).reduce(
    (node, segment) =>
      t.memberExpression(
        node,
        typeof segment === 'number' ? t.numericLiteral(segment) : t.identifier(segment),
        typeof segment === 'number',
      ),
    t.identifier(path[0]),
  )
}

function callbackBody(fn, label, reserved = []) {
  const aliases = {}
  if (!t.isBlockStatement(fn.body)) return { jsx: fn.body, aliases }

  let returned = false
  let jsx = null
  for (const statement of fn.body.body) {
    if (t.isVariableDeclaration(statement)) {
      if (statement.kind !== 'const') {
        throw new Error(`${label} callback local variables must use const`)
      }
      if (returned) {
        throw new Error(`${label} callback statements after return are not supported`)
      }
      for (const declarator of statement.declarations) {
        if (!t.isIdentifier(declarator.id) || !declarator.init) {
          throw new Error(`${label} callback local declarations must be simple identifiers with a value`)
        }
        if (reserved.includes(declarator.id.name)) {
          throw new Error(`${label} callback local name "${declarator.id.name}" conflicts with the loop variable`)
        }
        aliases[declarator.id.name] = declarator.init
      }
      continue
    }
    if (t.isReturnStatement(statement)) {
      if (returned) throw new Error(`${label} callback must return exactly one JSX value`)
      returned = true
      jsx = statement.argument
      continue
    }
    throw new Error(`${label} callback statements are not supported yet`)
  }

  if (!jsx) throw new Error(`${label} callback must return JSX`)
  return { jsx, aliases }
}

function mergeAliases(patternAliasesValue, locals) {
  const aliases = { ...(patternAliasesValue ?? {}), ...(locals ?? {}) }
  return Object.keys(aliases).length > 0 ? aliases : null
}

function inferKeyedField(fn) {
  const param = t.isIdentifier(fn.params[0]) ? fn.params[0].name : null
  if (!param) return null
  const body = t.isBlockStatement(fn.body)
    ? (() => {
        const ret = fn.body.body.find((item) => t.isReturnStatement(item))
        return ret?.argument ?? null
      })()
    : fn.body
  if (!body || !t.isMemberExpression(body)) return null
  if (!t.isIdentifier(body.object, { name: param })) return null
  if (body.computed) {
    return t.isStringLiteral(body.property) ? body.property.value : null
  }
  return t.isIdentifier(body.property) ? body.property.name : null
}

function compileFor(node, ctx, scope) {
  const each = getExpression(getAttribute(node, 'each'))
  if (!each) throw new Error('<For> requires an each expression')

  const keyAttr = getAttribute(node, 'key')
  const keyedAttr = getAttribute(node, 'keyed')
  let keyed = true
  let keyedField = null
  if (keyedAttr) {
    const keyedExpression = getExpression(keyedAttr)
    if (t.isBooleanLiteral(keyedExpression)) {
      keyed = keyedExpression.value
    } else if (
      t.isArrowFunctionExpression(keyedExpression) ||
      t.isFunctionExpression(keyedExpression)
    ) {
      keyed = 'fn'
      keyedField = inferKeyedField(keyedExpression)
      if (!keyedField) {
        throw new Error('<For> keyed function must return a single field, e.g. (item) => item.id')
      }
    } else {
      throw new Error('<For> keyed must be a boolean or a function')
    }
  }

  let key = null
  if (keyAttr) {
    if (keyAttr.value && t.isStringLiteral(keyAttr.value)) key = keyAttr.value.value
    else throw new Error('<For> key must be a string literal in the first compiler wave')
  } else if (keyed === false) {
    key = null
  } else if (keyedField) {
    key = keyedField
  }

  const eachCode = scope ? inlineExpression(each, scope, ctx) : codeOf(each)
  const eachExpr = scope ? eachCode : `b${ctx.addBinding(each, key)}`
  const jsEachCode = scope ? codeOf(rewriteAccessorCalls(each, scope, true)) : codeOf(each)

  const childNodes = node.children.filter((item) => !isWhitespaceText(item))
  if (childNodes.length !== 1 || !t.isJSXExpressionContainer(childNodes[0])) {
    throw new Error('<For> requires exactly one arrow-function child')
  }
  const child = childNodes[0]
  const fn = child.expression
  if (!t.isArrowFunctionExpression(fn) && !t.isFunctionExpression(fn)) {
    throw new Error('<For> child must be an arrow function')
  }
  const itemAccessor = keyed === false || keyed === 'fn'
  const firstParam = fn.params[0]
  const destructured = t.isObjectPattern(firstParam) || t.isArrayPattern(firstParam)
  if (destructured && itemAccessor) {
    throw new Error('Destructuring a <For> item requires keyed=true')
  }
  const itemName = destructured
    ? scope
      ? `__glazeItem${scope.level + 1}`
      : '__glazeItem'
    : t.isIdentifier(firstParam)
      ? firstParam.name
      : 'item'
  const indexName = t.isIdentifier(fn.params[1])
    ? fn.params[1].name
    : scope
      ? `__glazeIndex${scope.level + 1}`
      : '__glazeIndex'
  const callback = callbackBody(fn, '<For>', [itemName, indexName])
  const aliases = mergeAliases(
    destructured ? patternAliases(firstParam, [itemName]) : null,
    callback.aliases,
  )
  const body = callback.jsx

  if (!t.isJSXElement(body) && !t.isJSXFragment(body)) {
    throw new Error('<For> callback must return JSX')
  }

  for (let cursor = scope; cursor; cursor = cursor.parent) {
    if (cursor.item === itemName || cursor.index === indexName) {
      throw new Error(
        `Nested <For> must use distinct item and index names (${itemName}, ${indexName})`,
      )
    }
  }

  const itemScope = {
    item: itemName,
    index: indexName,
    source: eachCode,
    jsSource: jsEachCode,
    parent: scope,
    level: scope ? scope.level + 1 : 0,
    itemAccessor,
    indexAccessor: keyed !== false,
    aliases,
  }
  const children = compileNode(body, ctx, itemScope)
  const keyAttrCode = key ? ` wx:key="${key}"` : ''
  const loop = `<block wx:for="{{${eachExpr}}}" wx:for-item="${itemName}" wx:for-index="${indexName}"${keyAttrCode}>${children}</block>`

  const fallback = getAttribute(node, 'fallback')
  if (!fallback) return loop
  const fallbackExpression = getExpression(fallback)
  if (
    !fallbackExpression ||
    (!t.isJSXElement(fallbackExpression) && !t.isJSXFragment(fallbackExpression))
  ) {
    throw new Error('<For> fallback must be JSX')
  }
  const condition = scope
    ? `(${eachCode} || []).length > 0`
    : `b${ctx.addBindingCode(`(${eachCode} || []).length > 0`)}`
  const fallbackGuard = scope ? null : `(${codeOf(each)} || []).length === 0`
  return `<block wx:if="{{${condition}}}">${loop}</block>${ctx.withGuard(
    fallbackGuard,
    () => compileNode(fallbackExpression, ctx, scope, ['wx:else']),
  )}`
}

function compileRepeatInScope(node, ctx, scope) {
  const count = getExpression(getAttribute(node, 'count'))
  if (!count) throw new Error('<Repeat> requires a count expression')
  const from = getExpression(getAttribute(node, 'from'))
  const countCode = inlineExpression(count, scope, ctx)
  const fromCode = from ? inlineExpression(from, scope, ctx) : '0'
  const childNodes = node.children.filter((item) => !isWhitespaceText(item))
  if (childNodes.length !== 1 || !t.isJSXExpressionContainer(childNodes[0])) {
    throw new Error('<Repeat> requires exactly one arrow-function child')
  }
  const child = childNodes[0]
  const fn = child.expression
  if (!t.isArrowFunctionExpression(fn) && !t.isFunctionExpression(fn)) {
    throw new Error('<Repeat> child must be an arrow function')
  }
  const param = t.isIdentifier(fn.params[0]) ? fn.params[0].name : 'index'
  const itemName = `__glazeRepeat${scope.level + 1}`
  const indexName = `__glazeIndex${scope.level + 1}`
  const aliases = { [param]: [itemName] }
  const body = t.isBlockStatement(fn.body)
    ? (() => {
        const ret = fn.body.body.find((item) => t.isReturnStatement(item))
        if (!ret) throw new Error('<Repeat> callback must return JSX')
        return ret.argument
      })()
    : fn.body
  if (!t.isJSXElement(body) && !t.isJSXFragment(body)) {
    throw new Error('<Repeat> callback must return JSX')
  }

  ctx.addWxs()
  const itemScope = {
    item: itemName,
    index: indexName,
    source: null,
    jsSource: null,
    offset: fromCode,
    parent: scope,
    level: scope.level + 1,
    itemAccessor: false,
    indexAccessor: false,
    isIndexRepeat: true,
    aliases,
  }
  const children = compileNode(body, ctx, itemScope)
  const loop = `<block wx:for="{{glazeRange.range(${countCode}, ${fromCode})}}" wx:for-item="${itemName}" wx:for-index="${indexName}" wx:key="*this">${children}</block>`
  const fallback = getAttribute(node, 'fallback')
  if (!fallback) return loop
  const fallbackExpression = getExpression(fallback)
  if (
    !fallbackExpression ||
    (!t.isJSXElement(fallbackExpression) && !t.isJSXFragment(fallbackExpression))
  ) {
    throw new Error('<Repeat> fallback must be JSX')
  }
  return `<block wx:if="{{${countCode} > 0}}">${loop}</block>${ctx.withGuard(
    scope ? null : `!(${codeOf(count)} > 0)`,
    () => compileNode(fallbackExpression, ctx, scope, ['wx:else']),
  )}`
}

function compileRepeat(node, ctx, scope) {
  if (scope) return compileRepeatInScope(node, ctx, scope)
  const count = getExpression(getAttribute(node, 'count'))
  if (!count) throw new Error('<Repeat> requires a count expression')
  const from = getExpression(getAttribute(node, 'from'))
  const fromCode = from ? codeOf(from) : '0'

  const childNodes = node.children.filter((item) => !isWhitespaceText(item))
  if (childNodes.length !== 1 || !t.isJSXExpressionContainer(childNodes[0])) {
    throw new Error('<Repeat> requires exactly one arrow-function child')
  }
  const child = childNodes[0]
  const fn = child.expression
  if (!t.isArrowFunctionExpression(fn) && !t.isFunctionExpression(fn)) {
    throw new Error('<Repeat> child must be an arrow function')
  }
  const itemName = t.isIdentifier(fn.params[0]) ? fn.params[0].name : 'index'
  const body = t.isBlockStatement(fn.body)
    ? (() => {
        const ret = fn.body.body.find((item) => t.isReturnStatement(item))
        if (!ret) throw new Error('<Repeat> callback must return JSX')
        return ret.argument
      })()
    : fn.body
  if (!t.isJSXElement(body) && !t.isJSXFragment(body)) {
    throw new Error('<Repeat> callback must return JSX')
  }

  const binding = ctx.addBindingCode(
    `Array.from({ length: (${codeOf(count)}) }, (_, index) => index + (${fromCode}))`,
  )
  const itemScope = {
    item: itemName,
    index: '__glazeIndex',
    source: `b${binding}`,
    jsSource: `Array.from({ length: (${codeOf(count)}) }, (_, index) => index + (${fromCode}))`,
    parent: null,
    level: 0,
  }
  const children = compileNode(body, ctx, itemScope)
  const loop = `<block wx:for="{{b${binding}}}" wx:for-item="${itemName}" wx:for-index="__glazeIndex" wx:key="*this">${children}</block>`

  const fallback = getAttribute(node, 'fallback')
  if (!fallback) return loop
  const fallbackExpression = getExpression(fallback)
  if (
    !fallbackExpression ||
    (!t.isJSXElement(fallbackExpression) && !t.isJSXFragment(fallbackExpression))
  ) {
    throw new Error('<Repeat> fallback must be JSX')
  }
  return `<block wx:if="{{b${binding}.length > 0}}">${loop}</block>${ctx.withGuard(
    `!(${codeOf(count)} > 0)`,
    () => compileNode(fallbackExpression, ctx, scope, ['wx:else']),
  )}`
}

function conditionExpression(expression, ctx, scope) {
  if (scope) return inlineExpression(expression, scope, ctx)
  return `b${ctx.addBinding(expression)}`
}

function classAttr(expression, ctx, scope) {
  if (!scope) {
    ctx.addHelper('className')
    const index = ctx.addBindingCode(`className(${codeOf(expression)})`)
    return `class="{{b${index}}}"`
  }
  return `class="${classInline(expression, scope, ctx)}"`
}

function styleAttr(expression, ctx, scope) {
  if (!scope) {
    if (isStaticStyle(expression)) {
      return `style="${escapeAttr(staticStyle(expression))}"`
    }
    ctx.addHelper('styleName')
    const index = ctx.addBindingCode(`styleName(${codeOf(expression)})`)
    return `style="{{b${index}}}"`
  }
  return `style="${styleInline(expression, scope, ctx)}"`
}

function classInline(expression, scope, ctx) {
  if (t.isStringLiteral(expression) || t.isNumericLiteral(expression)) {
    return escapeAttr(String(expression.value))
  }
  if (t.isArrayExpression(expression)) {
    return expression.elements
      .map((item) => classInlineItem(item, scope, ctx))
      .filter(Boolean)
      .join(' ')
  }
  if (t.isObjectExpression(expression)) {
    return expression.properties
      .map((property) => {
        if (!t.isObjectProperty(property)) return ''
        const key = t.isIdentifier(property.key)
          ? property.key.name
          : t.isStringLiteral(property.key)
            ? property.key.value
            : null
        if (!key) throw new Error('Dynamic class keys are not supported')
        const value = property.value
        if (t.isBooleanLiteral(value)) return value.value ? key : ''
        if (t.isNullLiteral(value)) return ''
        return `{{${inlineExpression(value, scope, ctx)} ? '${escapeAttr(key)}' : ''}}`
      })
      .filter(Boolean)
      .join(' ')
  }
  return `{{${inlineExpression(expression, scope, ctx)} || ''}}`
}

function classInlineItem(expression, scope, ctx) {
  if (!expression) return ''
  if (t.isStringLiteral(expression) || t.isNumericLiteral(expression)) {
    return escapeAttr(String(expression.value))
  }
  if (t.isArrayExpression(expression)) return classInline(expression, scope, ctx)
  if (t.isObjectExpression(expression)) return classInline(expression, scope, ctx)
  if (t.isLogicalExpression(expression) && expression.operator === '&&') {
    if (t.isStringLiteral(expression.right)) {
      return `{{${inlineExpression(expression.left, scope, ctx)} ? '${escapeAttr(expression.right.value)}' : ''}}`
    }
  }
  if (t.isConditionalExpression(expression)) {
    const consequent = t.isStringLiteral(expression.consequent)
      ? `'${escapeAttr(expression.consequent.value)}'`
      : `(${inlineExpression(expression.consequent, scope, ctx)})`
    const alternate = t.isStringLiteral(expression.alternate)
      ? `'${escapeAttr(expression.alternate.value)}'`
      : `(${inlineExpression(expression.alternate, scope, ctx)})`
    return `{{${inlineExpression(expression.test, scope, ctx)} ? ${consequent} : ${alternate}}}`
  }
  return `{{${inlineExpression(expression, scope, ctx)} || ''}}`
}

function styleInline(expression, scope, ctx) {
  return expression.properties
    .map((property) => {
      if (!t.isObjectProperty(property)) {
        throw new Error('Style spread is not supported')
      }
      const key = t.isIdentifier(property.key)
        ? property.key.name
        : t.isStringLiteral(property.key)
          ? property.key.value
          : null
      if (!key) throw new Error('Dynamic style keys are not supported')
      const name = key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)
      const value = property.value
      if (t.isStringLiteral(value) || t.isNumericLiteral(value)) {
        return `${name}:${value.value}`
      }
      if (t.isBooleanLiteral(value) || t.isNullLiteral(value)) {
        return value.value ? `${name}:true` : ''
      }
      return `${name}:{{${inlineExpression(value, scope, ctx)}}}`
    })
    .filter(Boolean)
    .join(';')
}

function isStaticStyle(node) {
  return node.properties.every(
    (property) =>
      t.isObjectProperty(property) &&
      (t.isStringLiteral(property.value) || t.isNumericLiteral(property.value)),
  )
}

function staticStyle(node) {
  return node.properties
    .map((property) => {
      if (!t.isObjectProperty(property)) throw new Error('Unsupported style spread')
      const key = t.isIdentifier(property.key)
        ? property.key.name
        : t.isStringLiteral(property.key)
          ? property.key.value
          : null
      if (!key) throw new Error('Unsupported style key')
      const cssName = key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)
      const value = property.value
      if (t.isStringLiteral(value) || t.isNumericLiteral(value)) {
        return `${cssName}: ${value.value}`
      }
      throw new Error('Dynamic style values are not supported in the first compiler wave')
    })
    .join('; ')
}

function inlineExpression(expression, scope, ctx) {
  if (
    t.isStringLiteral(expression) ||
    t.isNumericLiteral(expression) ||
    t.isBooleanLiteral(expression) ||
    t.isNullLiteral(expression)
  ) {
    return codeOf(expression)
  }
  const rewritten = rewriteAccessorCalls(expression, scope)
  if (!dependsOnLoop(rewritten, scope)) {
    return `b${ctx.addBinding(rewritten)}`
  }
  const hoisted = hoistLoopExpression(rewritten, scope, ctx)
  validateInline(hoisted, scope)
  return codeOf(hoisted)
}

function isLoopName(name, scope) {
  for (let cursor = scope; cursor; cursor = cursor.parent) {
    if (cursor.item === name || cursor.index === name || cursor.directKey === name) return true
    if (cursor.aliases && Object.prototype.hasOwnProperty.call(cursor.aliases, name)) return true
  }
  return false
}

function dependsOnLoop(expression, scope) {
  let found = false
  const visit = (node, parent) => {
    if (found || !node || typeof node !== 'object') return
    if (t.isIdentifier(node) && !isStaticPropertyKey(node, parent)) {
      if (isLoopName(node.name, scope)) found = true
      return
    }
    for (const key of t.VISITOR_KEYS[node.type] ?? []) {
      const value = node[key]
      if (Array.isArray(value)) {
        for (const child of value) visit(child, node)
      } else {
        visit(value, node)
      }
      if (found) return
    }
  }
  visit(expression, null)
  return found
}

function isHoistable(node) {
  if (!node || typeof node !== 'object') return false
  if (t.isStringLiteral(node) || t.isNumericLiteral(node) || t.isBooleanLiteral(node)) return false
  if (t.isNullLiteral(node) || t.isBigIntLiteral(node) || t.isRegExpLiteral(node)) return false
  return !(
    t.isArrowFunctionExpression(node) ||
    t.isFunctionExpression(node) ||
    t.isClassExpression(node) ||
    t.isJSXElement(node) ||
    t.isJSXFragment(node) ||
    t.isThisExpression(node) ||
    t.isSuper(node)
  )
}

function skipChildKey(node, key) {
  if (t.isMemberExpression(node) && key === 'property' && !node.computed) return true
  if (t.isObjectProperty(node) && key === 'key' && !node.computed) return true
  return false
}

function hoistLoopExpression(expression, scope, ctx) {
  const visit = (node, isRoot) => {
    if (!node || typeof node !== 'object') return node
    if (!isRoot && isHoistable(node) && !dependsOnLoop(node, scope)) {
      return t.identifier(`b${ctx.addBinding(node)}`)
    }
    if ((t.isCallExpression(node) || t.isOptionalCallExpression(node)) && dependsOnLoop(node, scope)) {
      throw new Error(
        'Function calls inside <For> or <Show> must not depend on loop values; compute the value before the loop or move the call out of the template',
      )
    }
    if (t.isIdentifier(node)) return node
    for (const key of t.VISITOR_KEYS[node.type] ?? []) {
      if (skipChildKey(node, key)) continue
      const value = node[key]
      if (Array.isArray(value)) {
        node[key] = value.map((child) => visit(child, false))
      } else if (value && typeof value === 'object') {
        node[key] = visit(value, false)
      }
    }
    return node
  }
  return visit(expression, true)
}

function accessorTarget(name, scope) {
  for (let cursor = scope; cursor; cursor = cursor.parent) {
    if (cursor.item === name && cursor.itemAccessor) return { kind: 'item', scope: cursor }
    if (cursor.index === name && cursor.indexAccessor) return { kind: 'index', scope: cursor }
  }
  return null
}

function accessorKind(name, scope) {
  return accessorTarget(name, scope)?.kind ?? null
}

function isStaticPropertyKey(node, parent) {
  if (!parent) return false
  if (t.isMemberExpression(parent) && parent.property === node && !parent.computed) return true
  if (t.isObjectProperty(parent) && parent.key === node && !parent.computed) return true
  return false
}

function rewriteAccessorCalls(expression, scope, js = false) {
  if (!scope) return expression
  const cloned = t.cloneNode(expression, true)
  const visit = (node, parent = null) => {
    if (!node || typeof node !== 'object') return node
    if (
      t.isIdentifier(node) &&
      (parent ? t.isReferenced(node, parent) : true) &&
      !isStaticPropertyKey(node, parent)
    ) {
      const alias = aliasValue(node.name, scope)
      if (Array.isArray(alias)) return buildMember(alias)
      if (alias && t.isExpression(alias)) return visit(t.cloneNode(alias, true), null)
    }
    if (
      t.isCallExpression(node) &&
      t.isIdentifier(node.callee) &&
      accessorKind(node.callee.name, scope)
    ) {
      if (node.arguments.length > 0) {
        throw new Error(`Solid accessor ${node.callee.name}() does not take arguments`)
      }
      const found = accessorTarget(node.callee.name, scope)
      const owner = found?.scope ?? scope
      const target =
        found?.kind === 'index'
          ? owner.index
          : js
            ? (owner.eventItem ?? owner.item)
            : null
      if (target) return t.identifier(target)
      if (owner.itemAst) return t.cloneNode(owner.itemAst, true)
      return t.identifier(node.callee.name)
    }
    for (const key of t.VISITOR_KEYS[node.type] ?? []) {
      const value = node[key]
      if (Array.isArray(value)) node[key] = value.map((child) => visit(child, node))
      else if (value && typeof value === 'object') node[key] = visit(value, node)
    }
    return node
  }
  return visit(cloned)
}

function validateInline(expression, scope) {
  const allowedIdentifiers = new Set()
  let cursor = scope
  while (cursor) {
    allowedIdentifiers.add(cursor.item)
    allowedIdentifiers.add(cursor.index)
    cursor = cursor.parent
  }

  const visit = (node) => {
    if (node == null) return
    if (t.isIdentifier(node)) {
      if (allowedIdentifiers.has(node.name) || /^b\d+$/.test(node.name)) return
      throw new Error(
        `Cannot use "${node.name}" inside <For>; only item/index fields are supported in the first compiler wave`,
      )
    }
    if (t.isMemberExpression(node)) {
      visit(node.object)
      if (node.computed) visit(node.property)
      return
    }
    if (
      t.isStringLiteral(node) ||
      t.isNumericLiteral(node) ||
      t.isBooleanLiteral(node) ||
      t.isNullLiteral(node)
    ) {
      return
    }
    if (
      t.isBinaryExpression(node) ||
      t.isLogicalExpression(node) ||
      t.isUnaryExpression(node)
    ) {
      visit(node.left ?? node.argument)
      visit(node.right)
      return
    }
    if (t.isConditionalExpression(node)) {
      visit(node.test)
      visit(node.consequent)
      visit(node.alternate)
      return
    }
    throw new Error(
      `Unsupported expression inside <For>: ${node.type}. Move it out of the loop or use a field on the item.`,
    )
  }

  visit(expression)
}
