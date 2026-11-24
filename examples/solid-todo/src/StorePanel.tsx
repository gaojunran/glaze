import { useTodoStore } from './stores/todos'

export default function StorePanel() {
  const todos = useTodoStore()

  return (
    <view class="store-panel">
      <text class="store-panel-label">Panel sees the same store</text>
      <text class="store-panel-count">{todos.total()}</text>
      <text class="store-panel-remaining">{todos.remaining()}</text>
      <button class="store-panel-add" onClick={() => todos.add('Panel row')}>
        add from panel
      </button>
    </view>
  )
}
