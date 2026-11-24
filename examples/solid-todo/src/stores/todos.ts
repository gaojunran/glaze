import { createMemo, createStore } from 'solid-js'
import { defineStore } from '@glaze/store'

export type Todo = {
  id: number
  title: string
  done: boolean
}

export const useTodoStore = defineStore('todos', () => {
  const [state, setState] = createStore<{ items: Todo[] }>({
    items: [
      { id: 1, title: 'Store one', done: false },
      { id: 2, title: 'Store two', done: true },
    ],
  })
  let nextId = 3

  const total = createMemo(() => state.items.length)
  const remaining = createMemo(() => state.items.filter((item) => !item.done).length)
  const add = (title: string) =>
    setState((draft) => {
      draft.items.push({ id: nextId++, title, done: false })
    })
  const toggle = (id: number) =>
    setState((draft) => {
      const item = draft.items.find((entry) => entry.id === id)
      if (item) item.done = !item.done
    })
  const clear = () =>
    setState((draft) => {
      draft.items = draft.items.filter((item) => !item.done)
    })

  return { state, total, remaining, add, toggle, clear }
})
