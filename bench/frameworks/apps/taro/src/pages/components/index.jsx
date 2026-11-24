import { View, Text, Button } from '@tarojs/components'
import { useState } from 'react'
import RowCard from '../../components/row-card'
import './index.css'

const ROWS = Array.from({ length: 500 }, (_, index) => ({
  id: index,
  title: `Row ${index}`,
}))

export default function Components() {
  const [rows, setRows] = useState(ROWS)
  const [tick, setTick] = useState(0)

  const updateFirst = () => {
    const nextTick = tick + 1
    setTick(nextTick)
    setRows((items) => items.map((row, index) => (
      index === 0 ? { ...row, title: `Row 0 ${nextTick}` } : row
    )))
  }

  const updateAll = () => {
    const nextTick = tick + 1
    const suffix = `${nextTick}-${Date.now() % 100000}`
    setTick(nextTick)
    setRows((items) => items.map((row) => ({
      ...row,
      title: `${row.title.split(' ').slice(0, 2).join(' ')} ${suffix}`,
    })))
  }

  const updateRange = (count) => {
    const nextTick = tick + 1
    setTick(nextTick)
    setRows((items) => items.map((row, index) => (
      index < count ? { ...row, title: `Row ${row.id} ${nextTick}` } : row
    )))
  }

  return (
    <View className="bench">
      <Text id="tick">{tick}</Text>
      <Text id="title">{rows[0].title}</Text>
      <Text id="last">{rows[499].title}</Text>
      <Text id="probe10">{rows[9].title}</Text>
      <Text id="probe100">{rows[99].title}</Text>
      <Button id="u10" className="u10" onClick={() => updateRange(10)}>u10</Button>
      <Button id="u100" className="u100" onClick={() => updateRange(100)}>u100</Button>
      <Button id="update" className="update" onClick={updateFirst}>update</Button>
      <Button id="update-all" className="update-all" onClick={updateAll}>update all</Button>
      {rows.map((row) => (
        <RowCard key={row.id} label={row.title} index={row.id} />
      ))}
    </View>
  )
}
