import type { GlazeContextProvider } from './types.ts'

/**
 *
 * Solid's provider is a component that sets the context while its children
 * accessor runs. Calling the provider directly and draining its memo keeps
 * that window open for the compiled child blocks, which are ordinary
 * statements rather than a JSX child tree.
 */
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
