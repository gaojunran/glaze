import { View, Text, Button } from '@tarojs/components'
import { useState } from 'react'
import PropsRow from '../../components/props-row'
import './index.css'

const createRows = () => Array.from({ length: 500 }, (_, index) => ({
  id: index,
  a: `r${index}-a`,
  b: `r${index}-b`,
  c: `r${index}-c`,
  d: `r${index}-d`,
  e: `r${index}-e`,
  f: `r${index}-f`,
  g: `r${index}-g`,
  h: `r${index}-h`,
}))

const rewrite = (row, tick) => ({
  ...row,
  a: `r${row.id}-a-${tick}`,
  b: `r${row.id}-b-${tick}`,
  c: `r${row.id}-c-${tick}`,
  d: `r${row.id}-d-${tick}`,
  e: `r${row.id}-e-${tick}`,
  f: `r${row.id}-f-${tick}`,
  g: `r${row.id}-g-${tick}`,
  h: `r${row.id}-h-${tick}`,
})

export default function Props() {
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
      <Text id="title">{rows[0].a}</Text>
      <Text id="last">{rows[499].h}</Text>
      <Button id="update" className="update" onClick={updateFirst}>update</Button>
      <Button id="update-all" className="update-all" onClick={updateAll}>update all</Button>
      {rows.map((row) => (
        <PropsRow
          key={row.id}
          class="row-card"
          a={row.a}
          b={row.b}
          c={row.c}
          d={row.d}
          e={row.e}
          f={row.f}
          g={row.g}
          h={row.h}
        />
      ))}
    </View>
  )
}
