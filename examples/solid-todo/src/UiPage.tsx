import { createSignal } from 'solid-js'
import UiButton from '@glaze/ui/button'
import UiCheckbox from '@glaze/ui/checkbox'
import UiCollapsible from '@glaze/ui/collapsible'
import UiDialog from '@glaze/ui/dialog'
import UiField from '@glaze/ui/field'
import UiInput from '@glaze/ui/input'
import UiRadio from '@glaze/ui/radio'
import UiSwitch from '@glaze/ui/switch'
import UiTabs from '@glaze/ui/tabs'
import UiToggle from '@glaze/ui/toggle'

export default function UiPage() {
  const [clicks, setClicks] = createSignal(0)
  const [pressed, setPressed] = createSignal(false)
  const [checked, setChecked] = createSignal(true)
  const [name, setName] = createSignal('Ada')
  const [loading, setLoading] = createSignal(false)
  const [dialogOpen, setDialogOpen] = createSignal(false)
  const [subscribed, setSubscribed] = createSignal(true)
  const [plan, setPlan] = createSignal('basic')
  const [tab, setTab] = createSignal('account')
  const [faqOpen, setFaqOpen] = createSignal(true)
  const tabs = [
    { value: 'account', label: 'Account' },
    { value: 'billing', label: 'Billing' },
    { value: 'security', label: 'Security', disabled: true },
  ]

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
          <UiSwitch id="ui-switch" checked={checked()} onCheckedChange={setChecked} />
          <text class="ui-value ui-switch-state">{checked() ? 'on' : 'off'}</text>
        </view>
      </view>

      <view class="ui-section">
        <text class="ui-section-title">Uncontrolled</text>
        <view class="ui-row">
          <UiToggle id="ui-toggle-uncontrolled" defaultPressed>
            Uncontrolled toggle
          </UiToggle>
          <UiSwitch id="ui-switch-uncontrolled" defaultChecked />
        </view>
      </view>

      <view class="ui-section">
        <text class="ui-section-title">Selection</text>
        <view class="ui-row">
          <UiCheckbox id="ui-checkbox" checked={subscribed()} onCheckedChange={setSubscribed}>
            Subscribe to updates
          </UiCheckbox>
          <text class="ui-value ui-checkbox-state">{subscribed() ? 'checked' : 'unchecked'}</text>
        </view>
        <view class="ui-row">
          <UiCheckbox disabled>Disabled choice</UiCheckbox>
          <UiCheckbox defaultChecked>Uncontrolled choice</UiCheckbox>
        </view>
        <view class="ui-row">
          <UiRadio
            id="ui-radio-basic"
            checked={plan() === 'basic'}
            onCheckedChange={() => setPlan('basic')}
          >
            Basic
          </UiRadio>
          <UiRadio
            id="ui-radio-pro"
            checked={plan() === 'pro'}
            onCheckedChange={() => setPlan('pro')}
          >
            Pro
          </UiRadio>
          <text class="ui-value ui-plan-state">{plan()}</text>
        </view>
      </view>

      <view class="ui-section">
        <text class="ui-section-title">Tabs</text>
        <UiTabs id="ui-tabs" items={tabs} value={tab()} onValueChange={setTab} />
        <text class="ui-value ui-tab-state">{tab()}</text>
      </view>

      <view class="ui-section">
        <text class="ui-section-title">Collapsible</text>
        <UiCollapsible
          id="ui-collapsible"
          title="Account settings"
          open={faqOpen()}
          onOpenChange={setFaqOpen}
        >
          <text class="ui-collapsible-body">Profile, email and password settings.</text>
        </UiCollapsible>
        <UiCollapsible title="Billing settings" defaultOpen>
          <text class="ui-collapsible-body">Invoices and payment methods.</text>
        </UiCollapsible>
      </view>

      <view class="ui-section">
        <text class="ui-section-title">Dialog</text>
        <UiButton id="ui-dialog-open" onPress={() => setDialogOpen(true)}>
          Open dialog
        </UiButton>
        <UiDialog
          id="ui-dialog"
          open={dialogOpen()}
          onOpenChange={setDialogOpen}
          title="Dialog title"
          description="Rendered as a fixed overlay without a portal."
        >
          <text class="ui-dialog-body">Dialog body content</text>
        </UiDialog>
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
          <UiInput
            id="ui-input"
            value={name()}
            placeholder="Your name"
            onValueChange={setName}
          />
        </UiField>
        <text class="ui-value ui-name">{name()}</text>
      </view>
    </view>
  )
}
