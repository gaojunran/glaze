import { createSignal, For } from 'solid-js'

const ROWS = Array.from({ length: 2000 }, (_, index) => ({
  id: index,
  title: `Row ${index}`,
  done: index % 2 === 0,
  meta: { tag: `tag-${index}` },
}))

export default function MoveBench() {
  const [rows, setRows] = createSignal(ROWS)
  const [tick, setTick] = createSignal(0)

  const updateDeep = () => {
    const next = tick() + 1
    setTick(next)
    setRows((items) => items.map((row, index) => (
      index === 0 ? { ...row, meta: { ...row.meta, tag: `tag-${row.id}-${next}` } } : row
    )))
  }

  const rotate = () => {
    setRows((items) => items.length === 0 ? items : [items[items.length - 1], ...items.slice(0, -1)])
  }

  const reverse = () => setRows((items) => [...items].reverse())

  const moveFront = () => setRows((items) => {
    const next = [...items]
    const [row] = next.splice(1000, 1)
    return [row, ...next]
  })

  const swap = () => setRows((items) => {
    if (items.length < 2) return items
    const next = [...items]
    const last = next.length - 1
    ;[next[0], next[last]] = [next[last], next[0]]
    return next
  })

  return (
    <view class="bench">
      <text id="tick">{tick()}</text>
      <text id="title">{rows()[0].title}</text>
      <text id="tag">{rows()[0].meta.tag}</text>
      <button id="deep" class="deep" onClick={updateDeep}>deep</button>
      <button id="rotate" class="rotate" onClick={rotate}>rotate</button>
      <button id="reverse" class="reverse" onClick={reverse}>reverse</button>
      <button id="mfront" class="mfront" onClick={moveFront}>move front</button>
      <button id="swap" class="swap" onClick={swap}>swap ends</button>
      <view class="list">
        <For each={rows()} keyed={(row) => row.id}>
          {(row) => (
            <view class="row">
              <text class="row-title">{row().title}</text>
              <text class="row-done">{row().done ? 'true' : 'false'}</text>
              <text class="row-tag">{row().meta.tag}</text>
            </view>
          )}
        </For>
      </view>
    </view>
  )
}
