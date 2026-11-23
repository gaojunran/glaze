import { createSignal } from 'solid-js'
import ContextChild from './ContextChild'
import { Palette, Theme } from './theme'

export default function ContextDemo() {
  const [color, setColor] = createSignal('light')

  return (
    <view class="page">
      <button
        class="toggle"
        onClick={() => setColor(color() === 'light' ? 'dark' : 'light')}
      >
        toggle color
      </button>

      <Theme.Provider value="cross-file">
        <Palette.Provider
          value={{
            get color() {
              return color()
            },
            background: 'white',
          }}
        >
          <ContextChild />
        </Palette.Provider>
      </Theme.Provider>
    </view>
  )
}
