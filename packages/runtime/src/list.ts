import { LIST_KEY_WHOLE } from '@glaze/shared'

import type { DataChange } from './types.ts'

export type ListOp = { index: number; del: number; inserts: unknown[] }

const keyOf = (item: unknown, key: string) =>
  (item as Record<string, unknown> | null | undefined)?.[key]

const isObjectItem = (item: unknown) => item !== null && typeof item === 'object'

const isPlainObject = (value: object) => {
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/**
 * Read a list deeply inside a tracking scope.
 *
 * A plain signal only changes when the array is replaced, but a Solid store
 * changes in place: `store.items.push(...)` or `store.items[0].done = true`
 * updates the proxy without replacing the array. A list binding that only
 * reads `store.items` would therefore keep rendering the old rows. Reading the
 * length, each index and each plain-object field subscribes the binding to the
 * store's fine-grained updates; for a non-reactive array these reads are
 * ordinary property access and change nothing.
 */
export const trackListValue = <T>(value: T, fields?: readonly string[]): T => {
  if (Array.isArray(value)) trackValue(value, new Set(), 0, fields)
  return value
}

const trackValue = (
  value: unknown,
  seen: Set<object>,
  depth: number,
  fields?: readonly string[],
) => {
  if (value === null || typeof value !== 'object' || depth > 8) return
  const object = value as object
  if (seen.has(object)) return
  seen.add(object)
  if (Array.isArray(value)) {
    const length = value.length
    for (let index = 0; index < length; index += 1) {
      trackValue(value[index], seen, depth + 1, fields)
    }
    return
  }
  if (!isPlainObject(object)) return
  // A projected keyed list only needs the fields WXML reads. Reading other
  // store fields would wake the binding for data the view never shows and
  // force a full-list fallback. Nested objects are tracked in full.
  const keys = depth === 1 && fields ? fields : Object.keys(object)
  for (const key of keys) {
    trackValue((value as Record<string, unknown>)[key], seen, depth + 1)
  }
}

/** Structural equality, used to ignore unchanged nested values after cloning. */
const equalValue = (left: unknown, right: unknown, seen: WeakMap<object, WeakSet<object>>): boolean => {
  if (Object.is(left, right)) return true
  if (!isObjectItem(left) || !isObjectItem(right)) return false
  if (left instanceof Date || right instanceof Date) {
    return left instanceof Date && right instanceof Date && left.getTime() === right.getTime()
  }
  if (left instanceof RegExp || right instanceof RegExp) {
    return (
      left instanceof RegExp &&
      right instanceof RegExp &&
      left.source === right.source &&
      left.flags === right.flags
    )
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
    for (let index = 0; index < left.length; index += 1) {
      if (!equalValue(left[index], right[index], seen)) return false
    }
    return true
  }
  const leftObject = left as object
  const rightObject = right as object
  let compared = seen.get(leftObject)
  if (compared?.has(rightObject)) return true
  if (!compared) {
    compared = new WeakSet()
    seen.set(leftObject, compared)
  }
  compared.add(rightObject)
  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  const leftKeys = Object.keys(leftRecord)
  if (leftKeys.length !== Object.keys(rightRecord).length) {
    compared.delete(rightObject)
    return false
  }
  for (const key of leftKeys) {
    if (!Object.hasOwn(rightRecord, key) || !equalValue(leftRecord[key], rightRecord[key], seen)) {
      // Only equal pairs stay cached. Caching an unequal pair would hide the
      // same pair when another field reaches it through a different path.
      compared.delete(rightObject)
      return false
    }
  }
  return true
}

/**
 * Deep-copy a list row before it is stored as the previous value. Array
 * slicing keeps the same row objects, so `items[0].meta.done = true` followed
 * by a new array would compare equal against itself at every level. A deep
 * snapshot makes both direct and nested field mutations visible to
 * `listPatch`; only the changed top-level field is still sent, because
 * `listPatch` compares row fields one level at a time.
 *
 * Supported inputs are primitives, arrays, `Date`, `RegExp`, plain objects and
 * cyclic references. Any other object (class instance, `Map`, `Set`,
 * `TypedArray`, ...) is copied by its enumerable own keys, so a `Map`/`Set`
 * flattens to `{}` and a typed array becomes an index-keyed plain object. Keep
 * such containers out of list rows, or replace the row as a whole.
 */
const cloneValue = (value: unknown, seen: WeakMap<object, unknown>): unknown => {
  if (value === null || typeof value !== 'object') return value
  const object = value as object
  const existing = seen.get(object)
  if (existing) return existing
  if (Array.isArray(value)) {
    const copy: unknown[] = []
    seen.set(object, copy)
    for (const item of value) copy.push(cloneValue(item, seen))
    return copy
  }
  if (value instanceof Date) return new Date(value.getTime())
  if (value instanceof RegExp) return new RegExp(value.source, value.flags)
  const copy: Record<string, unknown> = {}
  seen.set(object, copy)
  for (const key of Object.keys(value)) {
    copy[key] = cloneValue((value as Record<string, unknown>)[key], seen)
  }
  return copy
}

/** Internal helper, exported for unit tests. */
export function snapshotList(value: unknown): unknown {
  if (!Array.isArray(value)) return value
  const seen = new WeakMap<object, unknown>()
  return value.map((item) => (isObjectItem(item) ? cloneValue(item, seen) : item))
}

/**
 * Build the view-model rows for a list binding. The compiler records the
 * top-level fields WXML reads; sending only those fields keeps large payloads
 * that the template never uses out of `setData`.
 *
 * Every row must be a plain object. If any row is a primitive, array, class
 * instance, Date, etc., return the original value: the projection is an
 * optimization, never a semantic change.
 */
export function projectList(value: unknown, fields: readonly string[] | null | undefined): unknown {
  if (!Array.isArray(value) || !fields || fields.length === 0) return value
  const projected: Record<string, unknown>[] = []
  for (const item of value) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return value
    const prototype = Object.getPrototypeOf(item)
    if (prototype !== Object.prototype && prototype !== null) return value
    const row: Record<string, unknown> = {}
    for (const field of fields) {
      // Assigning `__proto__` would change the prototype instead of creating a
      // data field; fall back rather than silently dropping it.
      if (field === '__proto__') return value
      row[field] = (item as Record<string, unknown>)[field]
    }
    projected.push(row)
  }
  return projected
}

