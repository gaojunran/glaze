import type { GlazeContextProvider } from './types.ts'

/**
 *
 * Solid's provider is a component that sets the context while its children
 * accessor runs. Calling the provider directly and draining its memo keeps
 * that window open for the compiled child blocks, which are ordinary
 * statements rather than a JSX child tree.
 */
export type BoundaryContextEntry = { context: GlazeContextProvider; key: string }

type ContextValues = Record<string, unknown> | null | undefined
type ContextValuesSource = ContextValues | (() => ContextValues)

/**
 * A context value is normally an object read by descendants. Wrapping it in a
 * proxy lets every property read observe the latest provider value without
 * remounting the child tree. Primitives cannot be proxied without changing
 * their identity, so they keep the value captured when the provider ran.
 */
const reactiveValue = (read: () => unknown, captured: unknown): unknown => {
  const initial = read()
  if (initial === null || typeof initial !== 'object') return captured
  const target: object = Array.isArray(initial) ? [] : {}
  return new Proxy(target, {
    get(_target, key) {
      const current = read() as Record<PropertyKey, unknown> | null | undefined
      if (current == null) return undefined
      const value = current[key as keyof typeof current]
      return typeof value === 'function' ? value.bind(current) : value
    },
    has(_target, key) {
      const current = read()
      return current != null && typeof current === 'object' && key in current
    },
    ownKeys() {
      const current = read()
      return current != null && typeof current === 'object' ? Reflect.ownKeys(current) : []
    },
    getOwnPropertyDescriptor(_target, key) {
      const current = read()
      if (current == null || typeof current !== 'object' || !(key in current)) return undefined
      return { enumerable: true, configurable: true }
    },
  })
}

const readValues = (source: ContextValuesSource): ContextValues =>
  typeof source === 'function' ? source() : source

/** Re-enter the providers a child component consumes before running setup. */
export function withBoundaryContexts(
  entries: BoundaryContextEntry[],
  values: ContextValuesSource,
  setup: () => void,
): void {
  const run = (index: number): void => {
    if (index >= entries.length) {
      setup()
      return
    }
    const entry = entries[index]
    const source = readValues(values)
    if (source && Object.hasOwn(source, entry.key)) {
      withProvider(
        entry.context,
        source[entry.key],
        () => run(index + 1),
        () => {
          const current = readValues(values)
          return current && Object.hasOwn(current, entry.key) ? current[entry.key] : undefined
        },
      )
    } else {
      run(index + 1)
    }
  }
  run(0)
}

export function withProvider(
  context: GlazeContextProvider,
  value: unknown,
  setup: () => void,
  read?: () => unknown,
): void {
  const provided = read ? reactiveValue(read, value) : value
  const provider = context({
    value: provided,
    children: () => {
      setup()
      return ''
    },
  })
  provider()
}
