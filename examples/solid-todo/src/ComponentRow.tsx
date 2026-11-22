import { createSignal } from 'solid-js'

export default function ComponentRow(props: { title: string; index: number }) {
  const [count, setCount] = createSignal(0)

  return (
    <view class="row-card">
      <text class="row-title">{props.title}</text>
      <text class="row-index">{props.index}</text>
      <text class="row-count">{count()}</text>
      <button class="row-bump" onClick={() => setCount((value) => value + 1)}>
        bump
      </button>
    </view>
  )
}
