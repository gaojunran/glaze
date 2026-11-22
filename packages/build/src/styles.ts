
export function assertPortableWxss(file, content) {
  if (/@import\s+[^;]+;/.test(content)) {
    throw new Error(
      `WXSS @import is not supported because styles are copied into generated components: ${file}`,
    )
  }
  const urlPattern = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi
  for (const match of content.matchAll(urlPattern)) {
    const value = match[2].trim()
    if (
      value === '' ||
      value.startsWith('#') ||
      /^(data:|https?:|\/\/|\/)/i.test(value)
    ) {
      continue
    }
    throw new Error(
      `WXSS url() must be absolute, remote, or a data URL because styles are copied into generated components: ${file} (${value})`,
    )
  }
}
