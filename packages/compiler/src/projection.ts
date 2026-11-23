import * as t from '@babel/types'
import { wxmlCodeOf } from './ast.ts'
import type { AnyNode, CompilerContext, Scope } from './types.ts'

const BINARY_OPERATORS = new Set([
  '+',
  '-',
  '*',
  '/',
  '%',
  '===',
  '!==',
  '==',
  '!=',
  '>',
  '>=',
  '<',
  '<=',
])

const UNARY_OPERATORS = new Set(['!', '+', '-'])

/**
 * Project an expression that only depends on component props into a WXML
 * expression. WXML reads mini-program properties directly, so the result does
 * not need a Solid effect or a data write when a parent changes a prop.
 *
 * Returning null means the expression needs the normal binding path: it may
 * read local state, call a function, or use syntax WXML cannot represent.
 * This first wave handles top-level components (not expressions inside a
 * loop); loop expressions already have their own inline path.
 */
export function projectExpression(
  expression: AnyNode,
  ctx: CompilerContext,
  scope: Scope | null,
): string | null {
  if (scope) return null
  const propsParam = ctx.rootPropsParam
  if (!propsParam) return null

  const rewrite = (node: AnyNode, parent: AnyNode | null): AnyNode | null => {
    if (!node || typeof node.type !== 'string') return null

    if (
      t.isTSAsExpression(node) ||
      t.isTSSatisfiesExpression(node) ||
      t.isTSNonNullExpression(node)
    ) {
      return rewrite(node.expression, parent)
    }

    if (t.isStringLiteral(node) || t.isNumericLiteral(node) || t.isBooleanLiteral(node) || t.isNullLiteral(node)) {
      return node
    }

    if (t.isIdentifier(node)) {
      // A bare `props` object is not a WXML value; property access is handled
      // below. Any other identifier here is local state or a JS value.
      if (node.name === propsParam) return null
      if (parent && t.isMemberExpression(parent) && parent.property === node && !parent.computed) {
        return node
      }
      return null
    }

    if (t.isMemberExpression(node)) {
      if (node.computed) return null
      if (t.isIdentifier(node.object, { name: propsParam })) {
        if (!t.isIdentifier(node.property)) return null
        const mapped = ctx.propMap[node.property.name]
        if (!mapped || ctx.localNames.has(mapped)) return null
        return t.identifier(mapped)
      }
      const object = rewrite(node.object, node)
      if (!object) return null
      return t.memberExpression(object, node.property as AnyNode, false)
    }

    if (t.isBinaryExpression(node) || t.isLogicalExpression(node)) {
      if (!BINARY_OPERATORS.has(node.operator) && !['&&', '||'].includes(node.operator)) {
        return null
      }
      const left = rewrite(node.left, node)
      const right = rewrite(node.right, node)
      if (!left || !right) return null
      return t.isLogicalExpression(node)
        ? t.logicalExpression(node.operator as any, left, right)
        : t.binaryExpression(node.operator as any, left, right)
    }

    if (t.isUnaryExpression(node)) {
      if (!UNARY_OPERATORS.has(node.operator)) return null
      const argument = rewrite(node.argument, node)
      if (!argument) return null
      return t.unaryExpression(node.operator as any, argument, true)
    }

    if (t.isConditionalExpression(node)) {
      const test = rewrite(node.test, node)
      const consequent = rewrite(node.consequent, node)
      const alternate = rewrite(node.alternate, node)
      if (!test || !consequent || !alternate) return null
      return t.conditionalExpression(test, consequent, alternate)
    }

    if (t.isParenthesizedExpression(node)) {
      return rewrite(node.expression, node)
    }

    // Calls, optional access, objects, arrays, templates and anything else
    // stay on the binding path. They can be added to the WXS projection later.
    return null
  }

  const projected = rewrite(expression, null)
  if (!projected) return null
  try {
    return wxmlCodeOf(projected)
  } catch {
    return null
  }
}
