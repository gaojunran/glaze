type PropProbeProps = {
  count: number
  label: string
}

export default function PropProbe(props: PropProbeProps) {
  return (
    <view class="prop-probe">
      <text class="prop-count">{props.count + 1}</text>
      <text class="prop-label">{props.label}</text>
      <slot />
    </view>
  )
}
