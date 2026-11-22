import { Theme } from './theme'
import ContextBoundary from './ContextBoundary'

export default function ContextPage() {
  return (
    <view class="page context-page">
      <text class="title">Context boundary</text>
      <Theme.Provider value="cross-file">
        <ContextBoundary />
      </Theme.Provider>
    </view>
  )
}
