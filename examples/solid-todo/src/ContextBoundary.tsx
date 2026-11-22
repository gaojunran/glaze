import { useContext } from 'solid-js'
import { Theme } from './theme'

export default function ContextBoundary() {
  const theme = useContext(Theme)
  return <view><slot /><text class="context-boundary">{theme}</text></view>
}
