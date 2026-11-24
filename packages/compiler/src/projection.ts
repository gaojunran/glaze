import * as t from '@babel/types'
import { STRUCTURED_PROPS } from './constants.ts'
import { memberChainOf, unwrapTs, wxmlCodeOf } from './ast.ts'
import { isGroupableProp } from './props.ts'
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
  // Inline children have their own `props` parameter. If its name matches the
  // parent's, projecting it would read the parent property instead of the
  // child's prop getter.
  if (ctx.inlinePropsParam) return null
  if (ctx.blocks[ctx.currentBlock]?.propsParam) return null
  const propsParam = ctx.rootPropsParam
  if (!propsParam) return null

  const rewrite = (node: AnyNode, parent: AnyNode | null): AnyNode | null => {
    if (!node || typeof node.type !== 'string') return null

    const unwrapped = unwrapTs(node)
    if (unwrapped !== node) return rewrite(unwrapped, parent)

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
      const chain = memberChainOf(node)
      if (!chain || chain.segments.length === 0) return null
      if (!t.isIdentifier(chain.root, { name: propsParam })) return null
      const segments = chain.segments
      const mapped = Object.hasOwn(ctx.propMap, segments[0]!)
        ? ctx.propMap[segments[0]!]
        : undefined
      if (!mapped || ctx.localNames.has(mapped)) return null
      const rest = segments.slice(1)
      const buildPath = (base: AnyNode, names: string[]): AnyNode =>
        names.reduce(
          (value, name) => t.memberExpression(value, t.identifier(name)),
          base,
        )
      const fallback = buildPath(t.identifier(mapped), rest)
      if (!ctx.structuredProps || !isGroupableProp(segments[0]!)) return fallback
      const structuredRoot = t.memberExpression(
        t.identifier(STRUCTURED_PROPS),
        t.identifier(mapped),
      )
      return t.conditionalExpression(
        t.logicalExpression(
          '&&',
          t.identifier(STRUCTURED_PROPS),
          t.binaryExpression('!==', structuredRoot, t.identifier('undefined')),
        ),
        buildPath(structuredRoot, rest),
        fallback,
      )
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
