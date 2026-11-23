import { createSignal } from 'solid-js'

type Props = {
  a: string
  b: string
  c: string
  d: string
  e: string
  f: string
  g: string
  h: string
}

export default function PropsRow(props: Props) {
  const [count] = createSignal(0)

  return (
    <view class="row-card">
      <text class="row-title">{props.a}</text>
      <text class="prop">{props.b}</text>
      <text class="prop">{props.c}</text>
      <text class="prop">{props.d}</text>
      <text class="prop">{props.e}</text>
      <text class="prop">{props.f}</text>
      <text class="prop">{props.g}</text>
      <text class="prop">{props.h}</text>
      <text class="row-done">{count()}</text>
    </view>
  )
}
