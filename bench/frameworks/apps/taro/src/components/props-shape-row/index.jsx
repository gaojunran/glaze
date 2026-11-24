import { View, Text } from '@tarojs/components'
import './index.css'

export default function PropsShapeRow({
  p1 = '',
  p2 = '',
  p3 = '',
  p4 = '',
  p5 = '',
  p6 = '',
  p7 = '',
  p8 = '',
  p9 = '',
  p10 = '',
  p11 = '',
  p12 = '',
  p13 = '',
  p14 = '',
  p15 = '',
  p16 = '',
  className: hostClass
}) {
  return (
    <View className={hostClass || 'row-card'}>
      <Text className="row-title">{`${p1}${p2}${p3}${p4}${p5}${p6}${p7}${p8}${p9}${p10}${p11}${p12}${p13}${p14}${p15}${p16}`}</Text>
    </View>
  )
}