/** Internal helper, exported for unit tests. */
export function listOps(previous: unknown, next: unknown, key: string): ListOp | null {
  if (!Array.isArray(previous) || !Array.isArray(next)) return null
  if (key === LIST_KEY_WHOLE) return null
  // Primitive rows have no key to align on; splice ops would be ambiguous, so
  // let the caller replace the whole array instead.
  if (previous.some((item) => !isObjectItem(item)) || next.some((item) => !isObjectItem(item))) {
    return null
  }

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
    return { index: prefix, del: 0, inserts: next.slice(prefix) }
  }
  if (prefix === next.length) {
    return { index: prefix, del: previous.length - prefix, inserts: [] }
  }
  return {
    index: prefix,
    del: previous.length - prefix - suffix,
    inserts: next.slice(prefix, next.length - suffix),
  }
}

/** Internal helper, exported for unit tests. */
export function listPatch(
  previous: unknown,
  next: unknown,
  key: string,
  binding: string,
): DataChange[] | null {
  if (!Array.isArray(previous) || !Array.isArray(next)) return null
  if (key === LIST_KEY_WHOLE) return null
  if (previous.length !== next.length) return null

  const patch: DataChange[] = []
  // One comparison cache for the whole call: a pair compared once yields the
  // same structural result on every field and row, and the arrays do not
  // change while this synchronous pass runs.
  const seen = new WeakMap<object, WeakSet<object>>()
  for (let index = 0; index < next.length; index += 1) {
    const item = next[index]
    const before = previous[index]
    if (!before || !item || typeof before !== 'object' || typeof item !== 'object') return null
    if (!Object.is(keyOf(before, key), keyOf(item, key))) return null

    const changed: DataChange[] = []
    for (const field of Object.keys(item)) {
      if (equalValue(before[field], item[field], seen)) continue
      if (!(field in before)) return null
      changed.push({ path: [binding, index, field], value: item[field] })
    }
    for (const field of Object.keys(before)) {
      if (!(field in item)) return null
    }
    // A row with several changed fields is cheaper to replace as one data
    // path than as one path per field; the child property receives the same
    // projected row either way. Keep field paths for small or sparse edits so
    // replacing a row does not fan out unchanged fields to the child.
    const total = Object.keys(item).length
    if (changed.length > 2 && changed.length * 2 > total) {
      patch.push({ path: [binding, index], value: item })
    } else {
      patch.push(...changed)
    }
  }

  return patch
}

/**
 * Decide how a list binding reaches component data: field patch first, then a
 * single splice, then `null` so the caller sends the whole value. `canSplice`
 * is the transport capability, not the presence of `spliceArrayDataOnPath`;
 * without it a splice would be silently dropped by the setData fallback.
 *
 * A splice only carries the inserted rows. If a retained prefix/suffix row
 * changed (keyed the same, so `listOps` keeps it), the splice would leave that
 * row's stale fields in place, so fall back to the whole value instead.
 */
export function diffList(
  previous: unknown,
  next: unknown,
  key: string,
  binding: string,
  canSplice = true,
): DataChange[] | null {
  const patch = listPatch(previous, next, key, binding)
  if (patch) return patch
  if (!canSplice) return null
  const op = listOps(previous, next, key)
  if (!op || !Array.isArray(previous) || !Array.isArray(next)) return null

  const seen = new WeakMap<object, WeakSet<object>>()
  for (let index = 0; index < op.index; index += 1) {
    if (!equalValue(previous[index], next[index], seen)) return null
  }
  let tail = op.index + op.inserts.length
  for (let index = op.index + op.del; index < previous.length; index += 1) {
    if (!equalValue(previous[index], next[tail], seen)) return null
    tail += 1
  }
  return [{ path: [binding], splice: op }]
}
