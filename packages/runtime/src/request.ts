import { createSignal, getOwner, onCleanup } from 'solid-js'

export type AsyncTask<T> = { promise: Promise<T>; abort?: () => void }

export type AsyncRequest<T> = {
  data: () => T | undefined
  error: () => unknown
  pending: () => boolean
  run: () => Promise<T | undefined>
  abort: () => void
}

/**
 * One flight's identity. The abort callback belongs to the task the flight
 * started, so a later flight can drop the earlier one without touching its own.
 */
type Flight = { id: number; abort?: () => void }

/**
 * Reactive request state for an async task. Nothing runs until `run()`, and
 * only the latest flight may write `data` or `error`, so an earlier response
 * that arrives late cannot overwrite a newer one.
 */
export function createRequest<T>(start: () => AsyncTask<T> | Promise<T>): AsyncRequest<T> {
  // Boxed values keep a function-valued result from being treated as a setter
  // updater by Solid.
  const [data, setData] = createSignal<{ value: T }>()
  const [error, setError] = createSignal<{ value: unknown }>()
  const [pending, setPending] = createSignal(false)

  let flightId = 0
  let current: Flight | undefined

  const abort = () => {
    const flight = current
    current = undefined
    // Bumping the id makes any in-flight continuation stale, so a late
    // resolution cannot clear this abort's `pending` or write `data`.
    flightId += 1
    flight?.abort?.()
    setPending(false)
  }

  const run = async (): Promise<T | undefined> => {
    abort()
    const id = flightId
    setPending(true)
    setError(undefined)

    let task: AsyncTask<T>
    try {
      const started = start()
      task = 'promise' in started ? started : { promise: started }
    } catch (cause) {
      setError({ value: cause })
      setPending(false)
      return undefined
    }
    current = { id, abort: task.abort }

    try {
      const value = await task.promise
      if (id !== flightId) return undefined
      current = undefined
      setData({ value })
      setPending(false)
      return value
    } catch (cause) {
      if (id !== flightId) return undefined
      current = undefined
      setError({ value: cause })
      setPending(false)
      return undefined
    }
  }

  if (getOwner()) onCleanup(abort)

  return {
    data: () => data()?.value,
    error: () => error()?.value,
    pending,
    run,
    abort,
  }
}
