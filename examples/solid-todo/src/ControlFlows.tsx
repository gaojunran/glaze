import { createSignal, For, Match, Show, Switch } from 'solid-js'

type Row = {
  id: number
  label: string
}

export default function ControlFlows() {
  const [plain, setPlain] = createSignal(['a', 'b', 'c'])
  const [unkeyed, setUnkeyed] = createSignal<Row[]>([
    { id: 1, label: 'u1' },
    { id: 2, label: 'u2' },
  ])
  const [keyed, setKeyed] = createSignal<Row[]>([
    { id: 1, label: 'k1' },
    { id: 2, label: 'k2' },
    { id: 3, label: 'k3' },
  ])
  const [showValue, setShowValue] = createSignal<string | null>('alpha')
  const [matchValue, setMatchValue] = createSignal<Row | null>({ id: 1, label: 'alpha' })
  let nextUnkeyed = 3
  let nextKeyed = 4

  const reverse = <T,>(value: T[]) => [...value].reverse()

  return (
    <view class="page control-flows">
      <text class="title">Control flows</text>

      <For each={plain()}>{(item) => <text class="plain-row">{item}</text>}</For>
      <button class="plain-reverse" onClick={() => setPlain((rows) => reverse(rows))}>
        reverse plain
      </button>
      <button class="plain-append" onClick={() => setPlain((rows) => [...rows, 'd'])}>
        append plain
      </button>
      <button class="plain-clear" onClick={() => setPlain([])}>
        clear plain
      </button>

      <For each={unkeyed()} keyed={false}>
        {(item) => <text class="unkeyed-row">{item().label}</text>}
      </For>
      <button class="unkeyed-reverse" onClick={() => setUnkeyed((rows) => reverse(rows))}>
        reverse unkeyed
      </button>
      <button
        class="unkeyed-append"
        onClick={() =>
          setUnkeyed((rows) => [...rows, { id: nextUnkeyed, label: `u${nextUnkeyed++}` }])
        }
      >
        append unkeyed
      </button>
      <button class="unkeyed-remove" onClick={() => setUnkeyed((rows) => rows.slice(1))}>
        remove unkeyed first
      </button>

      <For each={keyed()} keyed={(item) => item.id}>
        {(item) => <text class="keyed-row">{item().label}</text>}
      </For>
      <button class="keyed-reverse" onClick={() => setKeyed((rows) => reverse(rows))}>
        reverse keyed
      </button>
      <button
        class="keyed-append"
        onClick={() =>
          setKeyed((rows) => [...rows, { id: nextKeyed, label: `k${nextKeyed++}` }])
        }
      >
        append keyed
      </button>
      <button class="keyed-remove" onClick={() => setKeyed((rows) => rows.slice(1))}>
        remove keyed first
      </button>

      <Show when={showValue()} keyed>
        {(value) => <text class="show-keyed">{value}</text>}
      </Show>
      <Show when={showValue()}>
        {(value) => <text class="show-nonkeyed">{value()}</text>}
      </Show>
      <button class="show-next" onClick={() => setShowValue('beta')}>
        show next
      </button>
      <button class="show-clear" onClick={() => setShowValue(null)}>
        clear show
      </button>

      <Switch fallback={<text class="match-fallback">none</text>}>
        <Match when={matchValue()} keyed>
          {(value) => <text class="match-keyed">{value.label}</text>}
        </Match>
      </Switch>
      <button
        class="match-next"
        onClick={() => setMatchValue((value) => value && { ...value, label: 'beta' })}
      >
        match next
      </button>
      <button class="match-clear" onClick={() => setMatchValue(null)}>
        clear match
      </button>
    </view>
  )
}
