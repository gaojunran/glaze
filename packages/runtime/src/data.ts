import { NotReadyError } from 'solid-js'

export const GLAZE_EVENT_OPTIONS = { bubbles: true, capturePhase: true }
export const SCALAR_BINDING_GROUP = 8

export const normalizePropValue = (value: unknown): unknown => (value === null ? undefined : value)

export const normalizeDataValue = (value: unknown): unknown => (value === undefined ? null : value)

export function dataKey(path: (string | number)[]): string {
  let key = ''
  for (const part of path) {
    if (typeof part === 'number') key += `[${part}]`
    else key += key ? `.${part}` : part
  }
  return key
}

export function reportBindingError(index: number, error: unknown): void {
  // Async resources below a binding legitimately throw while settling; only
  // surface unexpected failures so they do not disappear behind the guard.
  if (error instanceof NotReadyError) return
  const errorConsole = (globalThis as { console?: Console }).console
  errorConsole?.error?.(`[glaze] binding b${index} failed`, error)
}

export function reportTransportError(error: unknown): void {
  const errorConsole = (globalThis as { console?: Console }).console
  errorConsole?.error?.('[glaze] data transport failed; the batch was not replayed', error)
}

export function reportComponentError(error: unknown): void {
  const errorConsole = (globalThis as { console?: Console }).console
  errorConsole?.error?.('[glaze] component error', error)
}

export function reportAppLifecycleError(error: unknown): void {
  const errorConsole = (globalThis as { console?: Console }).console
  errorConsole?.error?.('[glaze] app lifecycle handler failed', error)
}
