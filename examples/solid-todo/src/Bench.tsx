import { createSignal, For } from 'solid-js'

const ITEMS = Array.from({ length: 1000 }, (_, index) => ({
  id: index,
  title: `Item ${index}`,
}))

export default function Bench() {
  const [tick, setTick] = createSignal(0)
  const [items, setItems] = createSignal(ITEMS)

  return (
    <view class="bench">
      <view class="bar">
        <text class="tick">{tick()}</text>
        <button class="bump" onClick={() => setTick((value) => value + 1)}>bump</button>
        <button class="reverse" onClick={() => setItems((value) => [...value].reverse())}>
          reverse
        </button>
      </view>
      <view class="list">
        <For each={items()} key="id">
          {(item) => (
            <view class="row">
              <text class="row-title">{item.title}</text>
            </view>
          )}
        </For>
      </view>
    </view>
  )
}
