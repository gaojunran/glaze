import { createSignal } from 'solid-js'

type Row = {
  id: number
  a: string
  b: string
  c: string
  d: string
  e: string
  f: string
  g: string
  h: string
}

export default function PropsRowObject(props: { row: Row }) {
  const [count] = createSignal(0)

  return (
    <view class="row-card">
      <text class="row-title">{props.row.a}</text>
      <text class="prop">{props.row.b}</text>
      <text class="prop">{props.row.c}</text>
      <text class="prop">{props.row.d}</text>
      <text class="prop">{props.row.e}</text>
      <text class="prop">{props.row.f}</text>
      <text class="prop">{props.row.g}</text>
      <text class="prop">{props.row.h}</text>
      <text class="row-done">{count()}</text>
    </view>
  )
}
