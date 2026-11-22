import { createSignal } from 'solid-js'

type BenchEdgeEventRowProps = {
  rowId: number
  onPick?: (id: number) => void
}

export default function BenchEdgeEventRow(props: BenchEdgeEventRowProps) {
  const [clicks, setClicks] = createSignal(0)

  const pick = () => {
    setClicks((value) => value + 1)
    props.onPick?.(props.rowId)
  }

  return (
    <view class="event-row">
      <text class="event-count">{clicks()}</text>
      <button class="pick" onClick={pick}>
        pick
      </button>
    </view>
  )
}
