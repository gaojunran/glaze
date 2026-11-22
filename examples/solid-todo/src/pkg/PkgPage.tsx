import { createSignal } from 'solid-js'

export default function PkgPage() {
  const [count, setCount] = createSignal(0)
  return (
    <view class="page pkg-page">
      <text class="pkg-title">Independent subpackage</text>
      <text class="pkg-count">{count()}</text>
      <button class="pkg-inc" onClick={() => setCount((value) => value + 1)}>+</button>
    </view>
  )
}
