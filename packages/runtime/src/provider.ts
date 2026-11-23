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

const CONTEXT_READER = Symbol('glaze.contextReader')

export type ContextReader = (() => unknown) & { [CONTEXT_READER]: true }

export const isContextReader = (value: unknown): value is ContextReader =>
  typeof value === 'function' && (value as { [CONTEXT_READER]?: true })[CONTEXT_READER] === true

/**
 * Every generated context read goes through a reader, including primitive
 * values. A Proxy preserves object identity but cannot represent a string, and
 * a captured primitive cannot follow a provider update; an accessor handles
 * both without changing the user-facing `const theme = useContext(Theme)` form.
 */
export const createContextReader = (read: () => unknown): ContextReader => {
  const reader = (() => read()) as ContextReader
  reader[CONTEXT_READER] = true
  return reader
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
  const provided = read ? createContextReader(read) : value
  const provider = context({
    value: provided,
    children: () => {
      setup()
      return ''
    },
  })
  provider()
}
