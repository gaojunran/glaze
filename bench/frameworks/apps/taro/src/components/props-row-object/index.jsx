import { View, Text } from '@tarojs/components'
import './index.css'

export default function PropsRowObject({ row, class: hostClass }) {
  return (
    <View className={hostClass || 'row-card'}>
      <Text className="row-title">{row.a}</Text>
      <Text className="prop">{row.a}</Text>
      <Text className="prop">{row.b}</Text>
      <Text className="prop">{row.c}</Text>
      <Text className="prop">{row.d}</Text>
      <Text className="prop">{row.e}</Text>
      <Text className="prop">{row.f}</Text>
      <Text className="prop">{row.g}</Text>
      <Text className="prop">{row.h}</Text>
    </View>
  )
}
