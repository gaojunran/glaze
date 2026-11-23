import { View, Text, Button } from '@tarojs/components'
import { useState } from 'react'
import './index.css'

export default function Scalars() {
  const [s0, setS0] = useState(0)
  const [s1, setS1] = useState(1)
  const [s2, setS2] = useState(2)
  const [s3, setS3] = useState(3)
  const [s4, setS4] = useState(4)
  const [s5, setS5] = useState(5)
  const [s6, setS6] = useState(6)
  const [s7, setS7] = useState(7)
  const [s8, setS8] = useState(8)
  const [s9, setS9] = useState(9)
  const [s10, setS10] = useState(10)
  const [s11, setS11] = useState(11)
  const [s12, setS12] = useState(12)
  const [s13, setS13] = useState(13)
  const [s14, setS14] = useState(14)
  const [s15, setS15] = useState(15)

  const bump = () => {
    setS0((value) => value + 1)
    setS1((value) => value + 1)
    setS2((value) => value + 1)
    setS3((value) => value + 1)
    setS4((value) => value + 1)
    setS5((value) => value + 1)
    setS6((value) => value + 1)
    setS7((value) => value + 1)
    setS8((value) => value + 1)
    setS9((value) => value + 1)
    setS10((value) => value + 1)
    setS11((value) => value + 1)
    setS12((value) => value + 1)
    setS13((value) => value + 1)
    setS14((value) => value + 1)
    setS15((value) => value + 1)
  }

  const values = [s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11, s12, s13, s14, s15]

  return (
    <View className="bench">
      <Text id="tick">{s0}</Text>
      <Button id="bump" className="bump" onClick={bump}>bump</Button>
      {values.map((value, index) => (
        <Text key={index} className="scalar">
          <Text className="scalar-value">{value}</Text>
        </Text>
      ))}
    </View>
  )
}
