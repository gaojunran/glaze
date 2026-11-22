export default function PureComponentRow(props: { title: string; index: number }) {
  return (
    <view class="row-card">
      <text class="row-title">{props.title}</text>
      <text class="row-index">{props.index}</text>
    </view>
  )
}
