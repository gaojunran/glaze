import * as t from '@babel/types'
import type { AnyNode } from './types.ts'

export type CompileWarning = {
  code: string
  message: string
}

const UNTRACKED_READ_AFTER_AWAIT = 'GLAZE_UNTRACKED_READ_AFTER_AWAIT'

/**
 * Solid only records dependencies until the first `await` in an async
 * computation. A props read after that point will not re-run the memo, so it
 * silently serves stale data. Report it instead of leaving the app to show
 * the wrong value.
 */
export function collectAsyncReadWarnings(
  ast: AnyNode,
  propsParam: string | null,
): CompileWarning[] {
  if (!propsParam) return []
  const warnings: CompileWarning[] = []
  const seen = new Set<string>()

  const warn = (node: AnyNode) => {
    const line = node.loc?.start?.line ?? 0
    const key = `${line}:${node.loc?.start?.column ?? 0}`
    if (seen.has(key)) return
    seen.add(key)
    const at = line ? ` at line ${line}` : ''
    warnings.push({
      code: UNTRACKED_READ_AFTER_AWAIT,
      message: `props is read after await${at}; Solid tracks dependencies only before the first await. Read it into a local before awaiting.`,
    })
  }

  const walk = (node: AnyNode, afterAwait: boolean, parent: AnyNode | null): boolean => {
    if (!node || typeof node.type !== 'string') return afterAwait
    if (isFunction(node)) {
      if (node.async) checkFunction(node)
      else walk(node.body, false, node)
      return afterAwait
    }
    if (t.isAwaitExpression(node)) {
      // The awaited expression is evaluated before suspension; only code after
      // the await loses dependency tracking.
      walk(node.argument, afterAwait, node)
      return true
    }
    if (afterAwait) {
      if (
        t.isMemberExpression(node) &&
        t.isIdentifier(node.object, { name: propsParam })
      ) {
        warn(node)
        walk(node.property, afterAwait, node)
        return afterAwait
      }
      if (
        t.isIdentifier(node, { name: propsParam }) &&
        !(
          parent &&
          (t.isMemberExpression(parent) ||
            t.isOptionalMemberExpression(parent) ||
            t.isObjectProperty(parent))
        )
      ) {
        warn(node)
      }
    }
    const keys = t.VISITOR_KEYS[node.type] ?? []
    for (const key of keys) {
      const value = node[key]
      if (Array.isArray(value)) {
        let after = afterAwait
        for (const child of value) after = walk(child, after, node)
        afterAwait = after
      } else if (value && typeof value.type === 'string') {
        afterAwait = walk(value, afterAwait, node)
      }
    }
    return afterAwait
  }

  const checkFunction = (fn: AnyNode) => {
    if (!fn.async) return
    const body = fn.body
    if (!body || typeof body.type !== 'string') return
    walk(body, false, fn)
  }

  walk(ast, false, null)
  return warnings
}

const isFunction = (node: AnyNode) =>
  t.isFunctionDeclaration(node) ||
  t.isFunctionExpression(node) ||
  t.isArrowFunctionExpression(node) ||
  t.isObjectMethod(node) ||
  t.isClassMethod(node)
