type TodoItemProps = {
  title: string
  done: boolean
  onToggle?: () => void
}

export default function TodoItem(props: TodoItemProps) {
  return (
    <view class="todo-item">
      <text class={props.done ? 'done' : ''} onClick={() => props.onToggle?.()}>
        {props.title}
      </text>
    </view>
  )
}
