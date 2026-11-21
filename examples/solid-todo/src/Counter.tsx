import { createSignal, For, Show } from 'solid-js'

type Todo = {
  id: number
  title: string
  done: boolean
}

export default function Counter() {
  const [count, setCount] = createSignal(0)
  const [todos] = createSignal<Todo[]>([
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

      <view class="list">
        <For each={todos()} key="id">
          {(todo) => (
            <view class="item">
              <text class={todo.done ? 'item-title done' : 'item-title'}>{todo.title}</text>
            </view>
          )}
        </For>
      </view>

      <text class="footer">tap + to update the count</text>
    </view>
  )
}
