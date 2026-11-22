import { View, Text, Button } from '@tarojs/components'
import { useState } from 'react'
import './index.css'

const ROWS = Array.from({ length: 5000 }, (_, index) => ({
  id: index,
  title: `Row ${index}`,
  done: index % 2 === 0,
  extra: 'x'.repeat(2000),
}))

export default function Fine() {
  const [rows, setRows] = useState(ROWS)
  const [tick, setTick] = useState(0)

  const updateFirst = () => {
    const nextTick = tick + 1
    setTick(nextTick)
    setRows((items) => items.map((row, index) => (
      index === 0 ? { ...row, title: `Row 0 ${nextTick}` } : row
    )))
  }

  const toggleFirst = () => {
    setRows((items) => items.map((row, index) => (
      index === 0 ? { ...row, done: !row.done } : row
    )))
  }

  const insertFirst = () => {
    const id = -1 - tick
    setRows((items) => [{ id, title: `Row ${id}`, done: false }, ...items])
  }

  const deleteFirst = () => setRows((items) => items.slice(1))
  const reverse = () => setRows((items) => items.slice().reverse())

  return (
    <View className="bench">
      <Text id="tick">{tick}</Text>
      <Text id="title">{rows[0].title}</Text>
      <Button id="update" className="update" onClick={updateFirst}>update</Button>
      <Button id="toggle" className="toggle" onClick={toggleFirst}>toggle</Button>
      <Button id="insert" className="insert" onClick={insertFirst}>insert</Button>
      <Button id="delete" className="delete" onClick={deleteFirst}>delete</Button>
      <Button id="reverse" className="reverse" onClick={reverse}>reverse</Button>
      {rows.map((row) => (
        <View key={row.id} className="row">
          <Text className="row-title">{row.title}</Text>
          <Text className="row-done">{String(row.done)}</Text>
        </View>
      ))}
    </View>
  )
}
