import { createSignal, For } from 'solid-js'
import TodoItem from './TodoItem'

type Todo = {
  id: number
  title: string
  done: boolean
}

export default function TodoPage() {
  const [todos, setTodos] = createSignal<Todo[]>([
    { id: 1, title: 'Write a page', done: false },
    { id: 2, title: 'Compile it', done: false },
  ])

  const toggle = (id: number) =>
    setTodos((items) =>
      items.map((item) => (item.id === id ? { ...item, done: !item.done } : item)),
    )

  const append = () =>
    setTodos((items) => [
      ...items,
      { id: items.length + 1, title: `Item ${items.length + 1}`, done: false },
    ])

  return (
    <view class="page">
      <text class="title">Todos</text>
      <button class="append" onClick={append}>append</button>
      <For each={todos()} keyed={(todo) => todo.id}>
        {(todo) => (
          <TodoItem
            title={todo().title}
            done={todo().done}
            onToggle={() => toggle(todo().id)}
          />
        )}
      </For>
    </view>
  )
}
