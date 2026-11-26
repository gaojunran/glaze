import { createMemo, createSignal, Errored, For, Loading, Reveal } from 'solid-js'
import { createRequest } from '@glaze/runtime'
import AsyncRow from './AsyncRow'

const makeGate = () => {
  let open!: () => void
  const promise = new Promise<void>((resolve) => {
    open = resolve
  })
  return { promise, open }
}

export default function AsyncPage() {
  const later = createMemo(async () => {
    await new Promise((resolve) => setTimeout(resolve, 80))
    return 'async-ready'
  })
  const broken = createMemo(() => {
    throw new Error('boom')
  })
  const [flakyAttempt, setFlakyAttempt] = createSignal(0)
  const revealGateA = makeGate()
  const revealGateB = makeGate()
  const rows = createMemo(() => [
    { id: 1, title: 'row-a', delay: 40 },
    { id: 2, title: 'row-b', delay: 80 },
    { id: 3, title: 'row-c', delay: 40, fail: true },
  ])
  const [profileId, setProfileId] = createSignal(1)
  const profile = createMemo(async () => {
    const id = profileId()
    await new Promise((resolve) => setTimeout(resolve, 300))
    return `user-${id}`
  })
  const revealFirst = createMemo(async () => {
    await revealGateA.promise
    return 'reveal-a'
  })
  const revealSecond = createMemo(async () => {
    await revealGateB.promise
    return 'reveal-b'
  })
  const ping = createRequest(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const promise = new Promise<string>((resolve) => {
      timer = setTimeout(() => resolve('request-done'), 80)
    })
    return { promise, abort: () => clearTimeout(timer) }
  })
  ping.run()
  const flaky = createMemo(() => {
    if (flakyAttempt() === 0) throw new Error('flaky')
    return 'recovered'
  })

  return (
    <view class="page async-page">
      <text class="title">Async boundaries</text>
      <Loading fallback={<text class="async-loading">loading</text>}>
        <text class="async-value">{later()}</text>
      </Loading>
      <Loading fallback={<text class="nested-outer">outer-loading</text>}>
        <Loading fallback={<text class="nested-inner">inner-loading</text>}>
          <text class="nested-value">{later()}</text>
        </Loading>
      </Loading>
      <Errored fallback={(error) => <text class="async-error">{error().message}</text>}>
        <text class="async-broken">{broken()}</text>
      </Errored>
      <view class="async-rows">
        <For each={rows()}>{(row) => <AsyncRow row={row} class="async-row-host" />}</For>
      </view>
      <Loading
        fallback={<text class="refetch-fallback">profile loading</text>}
        pending={<text class="refetch-pending">refreshing</text>}
      >
        <text class="refetch-value">{profile()}</text>
      </Loading>
      <button class="refetch" onClick={() => setProfileId(2)}>
        refetch
      </button>
      <Reveal collapsed>
        <Loading fallback={<text class="reveal-a-loading">a loading</text>}>
          <text class="reveal-a">{revealFirst()}</text>
        </Loading>
        <Loading fallback={<text class="reveal-b-loading">b loading</text>}>
          <text class="reveal-b">{revealSecond()}</text>
        </Loading>
      </Reveal>
      <button class="reveal-a-resolve" onClick={() => revealGateA.open()}>
        resolve a
      </button>
      <button class="reveal-b-resolve" onClick={() => revealGateB.open()}>
        resolve b
      </button>
      <text class="request-state">{ping.data() ?? 'request-pending'}</text>
      <Errored
        fallback={(error, reset) => (
          <view class="async-retry">
            <text class="async-flaky">{error().message}</text>
            <button
              class="async-reset"
              onClick={() => {
                setFlakyAttempt(1)
                reset()
              }}
            >
              retry
            </button>
          </view>
        )}
      >
        <text class="async-flaky-value">{flaky()}</text>
      </Errored>
    </view>
  )
}
