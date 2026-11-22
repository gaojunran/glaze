import type { DataChange } from './types.ts'

export type ListOp = { index: number; del: number; inserts: unknown[] }

const keyOf = (item: unknown, key: string) =>
  (item as Record<string, unknown> | null | undefined)?.[key]

/** Internal helper, exported for unit tests. */
export function listOps(previous: unknown, next: unknown, key: string): ListOp[] | null {
  if (!Array.isArray(previous) || !Array.isArray(next)) return null
  if (key === '*this') return null

  let prefix = 0
  while (
    prefix < previous.length &&
    prefix < next.length &&
    Object.is(keyOf(previous[prefix], key), keyOf(next[prefix], key))
  ) {
    prefix += 1
  }

  let suffix = 0
  while (
    suffix < previous.length - prefix &&
    suffix < next.length - prefix &&
    Object.is(
      keyOf(previous[previous.length - 1 - suffix], key),
      keyOf(next[next.length - 1 - suffix], key),
    )
  ) {
    suffix += 1
  }

  if (prefix === previous.length && prefix === next.length) return null
  if (prefix === previous.length) {
    return [{ index: prefix, del: 0, inserts: next.slice(prefix) }]
  }
  if (prefix === next.length) {
    return [{ index: prefix, del: previous.length - prefix, inserts: [] }]
  }
  return [
    {
      index: prefix,
      del: previous.length - prefix - suffix,
      inserts: next.slice(prefix, next.length - suffix),
    },
  ]
}

/** Internal helper, exported for unit tests. */
export function listPatch(
  previous: unknown,
  next: unknown,
  key: string,
  binding: string,
): DataChange[] | null {
  if (!Array.isArray(previous) || !Array.isArray(next)) return null
  if (key === '*this') return null
  if (previous.length !== next.length) return null

  const patch: DataChange[] = []
  for (let index = 0; index < next.length; index += 1) {
    const item = next[index]
    const before = previous[index]
    if (!before || !item || typeof before !== 'object' || typeof item !== 'object') return null
    if (!Object.is(keyOf(before, key), keyOf(item, key))) return null

    if (before === item) continue
    for (const field of Object.keys(item)) {
      if (Object.is(before[field], item[field])) continue
      if (!(field in before)) return null
      patch.push({ path: [binding, index, field], value: item[field] })
    }
    for (const field of Object.keys(before)) {
      if (!(field in item)) return null
    }
  }

  return patch
}
