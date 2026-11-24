type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
type ButtonSize = 'sm' | 'md' | 'lg'

type ButtonProps = {
  variant?: ButtonVariant
  size?: ButtonSize
  block?: boolean
  disabled?: boolean
  loading?: boolean
  onPress?: (event: unknown) => void
}

export default function UiButton(props: ButtonProps) {
  return (
    <button
      type="button"
      class={
        'glaze-button' +
        ' glaze-button--' +
        (props.variant ?? 'secondary') +
        ' glaze-button--' +
        (props.size ?? 'md') +
        (props.block ? ' glaze-button--block' : '') +
        (props.disabled || props.loading ? ' glaze-button--disabled' : '')
      }
      disabled={props.disabled || props.loading}
      loading={props.loading}
      data-slot="button"
      data-state={props.loading ? 'loading' : props.disabled ? 'disabled' : 'idle'}
      onClick={props.onPress}
    >
      <slot />
    </button>
  )
}
