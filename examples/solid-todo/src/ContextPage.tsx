import { createSignal } from 'solid-js'
import { Palette, Theme } from './theme'
import ContextBoundary from './ContextBoundary'

export default function ContextPage() {
  const [color, setColor] = createSignal('light')
  return (
    <view class="page context-page">
      <text class="title">Context boundary</text>
      <button class="context-toggle" onClick={() => setColor(color() === 'light' ? 'dark' : 'light')}>
        toggle palette
      </button>
      <Theme.Provider value="cross-file">
        <Palette.Provider value={{ get color() { return color() }, background: 'white' }}>
          <ContextBoundary />
        </Palette.Provider>
      </Theme.Provider>
    </view>
  )
}
