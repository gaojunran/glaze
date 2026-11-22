type BenchRowProps = {
  title: string
  done: boolean
}

export default function BenchRow(props: BenchRowProps) {
  return (
    <view class="bench-row">
      <text class="pure-title">{props.title}</text>
      <text class={{ 'pure-state': true, done: props.done }}>
        {props.done ? 'done' : 'todo'}
      </text>
    </view>
  )
}
