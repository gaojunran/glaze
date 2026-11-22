import { View, Text, Button } from '@tarojs/components'
import { useState } from 'react'
import './index.css'

const ROWS = Array.from({ length: 1000 }, (_, index) => ({
  id: index,
  title: `Row ${index}`,
  done: index % 2 === 0,
}))

export default function Index() {
  const [rows, setRows] = useState(ROWS)
  const [tick, setTick] = useState(0)

  const updateFirst = () => {
    setRows((items) => {
      const next = items.slice()
      next[0] = { ...next[0], title: `Row 0 ${tick + 1}` }
      return next
    })
    setTick((value) => value + 1)
  }

  const reverse = () => setRows((items) => items.slice().reverse())

  return (
    <View className="bench">
      <Text id="tick">{tick}</Text>
      <Text id="title">{rows[0].title}</Text>
      <Button id="update" class="update" onClick={updateFirst}>update</Button>
      <Button id="reverse" class="reverse" onClick={reverse}>reverse</Button>
      {rows.map((row) => (
        <View key={row.id} className="row">
          <Text className="row-title">{row.title}</Text>
        </View>
      ))}
    </View>
  )
}
