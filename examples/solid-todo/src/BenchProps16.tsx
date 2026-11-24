import { createSignal, For } from 'solid-js'
import PropShapeRow from './PropShapeRow'
import { bumpProps, createPropRows } from './propBench'

export default function BenchProps16() {
  const [rows, setRows] = createSignal(createPropRows())
  let tick = 0

  const updateFirst = () => {
    tick += 1
    setRows((items) => items.map((row, index) => (index === 0 ? bumpProps(row, tick, 16) : row)))
  }

  const updateAll = () => {
    tick += 1
    setRows((items) => items.map((row) => bumpProps(row, tick, 16)))
  }

  return (
    <view class="bench">
      <text id="last">{rows()[499].p16}</text>
      <button id="update" class="update" onClick={updateFirst}>update</button>
      <button id="update-all" class="update-all" onClick={updateAll}>update all</button>
      <view class="list">
        <For each={rows()} keyed={(row) => row.id}>
          {(row) => (
            <PropShapeRow
              class="row-card"
              p1={row().p1} p2={row().p2} p3={row().p3} p4={row().p4}
              p5={row().p5} p6={row().p6} p7={row().p7} p8={row().p8}
              p9={row().p9} p10={row().p10} p11={row().p11} p12={row().p12}
              p13={row().p13} p14={row().p14} p15={row().p15} p16={row().p16}
            />
          )}
        </For>
      </view>
    </view>
  )
}
