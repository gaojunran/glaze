import { createSignal } from 'solid-js'

type InputType = 'text' | 'number' | 'idcard' | 'digit'

type InputProps = {
  value?: string
  placeholder?: string
  type?: InputType
  disabled?: boolean
  onValueChange?: (value: string) => void
}

export default function UiInput(props: InputProps) {
  const [focused, setFocused] = createSignal(false)
  return (
    <input
      class={'glaze-input' + (props.disabled ? ' glaze-input--disabled' : '')}
      data-slot="input"
      value={props.value}
      placeholder={props.placeholder}
      type={props.type ?? 'text'}
      disabled={props.disabled}
      data-focused={focused() ? 'true' : 'false'}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onInput={(event: { detail: { value: string } }) =>
        props.onValueChange?.(event.detail.value)
      }
    />
  )
}
