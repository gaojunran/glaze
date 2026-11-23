import { useContext } from 'solid-js'
import { Palette, Theme } from './theme'

export default function ContextChild() {
  const theme = useContext(Theme)
  const palette = useContext(Palette)

  return (
    <view class="context-child">
      <text class="theme">{theme}</text>
      <text class="color">{palette.color}</text>
    </view>
  )
}
