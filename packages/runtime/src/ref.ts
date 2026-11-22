import type { GlazeNode, GlazeNodeRect } from './types.ts'

type Query = {
  select(selector: string): {
    boundingClientRect(callback: (rect: GlazeNodeRect | null) => void): Query
  }
  selectViewport(): { scrollOffset(callback: (offset: { scrollTop?: number }) => void): Query }
  selectAll(selector: string): {
    boundingClientRect(callback: (rects: GlazeNodeRect[]) => void): Query
  }
  exec(): void
}

const selectorQuery = (component: unknown): Query => {
  const componentQuery = (component as { createSelectorQuery?: () => Query }).createSelectorQuery
  if (typeof componentQuery === 'function') return componentQuery.call(component)
  const wx = (globalThis as { wx?: { createSelectorQuery?: () => { in(scope: unknown): Query } } }).wx
  return wx!.createSelectorQuery!().in(component)
}

const measure = (component: unknown, selector: string) =>
  new Promise<GlazeNodeRect | null>((resolve) => {
    try {
      selectorQuery(component)
        .select(selector)
        .boundingClientRect((rect) => resolve(rect ?? null))
        .exec()
    } catch {
      resolve(null)
    }
  })

const measureAll = (component: unknown, selector: string) =>
  new Promise<GlazeNodeRect[]>((resolve) => {
    try {
      selectorQuery(component)
        .selectAll(selector)
        .boundingClientRect((rects) => resolve(Array.isArray(rects) ? rects : []))
        .exec()
    } catch {
      resolve([])
    }
  })

const createNode = (
  component: unknown,
  selector: string,
  rect: GlazeNodeRect,
  index: number | null = null,
): GlazeNode => {
  const measureSelf = async (): Promise<GlazeNodeRect | null> => {
    if (index == null) return measure(component, selector)
    const rects = await measureAll(component, selector)
    return rects[index] ?? null
  }
  const node: GlazeNode = {
    ...rect,
    async getBoundingClientRect() {
      return measureSelf()
    },
    async querySelector(childSelector: string) {
      const input = `${selector} ${childSelector}`
      const child = await measure(component, input)
      return child ? createNode(component, input, child) : null
    },
    async querySelectorAll(childSelector: string) {
      const input = `${selector} ${childSelector}`
      const rects = await measureAll(component, input)
      return rects.map((item, position) => createNode(component, input, item, position))
    },
    async scrollIntoView(options = {}) {
      const self = await measureSelf()
      if (!self || typeof (globalThis as { wx?: { pageScrollTo?: unknown } }).wx?.pageScrollTo !== 'function') {
        return false
      }
      const offset = options.offset ?? 0
      const scrollTop = await new Promise<number>((resolve) => {
        try {
          selectorQuery(component)
            .selectViewport()
            .scrollOffset((value: { scrollTop?: number }) => resolve(value?.scrollTop ?? 0))
            .exec()
        } catch {
          resolve(0)
        }
      })
      const top = Math.max(0, (self.top ?? 0) + scrollTop - offset)
      ;(globalThis as unknown as { wx: { pageScrollTo(input: unknown): void } }).wx.pageScrollTo({
        scrollTop: top,
        duration: options.duration ?? 300,
      })
      return true
    },
  }
  return node
}

export const createNodeRef = (
  component: unknown,
  id: string,
  callback: (node: GlazeNode | null) => void,
): void => {
  const selector = `#${id}`
  measure(component, selector).then((rect) => {
    callback(rect ? createNode(component, selector, rect) : null)
  })
}
