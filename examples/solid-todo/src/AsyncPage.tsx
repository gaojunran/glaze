import { createMemo, createSignal, Errored, For, Loading } from 'solid-js'
import AsyncRow from './AsyncRow'

export default function AsyncPage() {
  const later = createMemo(async () => {
    await new Promise((resolve) => setTimeout(resolve, 80))
    return 'async-ready'
  })
  const broken = createMemo(() => {
    throw new Error('boom')
  })
  const [flakyAttempt, setFlakyAttempt] = createSignal(0)
  const rows = createMemo(() => [
    { id: 1, title: 'row-a', delay: 40 },
    { id: 2, title: 'row-b', delay: 80 },
    { id: 3, title: 'row-c', delay: 40, fail: true },
  ])
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
