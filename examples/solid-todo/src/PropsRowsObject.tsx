import { createSignal, For } from 'solid-js'
import PropsRowObject from './PropsRowObject'

const createRows = () => Array.from({ length: 500 }, (_, index) => ({
  id: index,
  a: `r${index}-a`, b: `r${index}-b`, c: `r${index}-c`, d: `r${index}-d`,
  e: `r${index}-e`, f: `r${index}-f`, g: `r${index}-g`, h: `r${index}-h`,
}))

export default function PropsRowsObject() {
  const [rows, setRows] = createSignal(createRows())
  const [tick, setTick] = createSignal(0)

  const rewrite = (row, next) => ({
    ...row,
    a: `r${row.id}-a-${next}`, b: `r${row.id}-b-${next}`, c: `r${row.id}-c-${next}`, d: `r${row.id}-d-${next}`,
    e: `r${row.id}-e-${next}`, f: `r${row.id}-f-${next}`, g: `r${row.id}-g-${next}`, h: `r${row.id}-h-${next}`,
  })

  const updateFirst = () => {
    const next = tick() + 1
    setTick(next)
    setRows((items) => items.map((row, index) => (index === 0 ? rewrite(row, next) : row)))
  }

  const updateAll = () => {
    const next = tick() + 1
    setTick(next)
    setRows((items) => items.map((row) => rewrite(row, next)))
  }

  return (
    <view class="bench">
      <text id="tick">{tick()}</text>
      <text id="title">{rows()[0].a}</text>
      <text id="last">{rows()[499].h}</text>
      <button id="update" class="update" onClick={updateFirst}>update</button>
      <button id="update-all" class="update-all" onClick={updateAll}>update all</button>
      <view class="list">
        <For each={rows()} keyed={(row) => row.id}>
          {(row) => <PropsRowObject class="row-card" row={row()} />}
        </For>
      </view>
    </view>
  )
}
