import { createSignal, For } from 'solid-js'

const ITEMS = Array.from({ length: 1000 }, (_, index) => ({
  id: index,
  title: `Item ${index}`,
}))

export default function Bench() {
  const [tick, setTick] = createSignal(0)
  const [items, setItems] = createSignal(ITEMS)

  const updateFirst = () => {
    const next = tick() + 1
    setTick(next)
    setItems((value) => value.map((item, index) => (
      index === 0 ? { ...item, title: `Item 0 ${next}` } : item
    )))
  }

  return (
    <view class="bench">
      <view class="bar">
        <text class="tick">{tick()}</text>
        <text id="title">{items()[0].title}</text>
        <button class="bump" onClick={() => setTick((value) => value + 1)}>bump</button>
        <button id="update" class="update" onClick={updateFirst}>update</button>
        <button class="reverse" onClick={() => setItems((value) => [...value].reverse())}>
          reverse
        </button>
      </view>
      <view class="list">
        <For each={items()} keyed={(item) => item.id}>
          {(item) => (
            <view class="row">
              <text class="row-title">{item().title}</text>
            </view>
          )}
        </For>
      </view>
    </view>
  )
}
