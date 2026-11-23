import { View, Text, Button } from '@tarojs/components'
import { useState } from 'react'
import './index.css'

const ROWS = Array.from({ length: 80 }, (_, row) => ({
  id: row,
  cells: Array.from({ length: 25 }, (_, cell) => ({ id: cell, value: row * 25 + cell })),
}))

export default function Grid() {
  const [rows, setRows] = useState(ROWS)

  const updateCell = () => {
    setRows((items) => items.map((row, rowIndex) => (
      rowIndex === 0
        ? {
            ...row,
            cells: row.cells.map((cell, cellIndex) => (
              cellIndex === 0 ? { ...cell, value: cell.value + 1 } : cell
            )),
          }
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
    <View className="bench">
      <Text id="cell-value">{rows[0].cells[0].value}</Text>
      <Text id="last-cell">{rows[0].cells[24].value}</Text>
      <Button id="cell" className="cell-bump" onClick={updateCell}>cell</Button>
      <Button id="row" className="row-bump" onClick={updateRow}>row</Button>
      {rows.map((row) => (
        <View key={row.id} className="grid-row">
          {row.cells.map((cell) => (
            <Text key={cell.id} className="cell">
              <Text className="cell-value">{cell.value}</Text>
            </Text>
          ))}
        </View>
      ))}
    </View>
  )
}
