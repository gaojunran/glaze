import { createSignal, For } from 'solid-js'
import BenchRow from './BenchRow'
import BenchStateRow from './BenchStateRow'

const ROWS = Array.from({ length: 1000 }, (_, index) => ({
  id: index,
  title: `Item ${index}`,
  done: false,
}))

const STATE_ROWS = Array.from({ length: 1000 }, (_, index) => ({ id: index }))

export default function BenchComponents() {
  const [rows, setRows] = createSignal(ROWS)
  let nextId = ROWS.length

  const updateFirst = () =>
    setRows((items) =>
      items.map((item, index) =>
        index === 0 ? { ...item, done: !item.done } : item,
      ),
    )

  const appendRow = () =>
    setRows((items) => [
      ...items,
      { id: nextId, title: `Appended ${nextId++}`, done: false },
    ])

  return (
    <view class="bench">
      <view class="bar">
        <button class="update-row" onClick={updateFirst}>
          update
        </button>
        <button class="append-row" onClick={appendRow}>
          append
        </button>
        <button class="delete-row" onClick={() => setRows((items) => items.slice(1))}>
          delete
        </button>
      </view>
      <view class="list">
        <For each={rows()} keyed={(row) => row.id}>
          {(row) => (
            <BenchRow class="pure-row" title={row().title} done={row().done} />
          )}
        </For>
      </view>
      <view class="list">
        <For each={STATE_ROWS} keyed={(row) => row.id}>
          {() => <BenchStateRow class="state-row" />}
        </For>
      </view>
    </view>
  )
}
