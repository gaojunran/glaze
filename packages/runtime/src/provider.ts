import type { GlazeContextProvider } from './types.ts'

/**
 *
 * Solid's provider is a component that sets the context while its children
 * accessor runs. Calling the provider directly and draining its memo keeps
 * that window open for the compiled child blocks, which are ordinary
 * statements rather than a JSX child tree.
 */
export type BoundaryContextEntry = { context: GlazeContextProvider; key: string }

/** Re-enter the providers a child component consumes before running setup. */
export function withBoundaryContexts(
  entries: BoundaryContextEntry[],
  values: Record<string, unknown> | null | undefined,
  setup: () => void,
): void {
  const run = (index: number): void => {
    if (index >= entries.length) {
      setup()
      return
    }
    const entry = entries[index]
    if (values && Object.hasOwn(values, entry.key)) {
      withProvider(entry.context, values[entry.key], () => run(index + 1))
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
): void {
  const provider = context({
    value,
    children: () => {
      setup()
      return ''
    },
  })
  provider()
}
