import { For, createSignal } from 'solid-js'

type TabItem = {
  value: string
  label: string
  disabled?: boolean
}

type TabsProps = {
  items: TabItem[]
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
}

export default function UiTabs(props: TabsProps) {
  const [internal, setInternal] = createSignal<string | undefined>(undefined)
  const selected = () =>
    props.value ?? internal() ?? props.defaultValue ?? props.items?.[0]?.value
  const select = (value: string, disabled?: boolean) => {
    if (disabled) return
    if (props.value === undefined) setInternal(value)
    props.onValueChange?.(value)
  }
  return (
    <scroll-view class="glaze-tabs" scroll-x role="tablist" data-slot="tabs">
      {/* @ts-expect-error Solid 2 types children as a required prop on For */}
      <For each={props.items} keyed={(item: TabItem) => item.value}>
        {(item: () => TabItem) => (
          <button
            type="button"
            class={
              'glaze-tabs__trigger' +
              (selected() === item().value ? ' glaze-tabs__trigger--active' : '') +
              (item().disabled ? ' glaze-tabs__trigger--disabled' : '')
            }
            role="tab"
            aria-selected={selected() === item().value ? 'true' : 'false'}
            disabled={item().disabled}
            data-value={item().value}
            onClick={() => select(item().value, item().disabled)}
          >
            {item().label}
          </button>
        )}
      </For>
    </scroll-view>
  )
}
