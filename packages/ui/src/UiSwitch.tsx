import { createSignal } from 'solid-js'

type SwitchProps = {
  checked?: boolean
  defaultChecked?: boolean
  disabled?: boolean
  hoverClass?: string
  onCheckedChange?: (checked: boolean) => void
}

export default function UiSwitch(props: SwitchProps) {
  const [internal, setInternal] = createSignal<boolean | undefined>(undefined)
  const checked = () => props.checked ?? internal() ?? props.defaultChecked === true
  return (
    <button
      type="button"
      role="switch"
      class={
        'glaze-switch ' +
        (checked() ? 'glaze-switch--on' : 'glaze-switch--off') +
        (props.disabled ? ' glaze-switch--disabled' : '')
      }
      disabled={props.disabled}
      hover-class={props.hoverClass ?? 'glaze-switch--hover'}
      data-slot="switch"
      data-state={checked() ? 'checked' : 'unchecked'}
      aria-checked={checked() ? 'true' : 'false'}
      onClick={() => {
        if (props.disabled) return
        const next = !checked()
        if (props.checked === undefined) setInternal(next)
        props.onCheckedChange?.(next)
      }}
    >
      <view class="glaze-switch__thumb" />
    </button>
  )
}
