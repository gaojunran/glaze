type CamelLabelProps = {
  userName: string
}

export default function CamelLabel(props: CamelLabelProps) {
  return (
    <view class="camel-label">
      <text>{props.userName}</text>
      <slot />
    </view>
  )
}
