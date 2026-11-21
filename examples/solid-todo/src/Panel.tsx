import { onSettled } from 'solid-js'

type PanelProps = {
  auto?: boolean
  onToggle?: () => void
}

export default function Panel(props: PanelProps) {
  onSettled(() => {
    if (props.auto) props.onToggle?.()
  })

  return (
    <view class="panel" onClick={() => props.onToggle?.()}>
      <slot />
    </view>
  )
}
