import { createContext, createSignal, For, Match, Repeat, Show, Switch } from 'solid-js'
import CamelLabel from './CamelLabel'
import Card from './Card'
import Header from './Header'
import Nested from './Nested'
import Panel from './Panel'
import EventProbe from './EventProbe'
import RemoveButton from './RemoveButton'
import PropProbe from './PropProbe'
import SlotCard from './SlotCard'
import ThemeLabel from './ThemeLabel'
import ThemeDirect from './ThemeDirect'
import TodoItem from './TodoItem'
import logo from './assets/logo.png'

type Todo = {
  id: number
  title: string
  done: boolean
}

// A local component: the compiler inlines it, so it does not add a
// mini-program component boundary or a generated component directory.
function LocalBadge(props: { count: number }) {
  return <text class="local-badge">{props.count}</text>
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
  const [prefix] = createSignal('row-')
  const [picked] = createSignal({ name: 'picked' })
  const upper = (value: string) => value.toUpperCase()
  const [refWidth, setRefWidth] = createSignal(0)
  const [refQuery, setRefQuery] = createSignal('idle')
  let refNode: { querySelector(selector: string): Promise<{ width?: number } | null> } | null = null
  const queryRef = async () => {
    const child = await refNode?.querySelector('.ref-label')
    setRefQuery(child ? `found:${child.width ?? 0}` : 'missing')
  }
  const [tapLog, setTapLog] = createSignal('')
  const [captureLog, setCaptureLog] = createSignal('')
  const [mutLog, setMutLog] = createSignal('')
  const [eventLog, setEventLog] = createSignal('')

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
      <navigator class="ui-entry" url="/pages/ui/index">Open UI components</navigator>
      <image class="asset-logo" src={logo} />
      <image class="static-logo" src="./assets/static-logo.png" />
      <Nested title="Nested inline" />
      <CamelLabel userName={count() > 0 ? "positive" : "zero"} />

      <PropProbe count={3} label="probe" class={{ active: count() > 0 }} style={{ marginTop: 2 }} />

      <view class="counter">
        <button class="btn" onClick={() => setCount((value) => value - 1)}>-</button>
        <text class="count">{count()}</text>
        <button class="btn" onClick={() => setCount((value) => value + 1)}>+</button>
      </view>
      <LocalBadge count={count()} />

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

      <For each={[{ id: 'a' }]} keyed={(item) => item.id}>
        {(item) => (
          <text class="outer-in-for">{upper(prefix())}{item().id}</text>
        )}
      </For>

      <Switch>
        <Match when={picked()} keyed>
          {(value) => <text class="match-keyed">{value.name}</text>}
        </Match>
      </Switch>

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
            {(todo) => {
              const title = todo().title
              return (
                <Panel>
                  <TodoItem
                    title={title}
                    done={todo().done}
                    onToggle={() => toggleTodo(todo().id)}
                  />
                  <Repeat count={2} from={1}>
                    {(index) => <text class="nested-repeat">{index}</text>}
                  </Repeat>
                  <Show when={todo().title} keyed>
                    {(value) => <text class="nested-show">{value}</text>}
                  </Show>
                  <Show when={todo().title}>
                    {(value) => <text class="nested-show-nonkeyed">{value()}</text>}
                  </Show>
                  <RemoveButton
                    onClick={() =>
                      setTodos((items) => items.filter((item) => item.id !== todo().id))
                    }
                  />
                </Panel>
              )
            }}
          </For>
        </view>
      </Card>

      <Theme.Provider value="dark">
        <ThemeLabel theme={Theme} />
      </Theme.Provider>

      <Theme value="light">
        <ThemeDirect theme={Theme} />
      </Theme>

      <view
        class="ref-probe"
        ref={(node: { width?: number; querySelector?: (selector: string) => Promise<unknown> } | null) => {
          refNode = (node as { querySelector: (selector: string) => Promise<{ width?: number } | null> } | null) ?? null
          setRefWidth(node?.width ?? 0)
        }}
      >
        <text class="ref-label">ref child</text>
        <text class="ref-width">{refWidth()}</text>
        <button class="ref-query" onClick={queryRef}>query ref</button>
        <text class="ref-query-result">{refQuery()}</text>
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

      <view class="tap-outer" onClick={() => setTapLog('outer')}>
        <button class="tap-inner" onClickCatch={() => setTapLog('inner')}>
          inner catch
        </button>
      </view>
      <text class="tap-log">{tapLog()}</text>

      <view class="capture-outer" onClickCapture={() => setCaptureLog((value) => `${value}C`)}>
        <button
          class="capture-inner"
          onClick={() => setCaptureLog((value) => `${value}T`)}
        >
          capture
        </button>
      </view>
      <text class="capture-log">{captureLog()}</text>

      <view class="mut-outer" onClickMutBind={() => setMutLog((value) => `${value}O`)}>
        <button
          class="mut-inner"
          onClickMutBind={() => setMutLog((value) => `${value}I`)}
        >
          mutual
        </button>
      </view>
      <text class="mut-log">{mutLog()}</text>

      <EventProbe
        class="event-catch-host"
        name="catch"
        onPingCatch={() => setEventLog((value) => `${value}c`)}
      >
        <text class="event-caption">component catch</text>
      </EventProbe>
      <EventProbe
        class="event-capture-host"
        name="capture"
        onPingCapture={() => setEventLog((value) => `${value}p`)}
      >
        <text class="event-caption">component capture</text>
      </EventProbe>
      <text class="event-log">{eventLog()}</text>

      <text class="footer">tap + to update the count</text>
    </view>
  )
}
