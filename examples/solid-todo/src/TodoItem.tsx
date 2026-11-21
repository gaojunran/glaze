type TodoItemProps = {
  title: string
  done: boolean
}

export default function TodoItem(props: TodoItemProps) {
  return (
    <view class="item">
      <text class={props.done ? 'item-title done' : 'item-title'}>{props.title}</text>
    </view>
  )
}
