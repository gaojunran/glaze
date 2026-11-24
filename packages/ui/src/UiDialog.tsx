import { createSignal, Show } from 'solid-js'

type DialogProps = {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  title?: string
  description?: string
  closeOnMask?: boolean
}

export default function UiDialog(props: DialogProps) {
  const [internal, setInternal] = createSignal<boolean | undefined>(undefined)
  const open = () => props.open ?? internal() ?? props.defaultOpen === true
  const change = (next: boolean) => {
    if (props.open === undefined) setInternal(next)
    props.onOpenChange?.(next)
  }
  return (
    // @ts-expect-error Solid 2 types children as a required prop on Show
    <Show when={open()}>
      {() => (
        <view class="glaze-dialog" data-slot="dialog">
          <view
            class="glaze-dialog__mask"
            onClick={() => {
              if (props.closeOnMask !== false) change(false)
            }}
            onTouchMoveCatch={() => {}}
          />
          <view
            class="glaze-dialog__panel"
            role="dialog"
            aria-modal="true"
            onTouchMoveCatch={() => {}}
          >
            {props.title ? (
              <text class="glaze-dialog__title">{props.title}</text>
            ) : null}
            {props.description ? (
              <text class="glaze-dialog__description">{props.description}</text>
            ) : null}
            <scroll-view class="glaze-dialog__body" scroll-y>
              <slot />
            </scroll-view>
            <button class="glaze-dialog__close" onClick={() => change(false)}>
              Close
            </button>
          </view>
        </view>
      )}
    </Show>
  )
}
