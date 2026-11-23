import { createSignal } from 'solid-js'

export default function ScalarBench() {
  const [s0, setS0] = createSignal(0)
  const [s1, setS1] = createSignal(1)
  const [s2, setS2] = createSignal(2)
  const [s3, setS3] = createSignal(3)
  const [s4, setS4] = createSignal(4)
  const [s5, setS5] = createSignal(5)
  const [s6, setS6] = createSignal(6)
  const [s7, setS7] = createSignal(7)
  const [s8, setS8] = createSignal(8)
  const [s9, setS9] = createSignal(9)
  const [s10, setS10] = createSignal(10)
  const [s11, setS11] = createSignal(11)
  const [s12, setS12] = createSignal(12)
  const [s13, setS13] = createSignal(13)
  const [s14, setS14] = createSignal(14)
  const [s15, setS15] = createSignal(15)

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

  return (
    <view class="bench">
      <text id="tick">{s0()}</text>
      <button id="bump" class="bump" onClick={bump}>bump</button>
      <view class="scalars">
        <text class="scalar"><text class="scalar-value">{s0()}</text></text>
        <text class="scalar"><text class="scalar-value">{s1()}</text></text>
        <text class="scalar"><text class="scalar-value">{s2()}</text></text>
        <text class="scalar"><text class="scalar-value">{s3()}</text></text>
        <text class="scalar"><text class="scalar-value">{s4()}</text></text>
        <text class="scalar"><text class="scalar-value">{s5()}</text></text>
        <text class="scalar"><text class="scalar-value">{s6()}</text></text>
        <text class="scalar"><text class="scalar-value">{s7()}</text></text>
        <text class="scalar"><text class="scalar-value">{s8()}</text></text>
        <text class="scalar"><text class="scalar-value">{s9()}</text></text>
        <text class="scalar"><text class="scalar-value">{s10()}</text></text>
        <text class="scalar"><text class="scalar-value">{s11()}</text></text>
        <text class="scalar"><text class="scalar-value">{s12()}</text></text>
        <text class="scalar"><text class="scalar-value">{s13()}</text></text>
        <text class="scalar"><text class="scalar-value">{s14()}</text></text>
        <text class="scalar"><text class="scalar-value">{s15()}</text></text>
      </view>
    </view>
  )
}
