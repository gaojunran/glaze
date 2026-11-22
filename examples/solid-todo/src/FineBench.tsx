import { createSignal, For } from 'solid-js'

const ROWS = Array.from({ length: 5000 }, (_, index) => ({
  id: index,
  title: `Row ${index}`,
  done: index % 2 === 0,
  extra: 'x'.repeat(2000),
}))

export default function FineBench() {
  const [rows, setRows] = createSignal(ROWS)
  const [tick, setTick] = createSignal(0)

  const updateFirst = () => {
    const next = tick() + 1
    setTick(next)
    setRows((items) => items.map((row, index) => (
      index === 0 ? { ...row, title: `Row 0 ${next}` } : row
    )))
  }

  const toggleFirst = () => {
    setRows((items) => items.map((row, index) => (
      index === 0 ? { ...row, done: !row.done } : row
    )))
  }

  const insertFirst = () => {
    const id = -1 - tick()
    setRows((items) => [{ id, title: `Row ${id}`, done: false }, ...items])
  }

  const deleteFirst = () => setRows((items) => items.slice(1))

  const reverse = () => setRows((items) => [...items].reverse())

  return (
    <view class="bench">
      <text id="tick">{tick()}</text>
      <text id="title">{rows()[0].title}</text>
      <button id="bump" class="bump" onClick={() => setTick((value) => value + 1)}>bump</button>
      <button id="update" class="update" onClick={updateFirst}>update</button>
      <button id="toggle" class="toggle" onClick={toggleFirst}>toggle</button>
      <button id="insert" class="insert" onClick={insertFirst}>insert</button>
      <button id="delete" class="delete" onClick={deleteFirst}>delete</button>
      <button id="reverse" class="reverse" onClick={reverse}>reverse</button>
      <view class="list">
        <For each={rows()} keyed={(row) => row.id}>
          {(row) => (
            <view class="row">
              <text class="row-title">{row().title}</text>
              <text class="row-done">{row().done ? 'true' : 'false'}</text>
            </view>
          )}
        </For>
      </view>
    </view>
  )
}
