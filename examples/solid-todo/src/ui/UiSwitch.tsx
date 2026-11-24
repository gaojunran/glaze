type SwitchProps = {
  checked?: boolean
  disabled?: boolean
  onCheckedChange?: (checked: boolean) => void
}

export default function UiSwitch(props: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      class={
        'glaze-switch ' +
        (props.checked ? 'glaze-switch--on' : 'glaze-switch--off') +
        (props.disabled ? ' glaze-switch--disabled' : '')
      }
      disabled={props.disabled}
      data-slot="switch"
      data-state={props.checked ? 'checked' : 'unchecked'}
      aria-checked={props.checked ? 'true' : 'false'}
      onClick={() => {
        if (!props.disabled) props.onCheckedChange?.(!props.checked)
      }}
    >
      <view class="glaze-switch__thumb" />
    </button>
  )
}
