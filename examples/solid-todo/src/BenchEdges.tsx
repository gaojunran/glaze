import { createSignal, For } from 'solid-js'
import BenchEdgeDeep from './BenchEdgeDeep'
import BenchEdgeEventRow from './BenchEdgeEventRow'
import BenchEdgeSlotCard from './BenchEdgeSlotCard'

const LEVELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
const CARD_ROWS = Array.from({ length: 100 }, (_, index) => ({
  id: index,
  text: `Card ${index}`,
}))
const EVENT_ROWS = Array.from({ length: 100 }, (_, index) => ({ id: index }))

export default function BenchEdges() {
  const [f0, setF0] = createSignal('')
  const [f1, setF1] = createSignal('')
  const [f2, setF2] = createSignal('')
  const [f3, setF3] = createSignal('')
  const [f4, setF4] = createSignal('')
  const [f5, setF5] = createSignal('')
  const [f6, setF6] = createSignal('')
  const [f7, setF7] = createSignal('')
  const [f8, setF8] = createSignal('')
  const [f9, setF9] = createSignal('')
  const [f10, setF10] = createSignal('')
  const [f11, setF11] = createSignal('')
  const [f12, setF12] = createSignal('')
  const [f13, setF13] = createSignal('')
  const [f14, setF14] = createSignal('')
  const [f15, setF15] = createSignal('')
  const [f16, setF16] = createSignal('')
  const [f17, setF17] = createSignal('')
  const [f18, setF18] = createSignal('')
  const [f19, setF19] = createSignal('')

  const [cards, setCards] = createSignal(CARD_ROWS)
  const [picked, setPicked] = createSignal('none')
  const [picks, setPicks] = createSignal(0)
  const [deeps] = createSignal(LEVELS)

  const updateCard = () =>
    setCards((items) =>
      items.map((item, index) =>
        index === 0
          ? { ...item, text: item.text === 'Card 0' ? 'Card 0 changed' : 'Card 0' }
          : item,
      ),
    )

  const pickRow = (id: number) => {
    const next = picks() + 1
    setPicks(next)
    setPicked(`picked-${id}-${next}`)
  }

  return (
    <view class="bench-edges">
      <view class="deep-section">
        <For each={deeps()} keyed={false}>
          {(level) => <BenchEdgeDeep class="deep-host" level={level()} />}
        </For>
      </view>

      <view class="form-section">
        <input class="field-input" value={f0()} onInput={(event) => setF0(event.detail.value)} />
        <input class="field-input" value={f1()} onInput={(event) => setF1(event.detail.value)} />
        <input class="field-input" value={f2()} onInput={(event) => setF2(event.detail.value)} />
        <input class="field-input" value={f3()} onInput={(event) => setF3(event.detail.value)} />
        <input class="field-input" value={f4()} onInput={(event) => setF4(event.detail.value)} />
        <input class="field-input" value={f5()} onInput={(event) => setF5(event.detail.value)} />
        <input class="field-input" value={f6()} onInput={(event) => setF6(event.detail.value)} />
        <input class="field-input" value={f7()} onInput={(event) => setF7(event.detail.value)} />
        <input class="field-input" value={f8()} onInput={(event) => setF8(event.detail.value)} />
        <input class="field-input" value={f9()} onInput={(event) => setF9(event.detail.value)} />
        <input class="field-input" value={f10()} onInput={(event) => setF10(event.detail.value)} />
        <input class="field-input" value={f11()} onInput={(event) => setF11(event.detail.value)} />
        <input class="field-input" value={f12()} onInput={(event) => setF12(event.detail.value)} />
        <input class="field-input" value={f13()} onInput={(event) => setF13(event.detail.value)} />
        <input class="field-input" value={f14()} onInput={(event) => setF14(event.detail.value)} />
        <input class="field-input" value={f15()} onInput={(event) => setF15(event.detail.value)} />
        <input class="field-input" value={f16()} onInput={(event) => setF16(event.detail.value)} />
        <input class="field-input" value={f17()} onInput={(event) => setF17(event.detail.value)} />
        <input class="field-input" value={f18()} onInput={(event) => setF18(event.detail.value)} />
        <input class="field-input" value={f19()} onInput={(event) => setF19(event.detail.value)} />
        <text class="field-mirror">{f19()}</text>
      </view>

      <view class="slot-section">
        <button class="update-card" onClick={updateCard}>
          update card
        </button>
        <For each={cards()} keyed={(card) => card.id}>
          {(card) => (
            <BenchEdgeSlotCard class="slot-card-host">
              <text class="card-text">{card().text}</text>
            </BenchEdgeSlotCard>
          )}
        </For>
      </view>

      <view class="event-section">
        <text class="picked">{picked()}</text>
        <For each={EVENT_ROWS} keyed={(row) => row.id}>
          {(row) => (
            <BenchEdgeEventRow
              class="event-row-host"
              rowId={row().id}
              onPick={(id) => pickRow(id)}
            />
          )}
        </For>
      </view>
    </view>
  )
}
