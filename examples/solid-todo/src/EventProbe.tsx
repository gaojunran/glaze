type EventProbeProps = {
  onPing?: () => void
  name: string
}

export default function EventProbe(props: EventProbeProps) {
  return (
    <view class={`event-probe ${props.name}`}>
      <slot />
      <button class={`event-ping ${props.name}`} onClick={() => props.onPing?.()}>
        {props.name}
      </button>
    </view>
  )
}
