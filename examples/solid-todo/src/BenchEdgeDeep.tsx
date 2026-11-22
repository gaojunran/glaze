import { createSignal, For, Show } from 'solid-js'
import BenchEdgeDeepChild from './BenchEdgeDeep'

const LAST_LEVEL = 9

type BenchEdgeDeepProps = {
  level: number
}

export default function BenchEdgeDeep(props: BenchEdgeDeepProps) {
  const [count, setCount] = createSignal(0)

  return (
    <view class="deep-node">
      <text class="deep-label">L{props.level}</text>
      <Show when={props.level === LAST_LEVEL}>
        <text class="deep-count">{count()}</text>
        <button class="deep-bump" onClick={() => setCount((value) => value + 1)}>
          bump
        </button>
      </Show>
      <For each={props.level < LAST_LEVEL ? [props.level + 1] : []} keyed={false}>
        {(next) => <BenchEdgeDeepChild class="deep-host" level={next()} />}
      </For>
    </view>
  )
}
