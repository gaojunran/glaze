import { omit } from 'solid-js'

type TodoItemProps = {
  title: string
  done: boolean
  onToggle?: () => void
}

export default function TodoItem(props: TodoItemProps) {
  const rest = omit(props, 'title', 'done')
  return (
    <view class="item">
      <text
        class={{ 'item-title': true, done: props.done }}
        onClick={() => rest.onToggle?.()}
      >
        {props.title}
      </text>
    </view>
  )
}
