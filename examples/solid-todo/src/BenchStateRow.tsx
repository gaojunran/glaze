import { createSignal } from 'solid-js'

export default function BenchStateRow() {
  const [count, setCount] = createSignal(0)

  return (
    <view class="bench-state-row">
      <text class="state-title">Stateful row</text>
      <text class="state-count">{count()}</text>
      <button class="state-bump" onClick={() => setCount((value) => value + 1)}>
        bump
      </button>
    </view>
  )
}
