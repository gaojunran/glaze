import Badge from './Badge'

type NestedProps = {
  title: string
}

export default function Nested(props: NestedProps) {
  return (
    <view class="nested">
      <text class="nested-title">{props.title}</text>
      <Badge label="badge from relative import" />
    </view>
  )
}
