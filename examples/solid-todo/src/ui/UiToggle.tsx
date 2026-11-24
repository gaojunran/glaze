type ToggleProps = {
  pressed?: boolean
  disabled?: boolean
  onPressedChange?: (pressed: boolean) => void
}

export default function UiToggle(props: ToggleProps) {
  return (
    <button
      type="button"
      class={
        'glaze-toggle ' +
        (props.pressed ? 'glaze-toggle--on' : 'glaze-toggle--off') +
        (props.disabled ? ' glaze-toggle--disabled' : '')
      }
      disabled={props.disabled}
      data-slot="toggle"
      data-state={props.pressed ? 'on' : 'off'}
      aria-pressed={props.pressed ? 'true' : 'false'}
      onClick={() => {
        if (!props.disabled) props.onPressedChange?.(!props.pressed)
      }}
    >
      <slot />
    </button>
  )
}
