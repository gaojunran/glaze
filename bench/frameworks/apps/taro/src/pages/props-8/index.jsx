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
  p1: `r${row.id}-p1-${tick}`,
  p2: `r${row.id}-p2-${tick}`,
  p3: `r${row.id}-p3-${tick}`,
  p4: `r${row.id}-p4-${tick}`,
  p5: `r${row.id}-p5-${tick}`,
  p6: `r${row.id}-p6-${tick}`,
  p7: `r${row.id}-p7-${tick}`,
  p8: `r${row.id}-p8-${tick}`
})

export default function Props8() {
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
      <Text id="last">{rows[499].p8}</Text>
      <Button id="update" className="update" onClick={updateFirst}>update</Button>
      <Button id="update-all" className="update-all" onClick={updateAll}>update all</Button>
      {rows.map((row) => (
        <PropsShapeRow
          key={row.id}
          className="row-card"
          p1={row.p1}
          p2={row.p2}
          p3={row.p3}
          p4={row.p4}
          p5={row.p5}
          p6={row.p6}
          p7={row.p7}
          p8={row.p8}
        />
      ))}
    </View>
  )
}
