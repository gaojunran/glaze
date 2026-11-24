type Props = {
  p1: string
  p2: string
  p3: string
  p4: string
  p5: string
  p6: string
  p7: string
  p8: string
  p9: string
  p10: string
  p11: string
  p12: string
  p13: string
  p14: string
  p15: string
  p16: string
}

// A named declaration keeps this a real component: the compiler otherwise
// inlines pure prop projections inside <For>.
function PropShapeRow(props: Props) {
  return (
    <view class="row-card">
      <text class="row-title">{props.p1 || ''}{props.p2 || ''}{props.p3 || ''}{props.p4 || ''}{props.p5 || ''}{props.p6 || ''}{props.p7 || ''}{props.p8 || ''}{props.p9 || ''}{props.p10 || ''}{props.p11 || ''}{props.p12 || ''}{props.p13 || ''}{props.p14 || ''}{props.p15 || ''}{props.p16 || ''}</text>
    </view>
  )
}

export default PropShapeRow
