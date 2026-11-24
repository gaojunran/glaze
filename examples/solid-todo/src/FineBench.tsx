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

  const updateRange = (count: number) => {
    const next = tick() + 1
    setTick(next)
    setRows((items) => items.map((row, index) => (
      index < count ? { ...row, title: `Row ${row.id} ${next}` } : row
    )))
  }

  const insertAt = (index: number) => {
    const id = index === 2500 ? -100000 - tick() : 100000 + tick()
    const next = tick() + 1
    setTick(next)
    setRows((items) => {
      const copy = [...items]
      copy.splice(index, 0, { id, title: `Row ${id}`, done: false, extra: 'x' })
      return copy
    })
  }

  const deleteAt = (index: number) => {
    setRows((items) => items.filter((_, rowIndex) => rowIndex !== index))
  }

  const reverse = () => setRows((items) => [...items].reverse())

  const mixed = () => {
    const next = tick() + 1
    setTick(next)
    setRows((items) => items.map((row, index) => (
      index < 10 ? { ...row, title: `Row ${row.id} ${next}`, done: !row.done } : row
    )))
  }

  const noop = () => {
    const next = tick() + 1
    setTick(next)
    setRows((items) => items.map((row, index) => (
      index === 0 ? { ...row } : row
    )))
  }

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
      <text id="probe10">{rows()[9].title}</text>
      <text id="probe100">{rows()[99].title}</text>
      <text id="probe500">{rows()[499].title}</text>
      <button id="u10" class="u10" onClick={() => updateRange(10)}>u10</button>
      <button id="u100" class="u100" onClick={() => updateRange(100)}>u100</button>
      <button id="u500" class="u500" onClick={() => updateRange(500)}>u500</button>
      <button id="im" class="im" onClick={() => insertAt(2500)}>insert mid</button>
      <button id="dm" class="dm" onClick={() => deleteAt(2500)}>delete mid</button>
      <button id="it" class="it" onClick={() => insertAt(rows().length)}>insert tail</button>
      <button id="dt" class="dt" onClick={() => deleteAt(rows().length - 1)}>delete tail</button>
      <button id="mixed" class="mixed" onClick={mixed}>mixed</button>
      <button id="noop" class="noop" onClick={noop}>noop</button>
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
