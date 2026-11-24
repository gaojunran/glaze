import { createMemo, Errored, Loading } from 'solid-js'

export default function AsyncRow(props: { row: { id: number; title: string; delay: number; fail?: boolean } }) {
  // Snapshot the reactive input before the first await inside the memo; reads
  // after it are not tracked by Solid.
  const value = createMemo(async () => {
    const row = props.row
    await new Promise((resolve) => setTimeout(resolve, row.delay))
    return row.title
  })
  const broken = createMemo(() => {
    const row = props.row
    if (row.fail) throw new Error('row-fail')
    return row.title
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
