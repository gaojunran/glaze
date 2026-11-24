import { createRoot } from 'solid-js'

export type StoreSetup<T extends object> = () => T

export type GlazeStore<T extends object, Id extends string = string> = T & {
  /** Stable store id, useful for diagnostics and persistence keys. */
  readonly $id: Id
  /** Dispose the store root; the next `useStore()` builds a fresh instance. */
  $dispose(): void
}

export type StoreDefinition<T extends object, Id extends string> =
  (() => GlazeStore<T, Id>) & {
    readonly $id: Id
  }

type StoreEntry = {
  setup: StoreSetup<Record<string, unknown>>
  instance?: Record<string, unknown>
  building: boolean
}

/**
 * The registry lives in the shared `@glaze/store` module. Every component
 * bundle may contain its own copy of the store definition module, but all of
 * them call this same `defineStore`, so `useStore()` still returns one
 * instance for the whole mini-program.
 */
const registry = new Map<string, StoreEntry>()

/**
 * Define a lazy, app-wide store from a Solid setup function.
 *
 * ```ts
 * export const useTodos = defineStore('todos', () => {
 *   let nextId = 0
 *   const [state, setState] = createStore({ items: [] as Todo[] })
 *   const remaining = createMemo(() => state.items.filter((item) => !item.done).length)
 *   const add = (title: string) =>
 *     setState((draft) => {
 *       draft.items.push({ id: nextId++, title, done: false })
 *     })
 *   return { state, remaining, add }
 * })
 * ```
 *
 * The setup runs once, on the first `useStore()` call, inside a detached
 * `createRoot`, so a store is not disposed when the component that first read
 * it detaches. Call `store.$dispose()` to drop it (tests and HMR).
 */
export function defineStore<Id extends string, T extends object>(
  id: Id,
  setup: StoreSetup<T>,
): StoreDefinition<T, Id> {
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('[glaze] defineStore requires a non-empty string id')
  }
  if (typeof setup !== 'function') {
    throw new Error(`[glaze] defineStore("${id}") requires a setup function`)
  }

  let entry = registry.get(id)
  if (!entry) {
    entry = {
      setup: setup as StoreSetup<Record<string, unknown>>,
      building: false,
    }
    registry.set(id, entry)
  } else if (!entry.instance) {
    // A duplicate definition from a second component bundle replaces the
    // pending setup. Once an instance exists its definition is authoritative.
    entry.setup = setup as StoreSetup<Record<string, unknown>>
  }
  const current = entry

  const useStore = () => {
    if (current.instance) return current.instance as GlazeStore<T, Id>
    if (current.building) {
      throw new Error(`[glaze] circular store dependency: "${id}"`)
    }
    current.building = true
    let instance: GlazeStore<T, Id> | undefined
    try {
      createRoot((rootDispose) => {
        const store = current.setup()
        if (!store || typeof store !== 'object' || Array.isArray(store)) {
          throw new Error(`[glaze] store "${id}" setup must return an object`)
        }
        if ('$id' in store || '$dispose' in store) {
          throw new Error(`[glaze] store "${id}" cannot return $id or $dispose`)
        }
        const value = store as GlazeStore<T, Id>
        Object.defineProperty(value, '$id', {
          value: id,
          enumerable: false,
          configurable: false,
        })
        Object.defineProperty(value, '$dispose', {
          value: () => {
            if (current.instance !== value) return
            current.instance = undefined
            rootDispose()
          },
          enumerable: false,
          configurable: false,
        })
        instance = value
        return rootDispose
      })
      current.instance = instance!
      return instance!
    } finally {
      current.building = false
    }
  }

  Object.defineProperty(useStore, '$id', {
    value: id,
    enumerable: true,
    configurable: false,
  })
  return useStore as StoreDefinition<T, Id>
}
