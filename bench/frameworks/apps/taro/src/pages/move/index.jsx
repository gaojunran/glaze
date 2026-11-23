import { View, Text, Button } from '@tarojs/components'
import { useState } from 'react'
import './index.css'

const ROWS = Array.from({ length: 2000 }, (_, index) => ({
  id: index,
  title: `Row ${index}`,
  done: index % 2 === 0,
  meta: { tag: `tag-${index}` },
}))

export default function Move() {
  const [rows, setRows] = useState(ROWS)
  const [tick, setTick] = useState(0)

  const deepUpdate = () => {
    const nextTick = tick + 1
    setTick(nextTick)
    setRows((items) => items.map((row, index) => (
      index === 0
        ? { ...row, meta: { ...row.meta, tag: `tag-${row.id}-${nextTick}` } }
        : row
    )))
  }

  const rotate = () => setRows((items) => [items[items.length - 1], ...items.slice(0, -1)])
  const reverse = () => setRows((items) => items.slice().reverse())

  return (
    <View className="bench">
      <Text id="tick">{tick}</Text>
      <Text id="title">{rows[0].title}</Text>
      <Text id="tag">{rows[0].meta.tag}</Text>
      <Button id="deep" className="deep" onClick={deepUpdate}>deep</Button>
      <Button id="rotate" className="rotate" onClick={rotate}>rotate</Button>
      <Button id="reverse" className="reverse" onClick={reverse}>reverse</Button>
      {rows.map((row) => (
        <View key={row.id} className="row">
          <Text className="row-title">{row.title}</Text>
          <Text className="row-done">{String(row.done)}</Text>
          <Text className="row-tag">{row.meta.tag}</Text>
        </View>
      ))}
    </View>
  )
}
