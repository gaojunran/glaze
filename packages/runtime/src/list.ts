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
): Record<string, unknown> | null {
  if (!Array.isArray(previous) || !Array.isArray(next)) return null
  if (key === '*this') return null
  if (previous.length !== next.length) return null

  const previousIndex = new Map(previous.map((item, index) => [item?.[key], index]))
  const patch: Record<string, unknown> = {}

  for (let index = 0; index < next.length; index += 1) {
    const item = next[index]
    const beforeIndex = previousIndex.get(item?.[key])
    if (beforeIndex !== index) return null

    const before = previous[beforeIndex]
    if (before === item) continue
    for (const field of Object.keys(item)) {
      if (before && Object.is(before[field], item[field])) continue
      if (!before || !(field in before)) return null
      patch[`${binding}[${index}].${field}`] = item[field]
    }
    for (const field of Object.keys(before ?? {})) {
      if (!(field in item)) return null
    }
  }

  return patch
}

declare const Component: (config: Record<string, unknown>) => unknown
