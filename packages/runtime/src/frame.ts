export type FrameScheduler = (flush: () => void) => void

type RenderBackend = {
  render?: (callback: () => void) => void
}

type RenderHost = {
  getBackendContext?: () => RenderBackend | null | undefined
}

type SetDataHost = {
  setData?: (data: Record<string, never>, callback?: () => void) => void
}

const microtask = (flush: () => void) => {
  if (typeof queueMicrotask === 'function') queueMicrotask(flush)
  else Promise.resolve().then(flush)
}

const once = (flush: () => void) => {
  let done = false
  return () => {
    if (done) return
    done = true
    flush()
  }
}

const backendOf = (host: RenderHost | null | undefined): RenderBackend | null => {
  try {
    return host?.getBackendContext?.() ?? null
  } catch {
    return null
  }
}

/**
 * A lifetime's `this` is the mini-program `ComponentCaller`, so the glass-easel
 * backend is not directly reachable. Its `setData` callback is routed through
 * glass-easel's `triggerRender`, which calls the backend's `render` (the
 * view-side animation frame); an empty `setData` is therefore a frame token.
 */
const setDataFrameScheduler = (component: unknown): FrameScheduler | null => {
  const host = component as SetDataHost | null
  if (typeof host?.setData !== 'function') return null
  if (!(globalThis as { wx?: unknown }).wx) return null
  return (flush) => {
    const run = once(flush)
    try {
      host.setData!({}, run)
    } catch {
      microtask(run)
    }
  }
}

/**
 * Glass-easel exposes a backend `render(callback)` that reaches the view-side
 * `requestAnimationFrame`. Use it to keep all binding changes of one frame in
 * one transport batch; hosts without that backend use the `setData` callback
 * frame token, then a microtask.
 */
export function createFrameScheduler(
  component: unknown,
  { allowSetData = true }: { allowSetData?: boolean } = {},
): FrameScheduler {
  const backend = backendOf(component as RenderHost)
  const render = backend?.render
  if (typeof render !== 'function') {
    return (allowSetData ? setDataFrameScheduler(component) : null) ?? microtask
  }
  return (flush) => {
    const run = once(flush)
    try {
      render.call(backend, run)
    } catch {
      microtask(run)
    }
  }
}
