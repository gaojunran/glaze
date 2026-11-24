import { createMemo, Errored, Loading } from 'solid-js'

export default function AsyncRow(props: { row: { id: number; title: string; delay: number; fail?: boolean } }) {
  const value = createMemo(async () => {
    await new Promise((resolve) => setTimeout(resolve, props.row.delay))
    return props.row.title
  })
  const broken = createMemo(() => {
    if (props.row.fail) throw new Error('row-fail')
    return props.row.title
  })

  return (
    <view class="async-row" data-id={props.row.id}>
      <Loading fallback={<text class="row-loading">loading</text>}>
        <text class="row-value">{value()}</text>
      </Loading>
      <Errored fallback={(error) => <text class="row-error">{error().message}</text>}>
        <text class="row-ok">{broken()}</text>
      </Errored>
    </view>
  )
}
