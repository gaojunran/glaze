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

  return (
    <View className="bench">
      <Text id="tick">{tick}</Text>
      <Text id="title">{rows[0].title}</Text>
      <Text id="last">{rows[499].title}</Text>
      <Button id="update" className="update" onClick={updateFirst}>update</Button>
      <Button id="update-all" className="update-all" onClick={updateAll}>update all</Button>
      {rows.map((row) => (
        <RowCard key={row.id} label={row.title} index={row.id} />
      ))}
    </View>
  )
}
