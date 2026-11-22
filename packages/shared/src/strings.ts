/** Convert a component name or path to the lowercase kebab form used in WXML tags. */
export const kebabCase = (value: string): string =>
  value
    .replace(/\//g, '-')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
