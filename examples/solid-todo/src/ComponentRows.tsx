import { createSignal, For } from 'solid-js'
import ComponentRow from './ComponentRow'

const ROWS = Array.from({ length: 500 }, (_, index) => ({
  id: index,
  title: `Row ${index}`,
}))

export default function ComponentRows() {
  const [rows, setRows] = createSignal(ROWS)
  const [tick, setTick] = createSignal(0)

  const updateFirst = () => {
    const nextTick = tick() + 1
    setTick(nextTick)
    setRows((items) => items.map((row, index) => (
      index === 0 ? { ...row, title: `Row 0 ${nextTick}` } : row
    )))
  }

  const updateAll = () => {
    const nextTick = tick() + 1
    const suffix = `${nextTick}-${Date.now() % 100000}`
    setTick(nextTick)
    setRows((items) => items.map((row) => ({ ...row, title: `${row.title.split(' ').slice(0, 2).join(' ')} ${suffix}` })))
  }

  return (
    <view class="bench">
      <text id="tick">{tick()}</text>
      <text id="title">{rows()[0].title}</text>
      <text id="last">{rows()[499].title}</text>
      <button id="update" class="update" onClick={updateFirst}>update</button>
      <button id="update-all" class="update-all" onClick={updateAll}>update all</button>
      <For each={rows()} keyed={(row) => row.id}>
        {(row) => <ComponentRow class="row-card" title={row().title} index={row().id} />}
      </For>
    </view>
  )
}
