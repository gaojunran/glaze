import { createSignal, For } from 'solid-js'
import PropShapeRow from './PropShapeRow'
import { bumpProps, createPropRows } from './propBench'

export default function BenchProps4() {
  const [rows, setRows] = createSignal(createPropRows())
  let tick = 0

  const updateFirst = () => {
    tick += 1
    setRows((items) => items.map((row, index) => (index === 0 ? bumpProps(row, tick, 4) : row)))
  }

  const updateAll = () => {
    tick += 1
    setRows((items) => items.map((row) => bumpProps(row, tick, 4)))
  }

  return (
    <view class="bench">
      <text id="last">{rows()[499].p4}</text>
      <button id="update" class="update" onClick={updateFirst}>update</button>
      <button id="update-all" class="update-all" onClick={updateAll}>update all</button>
      <view class="list">
        <For each={rows()} keyed={(row) => row.id}>
          {(row) => (
            <PropShapeRow class="row-card" p1={row().p1} p2={row().p2} p3={row().p3} p4={row().p4} />
          )}
        </For>
      </view>
    </view>
  )
}
