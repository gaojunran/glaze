import { View, Text, Button } from '@tarojs/components'
import { useState } from 'react'
import './index.css'

export default function RowCard({ label, index }) {
  const [count, setCount] = useState(0)

  return (
    <View className="row-card">
      <Text className="row-title">{label}</Text>
      <Text className="row-index">{index}</Text>
      <Text className="row-count">{count}</Text>
      <Button className="row-bump" onClick={() => setCount((value) => value + 1)}>bump</Button>
    </View>
  )
}
