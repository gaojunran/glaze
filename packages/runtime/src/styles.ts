export function className(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value.map(className).filter(Boolean).join(' ')
  }
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .filter(([, active]) => active)
      .map(([name]) => name)
      .join(' ')
  }
  return ''
}


export function styleName(value: unknown): string {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return ''
  return Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item != null && item !== '')
    .map(([key, item]) => `${key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}:${item}`)
    .join(';')
}


export function textValue(value: unknown): unknown {
  return typeof value === 'boolean' ? '' : value
}
