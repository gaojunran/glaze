import { View, Text, Button } from '@tarojs/components'
import { useState } from 'react'
import PropsShapeRow from '../../components/props-shape-row'
import './index.css'

const createRows = () => Array.from({ length: 500 }, (_, index) => {
  const row = { id: index }
  for (let field = 1; field <= 16; field += 1) {
    row[`p${field}`] = `r${index}-p${field}`
  }
  return row
})

const rewrite = (row, tick) => ({
  ...row,
  p1: `r${row.id}-p1-${tick}`
})

export default function Props1() {
  const [rows, setRows] = useState(createRows)
  const [tick, setTick] = useState(0)

  const updateFirst = () => {
    const nextTick = tick + 1
    setTick(nextTick)
    setRows((items) => items.map((row, index) => (
      index === 0 ? rewrite(row, nextTick) : row
    )))
  }

  const updateAll = () => {
    const nextTick = tick + 1
    setTick(nextTick)
    setRows((items) => items.map((row) => rewrite(row, nextTick)))
  }

  return (
    <View className="bench">
      <Text id="tick">{tick}</Text>
      <Text id="last">{rows[499].p1}</Text>
      <Button id="update" className="update" onClick={updateFirst}>update</Button>
      <Button id="update-all" className="update-all" onClick={updateAll}>update all</Button>
      {rows.map((row) => (
        <PropsShapeRow
          key={row.id}
          className="row-card"
          p1={row.p1}
        />
      ))}
    </View>
  )
}
