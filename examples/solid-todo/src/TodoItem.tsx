type TodoItemProps = {
  title: string
  done: boolean
  onToggle?: () => void
}

export default function TodoItem(props: TodoItemProps) {
  return (
    <view class="item">
      <text
        class={props.done ? 'item-title done' : 'item-title'}
        onClick={() => props.onToggle?.()}
      >
        {props.title}
      </text>
    </view>
  )
}
