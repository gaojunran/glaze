import { useContext } from 'solid-js'
import { Palette, Theme } from './theme'

export default function ContextBoundary() {
  const theme = useContext(Theme)
  const palette = useContext(Palette)
  return (
    <view>
      <slot />
      <text class="context-boundary">{theme}</text>
      <text class="context-color">{palette.color}</text>
    </view>
  )
}
