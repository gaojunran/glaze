type TodoItemProps = {
  title: string
  done: boolean
  onToggle?: () => void
}

export default function TodoItem(props: TodoItemProps) {
  return (
    <view class="item">
      <text
        class={{ 'item-title': true, done: props.done }}
        onClick={() => props.onToggle?.()}
      >
        {props.title}
      </text>
    </view>
  )
}
