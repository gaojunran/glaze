import { createSignal } from 'solid-js'
import {
  useAppVisible,
  useLaunchOptions,
  usePageEvent,
  usePageOptions,
} from '@glaze/runtime'
import { Palette, Theme } from './theme'
import ContextBoundary from './ContextBoundary'

export default function ContextPage() {
  const [color, setColor] = createSignal('light')
  const [themeName, setThemeName] = createSignal('cross-file')
  const appVisible = useAppVisible()
  const launchOptions = useLaunchOptions()
  const pageOptions = usePageOptions()
  const scroll = usePageEvent('scroll')
  return (
    <view class="page context-page">
      <text class="title">Context boundary</text>
      <text class="app-visible">{appVisible() ? 'visible' : 'hidden'}</text>
      <text class="launch-path">{launchOptions() ? launchOptions()!.path || 'set' : 'none'}</text>
      <text class="page-query">{String(pageOptions()?.query?.from ?? 'none')}</text>
      <text class="page-scroll">{scroll() ? scroll()!.scrollTop : 0}</text>
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
      <view class="scroll-spacer" style="height: 1200px" />
    </view>
  )
}
