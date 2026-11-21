import { createSignal, For, Show } from 'solid-js'
import TodoItem from './TodoItem'

type Todo = {
  id: number
  title: string
  done: boolean
}

export default function Counter() {
  const [count, setCount] = createSignal(0)
  const [todos, setTodos] = createSignal<Todo[]>([
    { id: 1, title: 'Compile Solid to WXML', done: true },
    { id: 2, title: 'Run in minidev', done: false },
    { id: 3, title: 'Measure against native', done: false },
  ])

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

      <button
        class="toggle"
        onClick={() =>
          setTodos((items) =>
            items.map((todo, index) =>
              index === 0 ? { ...todo, done: !todo.done } : todo,
            ),
          )
        }
      >
        toggle first
      </button>

      <view class="list">
        <For each={todos()} key="id">
          {(todo) => (
            <view class="item-wrap">
              <TodoItem title={todo.title} done={todo.done} />
              <button
                class="remove"
                onClick={() => setTodos((items) => items.filter((item) => item.id !== todo.id))}
              >
                x
              </button>
            </view>
          )}
        </For>
      </view>

      <text class="footer">tap + to update the count</text>
    </view>
  )
}
