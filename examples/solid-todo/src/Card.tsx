type CardProps = {
  title: string
  children?: unknown
}

export default function Card(props: CardProps) {
  return (
    <view class="card">
      <text class="card-title">{props.title}</text>
      {props.children}
    </view>
  )
}
