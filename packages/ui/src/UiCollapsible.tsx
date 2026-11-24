import { Show, createSignal } from 'solid-js'

type CollapsibleProps = {
  title: string
  open?: boolean
  defaultOpen?: boolean
  disabled?: boolean
  onOpenChange?: (open: boolean) => void
}

export default function UiCollapsible(props: CollapsibleProps) {
  const [internal, setInternal] = createSignal<boolean | undefined>(undefined)
  const open = () => props.open ?? internal() ?? props.defaultOpen === true
  return (
    <view class="glaze-collapsible" data-slot="collapsible" data-state={open() ? 'open' : 'closed'}>
      <button
        type="button"
        class={
          'glaze-collapsible__trigger' +
          (props.disabled ? ' glaze-collapsible__trigger--disabled' : '')
        }
        aria-expanded={open() ? 'true' : 'false'}
        disabled={props.disabled}
        onClick={() => {
          if (props.disabled) return
          const next = !open()
          if (props.open === undefined) setInternal(next)
          props.onOpenChange?.(next)
        }}
      >
        <text class="glaze-collapsible__title">{props.title}</text>
        <text class="glaze-collapsible__icon">{open() ? '−' : '+'}</text>
      </button>
      {/* @ts-expect-error Solid 2 types children as a required prop on Show */}
      <Show when={open()}>
        {() => (
          <view class="glaze-collapsible__content">
            <slot />
          </view>
        )}
      </Show>
    </view>
  )
}
