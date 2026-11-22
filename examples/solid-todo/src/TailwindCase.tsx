export default function TailwindCase() {
  return (
    <view class="p-4 bg-red-500">
      <text class="tw-title text-[24rpx] font-bold text-white">Tailwind in Glaze</text>
      <view class="mt-2 rounded bg-blue-500 p-2">
        <text class="text-[18rpx] text-white">escaped arbitrary value</text>
      </view>
      <view class="tw-static mt-2 h-[20rpx] w-[120rpx] bg-green-500" />
    </view>
  )
}
