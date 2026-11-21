import { parse } from '@babel/parser'
import generatorModule from '@babel/generator'
import * as t from '@babel/types'

const generate = generatorModule.default ?? generatorModule

const EVENT_MAP = {
  onClick: 'bindtap',
  onTap: 'bindtap',
  onInput: 'bindinput',
  onChange: 'bindchange',
  onConfirm: 'bindconfirm',
  onFocus: 'bindfocus',
  onBlur: 'bindblur',
  onSubmit: 'bindsubmit',
  onReset: 'bindreset',
  onLongPress: 'bindlongpress',
  onLongTap: 'bindlongtap',
  onTouchStart: 'bindtouchstart',
  onTouchMove: 'bindtouchmove',
  onTouchEnd: 'bindtouchend',
  onTouchCancel: 'bindtouchcancel',
}

const escapeText = (value) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const escapeAttr = (value) => escapeText(value).replace(/"/g, '&quot;')

const normalizeText = (value) => value.replace(/\s+/g, ' ').trim()

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

const kebabCase = (name) =>
  name
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()

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

  const ctx = {
    bindings: [],
    events: [],
    components: [],
    inlineComponents: [],
    imports: collectImports(ast),
    knownImports: new Set(
      ast.program.body
        .filter((node) => t.isImportDeclaration(node))
        .flatMap((node) => node.specifiers.map((specifier) => specifier.local.name)),
    ),
    extraImports: [],
    blocks: [
      {
        setup: statements.slice(0, returnIndex),
        propsParam: null,
        propGetters: [],
      },
    ],
    currentBlock: 0,
    inline: options.inline ?? false,
    resolveComponent: options.resolveComponent ?? null,
    addBinding(expression, listKey = null) {
      const index = this.bindings.length
      this.bindings.push({ code: codeOf(expression), listKey, block: this.currentBlock })
      return index
    },
    addEvent(expression, scope = null) {
      const index = this.events.length
      this.events.push({ code: codeOf(expression), scope, block: this.currentBlock })
      return index
    },
    addComponent(name, source) {
      if (!this.components.some((item) => item.name === name)) {
        this.components.push({ name, source })
      }
    },
  }

  const wxml = compileNode(jsx, ctx, null)
  const js = emitModule(ast, statements.slice(0, returnIndex), ctx, {
    propsParam: propsParam?.name ?? null,
    props,
  })

  return {
    wxml,
    js,
    props,
    components: ctx.components,
    inlineComponents: ctx.inlineComponents,
    bindingCount: ctx.bindings.length,
    handlerCount: ctx.events.length,
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
        (item) => t.isFunctionDeclaration(item) && item.id?.name === declaration.name,
      )
      if (match) return match
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
  walkAst(body, (node) => {
    if (!t.isMemberExpression(node) && !t.isOptionalMemberExpression(node)) return
    if (!t.isIdentifier(node.object, { name: paramName })) return
    if (!t.isIdentifier(node.property)) {
      throw new Error(`Computed prop access is not supported; use props.name instead`)
    }
    props.add(node.property.name)
  })
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
    .filter(
      (node) =>
        !t.isImportDeclaration(node) &&
        !t.isExportDefaultDeclaration(node) &&
        !t.isExportNamedDeclaration(node),
    )
    .map((node) => codeOf(node))
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
    options.props.length > 0
      ? `  properties: ${JSON.stringify(options.props)},\n`
      : ''
  const setupParams = options.propsParam ? `, ${options.propsParam}` : ''

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
        if (!event.scope) return `    ctx.event(${index}, ${event.code});`
        const { item, index: indexName, source } = event.scope
        return `    ctx.event(${index}, (event) => {
      const ${indexName} = Number(event.currentTarget.dataset.glazeIndex);
      const ${item} = (${source})[${indexName}];
      return (${event.code})(event);
    });`
      })
      .filter(Boolean)
      .join('\n')

  const indent = (code, spaces) =>
    code
      .split('\n')
      .map((line) => (line ? `${' '.repeat(spaces)}${line}` : line))
      .join('\n')

  const setup = ctx.blocks
    .map((block, blockId) => {
      const body = [
        block.setup.map((node) => codeOf(node)).join('\n'),
        renderBindings(blockId),
        renderEvents(blockId),
      ]
        .filter(Boolean)
        .join('\n')

      if (blockId === 0) return body

      const props = block.propsParam
        ? `    const ${block.propsParam} = {\n${block.propGetters
            .map((getter) => `      get ${getter.name}() { return (${getter.code}); },`)
            .join('\n')}\n    };\n`
        : ''
      return `  {\n${props}${indent(body, 4)}\n  }`
    })
    .join('\n')

  return `${imports}
import { defineGlazeComponent } from "@glaze/runtime/mini";

${moduleStatements}

export default defineGlazeComponent({
${properties}  data: ${data},
  listBindings: ${JSON.stringify(listBindings)},
  handlerCount: ${ctx.events.length},
  setup(ctx${setupParams}) {
${setup}
  },
});
`
}

