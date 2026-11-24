import { createSignal } from 'solid-js'

type ToggleProps = {
  pressed?: boolean
  defaultPressed?: boolean
  disabled?: boolean
  hoverClass?: string
  onPressedChange?: (pressed: boolean) => void
}

export default function UiToggle(props: ToggleProps) {
  const [internal, setInternal] = createSignal<boolean | undefined>(undefined)
  const pressed = () => props.pressed ?? internal() ?? props.defaultPressed === true
  return (
    <button
      type="button"
      class={
        'glaze-toggle ' +
        (pressed() ? 'glaze-toggle--on' : 'glaze-toggle--off') +
        (props.disabled ? ' glaze-toggle--disabled' : '')
      }
      disabled={props.disabled}
      hover-class={props.hoverClass ?? 'glaze-toggle--hover'}
      data-slot="toggle"
      data-state={pressed() ? 'on' : 'off'}
      aria-pressed={pressed() ? 'true' : 'false'}
      onClick={() => {
        if (props.disabled) return
        const next = !pressed()
        if (props.pressed === undefined) setInternal(next)
        props.onPressedChange?.(next)
      }}
    >
      <slot />
    </button>
  )
}
