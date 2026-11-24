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

  const updateRange = (count) => {
    const nextTick = tick + 1
    setTick(nextTick)
    setRows((items) => items.map((row, index) => (
      index < count ? { ...row, title: `Row ${row.id} ${nextTick}` } : row
    )))
  }

  const insertMid = () => {
    const id = -100000 - tick
    const nextTick = tick + 1
    setTick(nextTick)
    setRows((items) => {
      const next = [...items]
      next.splice(2500, 0, { id, title: `Row ${id}`, done: false, extra: 'x' })
      return next
    })
  }

  const deleteMid = () => {
    setRows((items) => {
      const next = [...items]
      next.splice(2500, 1)
      return next
    })
  }

  const insertTail = () => {
    const id = 100000 + tick
    const nextTick = tick + 1
    setTick(nextTick)
    setRows((items) => [...items, { id, title: `Row ${id}`, done: false, extra: 'x' }])
  }

  const deleteTail = () => setRows((items) => items.slice(0, -1))

  return (
    <View className="bench">
      <Text id="tick">{tick}</Text>
      <Text id="title">{rows[0].title}</Text>
      <Button id="bump" className="bump" onClick={() => setTick((value) => value + 1)}>bump</Button>
      <Button id="update" className="update" onClick={updateFirst}>update</Button>
      <Button id="toggle" className="toggle" onClick={toggleFirst}>toggle</Button>
      <Button id="insert" className="insert" onClick={insertFirst}>insert</Button>
      <Button id="delete" className="delete" onClick={deleteFirst}>delete</Button>
      <Button id="reverse" className="reverse" onClick={reverse}>reverse</Button>
      <Text id="probe10">{rows[9].title}</Text>
      <Text id="probe100">{rows[99].title}</Text>
      <Text id="probe500">{rows[499].title}</Text>
      <Button id="u10" className="u10" onClick={() => updateRange(10)}>u10</Button>
      <Button id="u100" className="u100" onClick={() => updateRange(100)}>u100</Button>
      <Button id="u500" className="u500" onClick={() => updateRange(500)}>u500</Button>
      <Button id="im" className="im" onClick={insertMid}>insert mid</Button>
      <Button id="dm" className="dm" onClick={deleteMid}>delete mid</Button>
      <Button id="it" className="it" onClick={insertTail}>insert tail</Button>
      <Button id="dt" className="dt" onClick={deleteTail}>delete tail</Button>
      {rows.map((row) => (
        <View key={row.id} className="row">
          <Text className="row-title">{row.title}</Text>
          <Text className="row-done">{String(row.done)}</Text>
        </View>
      ))}
    </View>
  )
}
