import { createMemo, createSignal, Errored, Loading } from 'solid-js'

export default function AsyncPanel() {
  const [route, setRoute] = createSignal('a')
  const [failing, setFailing] = createSignal(true)

  const profile = createMemo(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50))
    return `profile-${route()}`
  })

  const data = createMemo(() => {
    if (failing()) throw new Error('offline')
    return 'ready'
  })

  return (
    <view class="page">
      <button onClick={() => setRoute(route() === 'a' ? 'b' : 'a')}>
        change route
      </button>

      <Loading fallback={<text class="loading">loading</text>} on={route()}>
        <text class="profile">{profile()}</text>
      </Loading>

      <Errored
        fallback={(error, reset) => (
          <view class="error">
            <text>{error().message}</text>
            <button
              class="retry"
              onClick={() => {
                setFailing(false)
                reset()
              }}
            >
              retry
            </button>
          </view>
        )}
      >
        <text class="data">{data()}</text>
      </Errored>
    </view>
  )
}
