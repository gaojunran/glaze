import { createContext, createSignal, For, Match, Repeat, Show, Switch } from 'solid-js'
import Card from './Card'
import Header from './Header'
import Panel from './Panel'
import SlotCard from './SlotCard'
import ThemeLabel from './ThemeLabel'
import TodoItem from './TodoItem'

type Todo = {
  id: number
  title: string
  done: boolean
}

export default function Counter() {
  const [count, setCount] = createSignal(0)
  const [todos, setTodos] = createSignal<Todo[]>([
    { id: 1, title: 'Compile Solid to WXML', done: true },
    { id: 2, title: 'Run in minidev', done: false },
    { id: 3, title: 'Measure against native', done: false },
  ])

  const Theme = createContext('light')
  const [status, setStatus] = createSignal('idle')
  const [refWidth, setRefWidth] = createSignal(0)

  const [grid, setGrid] = createSignal([
    { id: 1, cells: [{ id: 'a' }, { id: 'b' }] },
    { id: 2, cells: [{ id: 'c' }, { id: 'd' }] },
  ])

  const toggleTodo = (id: number) =>
    setTodos((items) =>
      items.map((item) => (item.id === id ? { ...item, done: !item.done } : item)),
    )

  return (
    <view class="page">
      <Header title="Glaze + Solid" />

      <view class="counter">
        <button class="btn" onClick={() => setCount((value) => value - 1)}>-</button>
        <text class="count">{count()}</text>
        <button class="btn" onClick={() => setCount((value) => value + 1)}>+</button>
      </view>

      <Show when={count() > 3}>
        <text class="hint">count is greater than 3</text>
      </Show>

      <button
        class="status-toggle"
        onClick={() =>
          setStatus((value) => (value === 'idle' ? 'busy' : value === 'busy' ? 'other' : 'idle'))
        }
      >
        cycle status
      </button>

      <Switch fallback={<text class="switch-other">other</text>}>
        <Match when={status() === 'idle'}>
          <text class="switch-idle">idle</text>
        </Match>
        <Match when={status() === 'busy'}>
          <text class="switch-busy">busy</text>
        </Match>
      </Switch>

      <Show when={status()} keyed>
        {(value) => <text class="show-keyed">{value}</text>}
      </Show>

      <For each={['a', 'b']} keyed={false}>
        {(item) => <text class="unkeyed">{item()}</text>}
      </For>

      <For each={[{ id: 1 }]}>
        {({ id }) => <text class="destructured">{id}</text>}
      </For>

      <Repeat count={3}>
        {(index) => <text class="dot">{index}</text>}
      </Repeat>

      <For each={[]} fallback={<text class="empty-list">empty</text>}>
        {(item) => <text>{item}</text>}
      </For>

      <SlotCard>
        <text slot="header" class="slot-header">Slot header</text>
        <text class="slot-body">Slot body</text>
      </SlotCard>

      <Panel auto style="display: none" onToggle={() => toggleTodo(2)} />

      <Card title="Todos">
        <button
          class="toggle"
          onClick={() => toggleTodo(1)}
        >
          toggle first
        </button>

        <button
          class="append"
          onClick={() =>
            setTodos((items) => [
              ...items,
              { id: items.length + 1, title: 'Appended', done: false },
            ])
          }
        >
          append
        </button>

        <button
          class="prepend"
          onClick={() =>
            setTodos((items) => [
              { id: Date.now(), title: 'Prepended', done: false },
              ...items,
            ])
          }
        >
          prepend
        </button>

        <view class="list">
          <For each={todos()} keyed={(todo) => todo.id}>
            {(todo) => (
              <Panel>
                <TodoItem
                  title={todo().title}
                  done={todo().done}
                  onToggle={() => toggleTodo(todo().id)}
                />
                <button
                  class="remove"
                  onClick={() =>
                    setTodos((items) => items.filter((item) => item.id !== todo().id))
                  }
                >
                  x
                </button>
              </Panel>
            )}
          </For>
        </view>
      </Card>

      <Theme.Provider value="dark">
        <ThemeLabel theme={Theme} />
      </Theme.Provider>

      <view
        class="ref-probe"
        ref={(node: { width?: number } | null) => setRefWidth(node?.width ?? 0)}
      >
        <text class="ref-width">{refWidth()}</text>
      </view>

      <view class="grid">
        <For each={grid()} keyed={(row) => row.id}>
          {(row, rowIndex) => (
            <view class="row">
              <For each={row().cells} keyed={(cell) => cell.id}>
                {(cell, cellIndex) => (
                  <button
                    class="cell"
                    onClick={() =>
                      setGrid((rows) =>
                        rows.map((item, index) =>
                          index === rowIndex()
                            ? {
                                ...item,
                                cells: item.cells.map((value, cellAt) =>
                                  cellAt === cellIndex()
                                    ? { ...value, id: `${value.id}!` }
                                    : value,
                                ),
                              }
                            : item,
                        ),
                      )
                    }
                  >
                    {cell().id}
                  </button>
                )}
              </For>
            </view>
          )}
        </For>
      </view>

      <text class="footer">tap + to update the count</text>
    </view>
  )
}
