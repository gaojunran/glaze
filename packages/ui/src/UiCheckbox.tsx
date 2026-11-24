import { createSignal } from 'solid-js'

type CheckboxProps = {
  checked?: boolean
  defaultChecked?: boolean
  disabled?: boolean
  hoverClass?: string
  onCheckedChange?: (checked: boolean) => void
}

export default function UiCheckbox(props: CheckboxProps) {
  const [internal, setInternal] = createSignal<boolean | undefined>(undefined)
  const checked = () => props.checked ?? internal() ?? props.defaultChecked === true
  return (
    <view
      class={
        'glaze-checkbox ' +
        (checked() ? 'glaze-checkbox--on' : 'glaze-checkbox--off') +
        (props.disabled ? ' glaze-checkbox--disabled' : '')
      }
      role="checkbox"
      aria-checked={checked() ? 'true' : 'false'}
      data-slot="checkbox"
      data-state={checked() ? 'checked' : 'unchecked'}
      hover-class={props.disabled ? 'none' : (props.hoverClass ?? 'glaze-checkbox--hover')}
      onClick={() => {
        if (props.disabled) return
        const next = !checked()
        if (props.checked === undefined) setInternal(next)
        props.onCheckedChange?.(next)
      }}
    >
      <view class="glaze-checkbox__indicator">
        {checked() ? <text class="glaze-checkbox__mark">✓</text> : null}
      </view>
      <slot />
    </view>
  )
}
