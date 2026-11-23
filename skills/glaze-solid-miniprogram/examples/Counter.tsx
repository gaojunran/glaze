import { createSignal, For, Show } from 'solid-js'

type Todo = {
  id: number
  title: string
  done: boolean
}

export default function Counter() {
  const [count, setCount] = createSignal(0)
  const [todos, setTodos] = createSignal<Todo[]>([
    { id: 1, title: 'Compile Solid to WXML', done: true },
    { id: 2, title: 'Run in the simulator', done: false },
  ])

  const toggle = (id: number) =>
    setTodos((items) =>
      items.map((item) => (item.id === id ? { ...item, done: !item.done } : item)),
    )

  return (
    <view class="page">
      <text class="title">Glaze + Solid</text>
      <view class="counter">
        <button class="btn" onClick={() => setCount((value) => value - 1)}>-</button>
        <text class="count">{count()}</text>
        <button class="btn" onClick={() => setCount((value) => value + 1)}>+</button>
      </view>

      <Show when={count() > 3}>
        <text class="hint">count is greater than 3</text>
      </Show>

      <For each={todos()} keyed={(todo) => todo.id}>
        {(todo) => (
          <view class="todo">
            <text class={todo().done ? 'done' : ''}>{todo().title}</text>
            <button class="toggle" onClick={() => toggle(todo().id)}>toggle</button>
          </view>
        )}
      </For>
    </view>
  )
}
