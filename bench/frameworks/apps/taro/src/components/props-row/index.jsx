import { View, Text } from '@tarojs/components'
import './index.css'

export default function PropsRow({ a, b, c, d, e, f, g, h, class: hostClass }) {
  return (
    <View className={hostClass || 'row-card'}>
      <Text className="row-title">{a}</Text>
      <Text className="prop">{a}</Text>
      <Text className="prop">{b}</Text>
      <Text className="prop">{c}</Text>
      <Text className="prop">{d}</Text>
      <Text className="prop">{e}</Text>
      <Text className="prop">{f}</Text>
      <Text className="prop">{g}</Text>
      <Text className="prop">{h}</Text>
    </View>
  )
}
