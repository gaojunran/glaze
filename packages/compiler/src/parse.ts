import { parse } from '@babel/parser'
import * as t from '@babel/types'
import type { AnyNode } from './types.ts'

export type ParsedComponent = {
  ast: AnyNode
  fn: AnyNode
  statements: AnyNode[]
  returnIndex: number
  jsx: AnyNode
  propsParam: AnyNode | null
  props: string[]
}

export function parseComponent(source: string): ParsedComponent {
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

export function findComponentFunction(ast: AnyNode): AnyNode | null {
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

export function functionStatements(fn: AnyNode): AnyNode[] {
  if (t.isBlockStatement(fn.body)) return fn.body.body
  return [t.returnStatement(fn.body)]
}

export function collectImports(ast: AnyNode): Map<string, string> {
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

export function collectProps(paramName: string, body: AnyNode): string[] {
  const props = new Set<string>()
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
