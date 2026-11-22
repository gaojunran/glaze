import type { ComponentDefinition } from 'glass-easel'
import * as glassEasel from 'glass-easel'
import { TmplGroup } from 'glass-easel-template-compiler'

export const tick = () => new Promise((resolve) => setTimeout(resolve, 5))

// The mini-program compiler emits `bindtap`/`catchtap`; glass-easel's own
// template compiler only recognizes the colon form. Normalize outside <wxs>
// blocks so WXS identifiers are not rewritten.
export function normalizeBindings(wxml: string): string {
  let output = ''
  let last = 0
  for (const match of wxml.matchAll(/<wxs\b[\s\S]*?<\/wxs>/g)) {
    const start = match.index ?? 0
    output += wxml.slice(last, start).replace(/\b(bind|catch)([a-z])/g, '$1:$2')
    output += match[0]
    last = start + match[0].length
  }
  return output + wxml.slice(last).replace(/\b(bind|catch)([a-z])/g, '$1:$2')
}

function compileTemplate(wxml: string, is: string) {
  const group = new TmplGroup()
  try {
    const errors = group.addTmpl(is, normalizeBindings(wxml))
    if (errors.length > 0) {
      throw new Error(errors.map((error: { toString(): string }) => String(error)).join('\n'))
    }
    const groups = new Function(`return ${group.getTmplGenObjectGroups()}`)() as Record<
      string,
      unknown
    >
    return { groupList: groups, content: groups[is] }
  } finally {
    group.free()
  }
}

export type MountOptions = {
  is?: string
  wxml: string
  config: Record<string, unknown>
  using?: Record<string, string>
}

export function register(space: glassEasel.ComponentSpace, options: MountOptions) {
  const is = options.is ?? 'glaze-test'
  const template = compileTemplate(options.wxml, is)
  return space.defineComponent({
    ...options.config,
    is,
    using: options.using ?? {},
    template,
  })
}

export function mount(
  space: glassEasel.ComponentSpace,
  definition: ComponentDefinition,
  is = 'glaze-test',
) {
  const element = glassEasel.Component.createWithContext(
    is,
    definition,
    new glassEasel.EmptyBackendContext(),
  ).general()
  glassEasel.Element.pretendAttached(element)
  return element
}

export function textOf(element: glassEasel.Element | null | undefined): string {
  if (!element) return ''
  return glassEasel.dumpSingleElementToString(element) ?? ''
}

export function textContentOf(node: { textContent?: string | null; childNodes?: ArrayLike<unknown> } | null | undefined): string {
  if (!node) return ''
  if (typeof node.textContent === 'string') return node.textContent
  return Array.from(node.childNodes ?? [], (child) => textContentOf(child as typeof node)).join('')
}
