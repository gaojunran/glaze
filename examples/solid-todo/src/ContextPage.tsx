import { createSignal } from 'solid-js'
import { Palette, Theme } from './theme'
import ContextBoundary from './ContextBoundary'

export default function ContextPage() {
  const [color, setColor] = createSignal('light')
  const [themeName, setThemeName] = createSignal('cross-file')
  return (
    <view class="page context-page">
      <text class="title">Context boundary</text>
      <button
        class="context-toggle"
        onClick={() => {
          setColor(color() === 'light' ? 'dark' : 'light')
          setThemeName(themeName() === 'cross-file' ? 'dark-file' : 'cross-file')
        }}
      >
        toggle palette
      </button>
      <Theme.Provider value={themeName()}>
        <Palette.Provider value={{ get color() { return color() }, background: 'white' }}>
          <ContextBoundary />
        </Palette.Provider>
      </Theme.Provider>
    </view>
  )
}
