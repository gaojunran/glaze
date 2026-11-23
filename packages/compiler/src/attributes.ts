import * as t from '@babel/types'
import { codeOf, escapeAttr } from './ast.ts'
import { projectExpression } from './projection.ts'
import { inlineExpression } from './scope.ts'
import type { AnyNode, CompilerContext, Scope } from './types.ts'

export function conditionExpression(expression, ctx, scope) {
  const projected = projectExpression(expression, ctx, scope)
  if (projected != null) return projected
  if (scope) return inlineExpression(expression, scope, ctx)
  return `b${ctx.addBinding(expression)}`
}

export function classAttr(expression, ctx, scope) {
  if (!scope) {
    ctx.addHelper('className')
    const index = ctx.addBindingCode(`className(${codeOf(expression)})`)
    return `class="{{b${index}}}"`
  }
  return `class="${classInline(expression, scope, ctx)}"`
}

export function styleAttr(expression, ctx, scope) {
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

export function classInline(expression, scope, ctx) {
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

export function classInlineItem(expression, scope, ctx) {
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

export function styleInline(expression, scope, ctx) {
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
      if (t.isBooleanLiteral(value)) {
        return value.value ? `${name}:true` : ''
      }
      if (t.isNullLiteral(value)) return ''
      return `${name}:{{${inlineExpression(value, scope, ctx)}}}`
    })
    .filter(Boolean)
    .join(';')
}

export function isStaticStyle(node) {
  return node.properties.every(
    (property) =>
      t.isObjectProperty(property) &&
      (t.isStringLiteral(property.value) || t.isNumericLiteral(property.value)),
  )
}

export function staticStyle(node) {
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
