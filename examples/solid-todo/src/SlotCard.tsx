export default function SlotCard() {
  return (
    <view class="slot-card">
      <slot name="header" />
      <slot />
    </view>
  )
}
