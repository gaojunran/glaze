import { createMemo, createSignal, createStore, For, Show } from 'solid-js'

type Row = { id: number; title: string; done: boolean; meta: { tag: string } }

export default function ReactiveCases() {
  const [state, setState] = createStore({
    user: { name: 'Ada', address: { city: 'London' } },
    rows: [
      { id: 1, title: 'one', done: false, meta: { tag: 'a' } },
      { id: 2, title: 'two', done: false, meta: { tag: 'b' } },
    ] as Row[],
    count: 0,
  })
  const [items, setItems] = createSignal([
    { id: 1, label: 'alpha' },
    { id: 2, label: 'beta' },
  ])
  const [profile, setProfile] = createSignal({ name: 'A', nested: { age: 1 } })

  const doneCount = createMemo(() => state.rows.filter((row) => row.done).length)
  const rename = () =>
    setState((prev) => ({ ...prev, user: { ...prev.user, name: 'Grace' } }))
  const moveCity = () =>
    setState((prev) => ({
      ...prev,
      user: { ...prev.user, address: { ...prev.user.address, city: 'Paris' } },
    }))
  const toggleRow = () =>
    setState((prev) => ({
      ...prev,
      rows: prev.rows.map((row, index) => (index === 0 ? { ...row, done: !row.done } : row)),
    }))
  const retagRow = () =>
    setState((prev) => ({
      ...prev,
      rows: prev.rows.map((row, index) =>
        index === 0 ? { ...row, meta: { ...row.meta, tag: 'changed' } } : row,
      ),
    }))
  const pushRow = () =>
    setState((prev) => ({
      ...prev,
      rows: [
        ...prev.rows,
        {
          id: prev.rows.length + 1,
          title: `row${prev.rows.length + 1}`,
          done: false,
          meta: { tag: 'x' },
        },
      ],
    }))
  const removeRow = () => setState((prev) => ({ ...prev, rows: prev.rows.slice(1) }))
  const bumpCount = () => setState((prev) => ({ ...prev, count: prev.count + 1 }))
  const renameItem = () =>
    setItems((list) => list.map((item, index) => (index === 0 ? { ...item, label: 'alpha+' } : item)))
  const appendItem = () =>
    setItems((list) => [...list, { id: list.length + 1, label: `item${list.length + 1}` }])
  const ageProfile = () =>
    setProfile({ ...profile(), nested: { age: profile().nested.age + 1 } })

  return (
    <view class="reactive">
      <text class="user-name">{state.user.name}</text>
      <text class="user-city">{state.user.address.city}</text>
      <text class="done-count">{doneCount()}</text>
      <text class="store-count">{state.count}</text>
      <text class="profile-age">{profile().nested.age}</text>
      <text class="profile-name">{profile().name}</text>

      <button class="rename" onClick={rename}>rename</button>
      <button class="move-city" onClick={moveCity}>move city</button>
      <button class="toggle-row" onClick={toggleRow}>toggle row</button>
      <button class="retag-row" onClick={retagRow}>retag row</button>
      <button class="push-row" onClick={pushRow}>push row</button>
      <button class="remove-row" onClick={removeRow}>remove row</button>
      <button class="bump-count" onClick={bumpCount}>bump count</button>
      <button class="rename-item" onClick={renameItem}>rename item</button>
      <button class="append-item" onClick={appendItem}>append item</button>
      <button class="age-profile" onClick={ageProfile}>age profile</button>

      <view class="store-list">
        <For each={state.rows} keyed={(row) => row.id}>
          {(row) => (
            <view class="store-row">
              <text class="store-row-title">{row().title}</text>
              <text class="store-row-tag">{row().meta.tag}</text>
              <text class="store-row-state">{row().done ? 'done' : 'todo'}</text>
            </view>
          )}
        </For>
      </view>

      <view class="signal-list">
        <For each={items()} keyed={(item) => item.id}>
          {(item) => <text class="signal-row">{item().label}</text>}
        </For>
      </view>

      <Show when={state.user.name === 'Grace'}>
        <text class="renamed">renamed</text>
      </Show>
    </view>
  )
}