function compileNode(node, ctx, scope, extraAttrs = []) {
  if (t.isJSXElement(node)) return compileElement(node, ctx, scope, extraAttrs)
  if (t.isJSXFragment(node)) {
    const children = compileChildren(node.children, ctx, scope)
    const attrs = extraAttrs.length > 0 ? ` ${extraAttrs.join(' ')}` : ''
    return `<block${attrs}>${children}</block>`
  }
  if (t.isJSXText(node)) return escapeText(normalizeText(node.value))
  if (t.isJSXExpressionContainer(node)) {
    return compileExpressionChild(node.expression, ctx, scope)
  }
  throw new Error('Unsupported JSX child')
}

function compileElement(node, ctx, scope, extraAttrs = []) {
  const name = tagName(node.openingElement.name)
  if (name === 'Show') return compileShow(node, ctx, scope)
  if (name === 'For') return compileFor(node, ctx, scope)
  if (/^[A-Z]/.test(name)) {
    return compileComponentElement(node, ctx, scope, extraAttrs)
  }

  const attrs = []
  for (const attr of node.openingElement.attributes) {
    if (!t.isJSXAttribute(attr)) {
      throw new Error('JSX spread attributes are not supported')
    }
    const attrName = t.isJSXIdentifier(attr.name) ? attr.name.name : null
    if (!attrName) throw new Error('Unsupported JSX attribute name')
    if (attrName === 'key') continue
    if (attrName === 'ref') {
      throw new Error('ref is not supported in the first compiler wave')
    }

    const expression = getExpression(attr)
    if (expression == null) continue

    if (EVENT_MAP[attrName] || /^on[A-Z]/.test(attrName)) {
      if (scope?.parent) {
        throw new Error('Events inside nested <For> are not supported yet')
      }
      const eventName = EVENT_MAP[attrName] ?? `bind${attrName.slice(2).toLowerCase()}`
      const index = ctx.addEvent(expression, scope)
      attrs.push(`${eventName}="e${index}"`)
      if (scope && !attrs.includes(`data-glaze-index="{{${scope.index}}}"`)) {
        attrs.push(`data-glaze-index="{{${scope.index}}}"`)
      }
      continue
    }

    const propName = attrName === 'className' ? 'class' : attrName
    if (t.isStringLiteral(expression) || t.isNumericLiteral(expression)) {
      attrs.push(`${propName}="${escapeAttr(String(expression.value))}"`)
      continue
    }
    if (propName === 'style' && t.isObjectExpression(expression)) {
      attrs.push(`${propName}="${escapeAttr(staticStyle(expression))}"`)
      continue
    }
    if (propName === 'class' && t.isObjectExpression(expression)) {
      throw new Error('class objects are not supported; use a string or a ternary')
    }

    if (scope) {
      attrs.push(`${propName}="{{${inlineExpression(expression, scope)}}}"`)
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
  if (node.children.some((child) => !isWhitespaceText(child))) {
    throw new Error(`Component <${name}> does not support children or slots yet`)
  }

  const inlined = inlineComponent(node, ctx, scope, name, source)
  if (inlined != null) return inlined

  ctx.addComponent(name, source)

  const attrs = []
  for (const attr of node.openingElement.attributes) {
    if (!t.isJSXAttribute(attr)) {
      throw new Error('JSX spread attributes are not supported')
    }
    const attrName = t.isJSXIdentifier(attr.name) ? attr.name.name : null
    if (!attrName) throw new Error('Unsupported JSX attribute name')
    if (attrName === 'key') continue
    if (attrName === 'ref') {
      throw new Error('ref is not supported in the first compiler wave')
    }
    if (/^on[A-Z]/.test(attrName)) {
      throw new Error(`Component events are not supported yet (<${name} ${attrName}>)`)
    }
    if (!/^[a-z][a-z0-9]*$/.test(attrName)) {
      throw new Error(`Component prop "${attrName}" must be lowercase`)
    }

    const expression = getExpression(attr)
    if (expression == null) continue
    if (t.isStringLiteral(expression) || t.isNumericLiteral(expression)) {
      attrs.push(`${attrName}="${escapeAttr(String(expression.value))}"`)
      continue
    }
    if (scope) {
      attrs.push(`${attrName}="{{${inlineExpression(expression, scope)}}}"`)
    } else {
      const index = ctx.addBinding(expression)
      attrs.push(`${attrName}="{{b${index}}}"`)
    }
  }

  const allAttrs = [...attrs, ...extraAttrs]
  const attrText = allAttrs.length > 0 ? ` ${allAttrs.join(' ')}` : ''
  return `<${kebabCase(name)}${attrText} />`
}

function inlineComponent(node, ctx, scope, name, source) {
  if (!ctx.inline || scope || !ctx.resolveComponent) return null

  const childSource = ctx.resolveComponent(name, source)
  if (!childSource) return null

  const child = parseComponent(childSource)
  const body = child.ast.program.body
  for (const node of body) {
    if (!t.isImportDeclaration(node)) continue
    if (node.source.value !== 'solid-js') return null
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
  }
  if (
    body.some(
      (item) =>
        t.isVariableDeclaration(item) ||
        t.isFunctionDeclaration(item) ||
        t.isExpressionStatement(item),
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
    if (attrName === 'ref' || /^on[A-Z]/.test(attrName)) return null
    if (!/^[a-z][a-z0-9]*$/.test(attrName)) return null

    const expression = getExpression(attr)
    if (expression == null) continue
    propGetters.push({ name: attrName, code: codeOf(expression) })
  }

  if (propGetters.length > 0 && !child.propsParam) return null

  const blockId = ctx.blocks.length
  ctx.blocks.push({
    setup: child.statements.slice(0, child.returnIndex),
    propsParam: child.propsParam?.name ?? null,
    propGetters,
  })

  const previousBlock = ctx.currentBlock
  ctx.currentBlock = blockId
  const wxml = compileNode(child.jsx, ctx, null)
  ctx.currentBlock = previousBlock
  ctx.inlineComponents.push({ name, source })
  return wxml
}

function compileChildren(children, ctx, scope) {
  return children
    .map((child) => {
      if (isWhitespaceText(child)) return ''
      return compileNode(child, ctx, scope)
    })
    .join('')
}

function compileExpressionChild(expression, ctx, scope) {
  if (t.isJSXElement(expression) || t.isJSXFragment(expression)) {
    return compileNode(expression, ctx, scope)
  }
  if (t.isStringLiteral(expression) || t.isNumericLiteral(expression)) {
    return escapeText(String(expression.value))
  }
  if (t.isLogicalExpression(expression) && expression.operator === '&&') {
    if (t.isJSXElement(expression.right) || t.isJSXFragment(expression.right)) {
      return compileConditional(expression.left, expression.right, null, ctx, scope)
    }
  }
  if (t.isConditionalExpression(expression)) {
    const { consequent, alternate } = expression
    if (
      (t.isJSXElement(consequent) || t.isJSXFragment(consequent)) &&
      (t.isJSXElement(alternate) || t.isJSXFragment(alternate))
    ) {
      return compileConditional(expression.test, consequent, alternate, ctx, scope)
    }
  }
  if (scope) return `{{${inlineExpression(expression, scope)}}}`
  const index = ctx.addBinding(expression)
  return `{{b${index}}}`
}

function compileConditional(test, consequent, alternate, ctx, scope) {
  const condition = conditionExpression(test, ctx, scope)
  const thenNode = compileNode(consequent, ctx, scope, [`wx:if="{{${condition}}}"`])
  if (!alternate) return thenNode
  const elseNode = compileNode(alternate, ctx, scope, ['wx:else'])
  return `${thenNode}${elseNode}`
}

function compileShow(node, ctx, scope) {
  const when = getExpression(getAttribute(node, 'when'))
  if (!when) throw new Error('<Show> requires a when expression')
  const condition = conditionExpression(when, ctx, scope)
  const fallback = getExpression(getAttribute(node, 'fallback'))
  const children = node.children.filter((child) => !isWhitespaceText(child))
  if (children.length === 0) throw new Error('<Show> requires a child')

  const thenNode =
    children.length === 1
      ? compileNode(children[0], ctx, scope, [`wx:if="{{${condition}}}"`])
      : `<block wx:if="{{${condition}}}">${compileChildren(children, ctx, scope)}</block>`

  if (!fallback) return thenNode
  const elseNode = compileNode(fallback, ctx, scope, ['wx:else'])
  return `${thenNode}${elseNode}`
}

function compileFor(node, ctx, scope) {
  const each = getExpression(getAttribute(node, 'each'))
  if (!each) throw new Error('<For> requires an each expression')

  const keyAttr = getAttribute(node, 'key')
  let key = '*this'
  if (keyAttr) {
    if (keyAttr.value && t.isStringLiteral(keyAttr.value)) key = keyAttr.value.value
    else throw new Error('<For> key must be a string literal in the first compiler wave')
  }

  const eachCode = scope ? inlineExpression(each, scope) : codeOf(each)
  const eachExpr = scope ? eachCode : `b${ctx.addBinding(each, key)}`

  const child = node.children.find((item) => !isWhitespaceText(item))
  if (!child || !t.isJSXExpressionContainer(child)) {
    throw new Error('<For> requires a single arrow-function child')
  }
  const fn = child.expression
  if (!t.isArrowFunctionExpression(fn) && !t.isFunctionExpression(fn)) {
    throw new Error('<For> child must be an arrow function')
  }
  const itemName = t.isIdentifier(fn.params[0]) ? fn.params[0].name : 'item'
  const indexName = t.isIdentifier(fn.params[1]) ? fn.params[1].name : 'index'
  const body = t.isBlockStatement(fn.body)
    ? (() => {
        const ret = fn.body.body.find((item) => t.isReturnStatement(item))
        if (!ret) throw new Error('<For> callback must return JSX')
        return ret.argument
      })()
    : fn.body

  if (!t.isJSXElement(body) && !t.isJSXFragment(body)) {
    throw new Error('<For> callback must return JSX')
  }

  const itemScope = { item: itemName, index: indexName, source: eachCode, parent: scope }
  const children = compileNode(body, ctx, itemScope)
  return `<block wx:for="{{${eachExpr}}}" wx:for-item="${itemName}" wx:for-index="${indexName}" wx:key="${key}">${children}</block>`
}

function conditionExpression(expression, ctx, scope) {
  if (scope) return inlineExpression(expression, scope)
  return `b${ctx.addBinding(expression)}`
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
      const value = property.value
      if (t.isStringLiteral(value) || t.isNumericLiteral(value)) {
        return `${key}: ${value.value}`
      }
      throw new Error('Dynamic style values are not supported in the first compiler wave')
    })
    .join('; ')
}

function inlineExpression(expression, scope) {
  validateInline(expression, scope)
  return codeOf(expression)
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
      if (allowedIdentifiers.has(node.name)) return
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
