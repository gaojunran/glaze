type FieldProps = {
  label: string
  description?: string
  error?: string
  required?: boolean
}

export default function UiField(props: FieldProps) {
  return (
    <view class="glaze-field" data-slot="field">
      <text class="glaze-field__label">
        {props.label}
        {props.required ? ' *' : ''}
      </text>
      {props.description ? (
        <text class="glaze-field__description">{props.description}</text>
      ) : null}
      <slot />
      {props.error ? <text class="glaze-field__error">{props.error}</text> : null}
    </view>
  )
}
