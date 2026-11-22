import { NotReadyError } from 'solid-js'

export const GLAZE_EVENT_OPTIONS = { bubbles: true, capturePhase: true }
export const SCALAR_BINDING_GROUP = 8

export const normalizePropValue = (value: unknown): unknown => (value === null ? undefined : value)

export const normalizeDataValue = (value: unknown): unknown => (value === undefined ? null : value)

/** Internal helper, exported for unit tests. */
export function dataPath(key: string): (string | number)[] {
  const path: (string | number)[] = []
  let index = 0
  while (index < key.length) {
    if (key[index] === '.') {
      index += 1
      continue
    }
    if (key[index] === '[') {
      const end = key.indexOf(']', index)
      if (end < 0) throw new Error(`Invalid data path: ${key}`)
      const segment = key.slice(index + 1, end)
      path.push(/^\d+$/.test(segment) ? Number(segment) : segment)
      index = end + 1
      continue
    }
    let end = index
    while (end < key.length && key[end] !== '.' && key[end] !== '[') end += 1
    path.push(key.slice(index, end))
    index = end
  }
  return path
}

export function reportBindingError(index: number, error: unknown): void {
  // Async resources below a binding legitimately throw while settling; only
  // surface unexpected failures so they do not disappear behind the guard.
  if (error instanceof NotReadyError) return
  const errorConsole = (globalThis as { console?: Console }).console
  errorConsole?.error?.(`[glaze] binding b${index} failed`, error)
}

