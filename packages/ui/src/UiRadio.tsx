import { createSignal } from 'solid-js'

type RadioProps = {
  checked?: boolean
  defaultChecked?: boolean
  disabled?: boolean
  hoverClass?: string
  onCheckedChange?: (checked: boolean) => void
}

export default function UiRadio(props: RadioProps) {
  const [internal, setInternal] = createSignal<boolean | undefined>(undefined)
  const checked = () => props.checked ?? internal() ?? props.defaultChecked === true
  return (
    <view
      class={
        'glaze-radio ' +
        (checked() ? 'glaze-radio--on' : 'glaze-radio--off') +
        (props.disabled ? ' glaze-radio--disabled' : '')
      }
      role="radio"
      aria-checked={checked() ? 'true' : 'false'}
      data-slot="radio"
      data-state={checked() ? 'checked' : 'unchecked'}
      hover-class={props.disabled ? 'none' : (props.hoverClass ?? 'glaze-radio--hover')}
      onClick={() => {
        if (props.disabled) return
        if (props.checked === undefined) setInternal(true)
        props.onCheckedChange?.(true)
      }}
    >
      <view class="glaze-radio__indicator">
        {checked() ? <view class="glaze-radio__dot" /> : null}
      </view>
      <slot />
    </view>
  )
}
