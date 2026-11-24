import { For } from 'solid-js'
import StorePanel from './StorePanel'
import { useTodoStore } from './stores/todos'

export default function StorePage() {
  const todos = useTodoStore()

  return (
    <view class="store-page">
      <text class="store-title">Glaze store</text>
      <text class="store-count">{todos.total()}</text>
      <text class="store-remaining">{todos.remaining()}</text>
      <StorePanel />
      <button class="store-add" onClick={() => todos.add('Store three')}>
        add
      </button>
      <For each={todos.state.items} keyed={(item) => item.id}>
        {(item) => (
          <view class="store-row">
            <text class="store-row-title">{item.title}</text>
            <text class="store-row-state">{item.done ? 'done' : 'open'}</text>
            <button class="store-toggle" onClick={() => todos.toggle(item.id)}>
              toggle
            </button>
          </view>
        )}
      </For>
      <text class="store-empty">{todos.total() === 0 ? 'empty store' : ''}</text>
      <button class="store-clear" onClick={() => todos.clear()}>
        clear done
      </button>
    </view>
  )
}
