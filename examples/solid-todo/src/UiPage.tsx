import { createSignal } from 'solid-js'
import UiButton from './ui/UiButton'
import UiField from './ui/UiField'
import UiInput from './ui/UiInput'
import UiSwitch from './ui/UiSwitch'
import UiToggle from './ui/UiToggle'

export default function UiPage() {
  const [clicks, setClicks] = createSignal(0)
  const [pressed, setPressed] = createSignal(false)
  const [checked, setChecked] = createSignal(true)
  const [name, setName] = createSignal('Ada')
  const [loading, setLoading] = createSignal(false)

  return (
    <view class="ui-page">
      <text class="ui-title">UI SDK port</text>
      <text class="ui-subtitle">Native Glaze components, same state names.</text>

      <view class="ui-section">
        <text class="ui-section-title">Button</text>
        <view class="ui-row">
          <UiButton
            id="ui-increment"
            variant="primary"
            onPress={() => setClicks((value) => value + 1)}
          >
            Primary
          </UiButton>
          <UiButton variant="ghost">Ghost</UiButton>
          <UiButton variant="secondary" size="sm">
            Small
          </UiButton>
        </view>
        <view class="ui-row">
          <UiButton disabled>Disabled</UiButton>
          <UiButton id="ui-loading" loading={loading()}>
            Loading
          </UiButton>
          <UiButton id="ui-toggle-loading" variant="ghost" onPress={() => setLoading((value) => !value)}>
            Toggle loading
          </UiButton>
        </view>
        <text class="ui-value">clicks: {clicks()}</text>
        <text class="ui-click-count">{clicks()}</text>
        <text class="ui-loading-state">{loading() ? 'loading' : 'idle'}</text>
      </view>

      <view class="ui-section">
        <text class="ui-section-title">Toggle</text>
        <view class="ui-row">
          <UiToggle id="ui-toggle" pressed={pressed()} onPressedChange={setPressed}>
            Focus mode
          </UiToggle>
          <text class="ui-value ui-toggle-state">{pressed() ? 'pressed' : 'released'}</text>
        </view>
      </view>

      <view class="ui-section">
        <text class="ui-section-title">Switch</text>
        <view class="ui-row">
          <UiSwitch checked={checked()} onCheckedChange={setChecked} />
          <text class="ui-value ui-switch-state">{checked() ? 'on' : 'off'}</text>
        </view>
      </view>

      <view class="ui-section">
        <text class="ui-section-title">Field + Input</text>
        <UiField
          id="ui-field"
          label="Display name"
          description="This is a controlled native input."
          required
          error={name().trim() ? '' : 'Name is required'}
        >
          <UiInput value={name()} placeholder="Your name" onValueChange={setName} />
        </UiField>
        <text class="ui-value ui-name">{name()}</text>
      </view>
    </view>
  )
}
