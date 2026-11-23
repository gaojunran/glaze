import { createSignal, For } from 'solid-js'

const ROWS = Array.from({ length: 80 }, (_, row) => ({
  id: row,
  cells: Array.from({ length: 25 }, (_, cell) => ({ id: cell, value: row * 25 + cell })),
}))

export default function GridBench() {
  const [rows, setRows] = createSignal(ROWS.map((row) => ({ ...row, cells: row.cells.map((cell) => ({ ...cell })) })))

  const updateCell = () => {
    setRows((items) => items.map((row, rowIndex) => (
      rowIndex === 0
        ? { ...row, cells: row.cells.map((cell, cellIndex) => (
            cellIndex === 0 ? { ...cell, value: cell.value + 1 } : cell
          )) }
        : row
    )))
  }

  const updateRow = () => {
    setRows((items) => items.map((row, rowIndex) => (
      rowIndex === 0
        ? { ...row, cells: row.cells.map((cell) => ({ ...cell, value: cell.value + 1 })) }
        : row
    )))
  }

  return (
    <view class="bench">
      <text id="cell-value">{rows()[0].cells[0].value}</text>
      <text id="last-cell">{rows()[0].cells[24].value}</text>
      <button id="cell" class="cell" onClick={updateCell}>cell</button>
      <button id="row" class="row" onClick={updateRow}>row</button>
      <view class="grid">
        <For each={rows()} keyed={(row) => row.id}>
          {(row) => (
            <view class="grid-row">
              <For each={row().cells} keyed={(cell) => cell.id}>
                {(cell) => <text class="cell"><text class="cell-value">{cell().value}</text></text>}
              </For>
            </view>
          )}
        </For>
      </view>
    </view>
  )
}
