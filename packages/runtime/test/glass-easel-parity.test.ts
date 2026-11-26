import assert from 'node:assert/strict'
import test from 'node:test'
import * as glassEasel from 'glass-easel'
import { createSignal } from 'solid-js'
import { defineGlazeComponent } from '../src/mini.ts'
import { mount, register, textContentOf } from './harness.ts'

// Glaze commits bindings through its own scheduler, so the direct component
// needs enough time for both the Solid flush and the glass-easel backend render
// callback. `shortTick` is not enough for the two-stage path in tests.
const settle = () => new Promise((resolve) => setTimeout(resolve, 100))

function captureDefinition(config: Record<string, unknown>) {
  const original = globalThis.Component
  let definition: Record<string, unknown> | undefined
  globalThis.Component = ((captured: Record<string, unknown>) => {
    definition = captured
    return captured
  }) as unknown as typeof globalThis.Component
  try {
    defineGlazeComponent(config as never)
  } finally {
    if (original === undefined) delete (globalThis as { Component?: unknown }).Component
    else globalThis.Component = original
  }
  assert.ok(definition, 'defineGlazeComponent must produce a definition')
  return definition
}

function pair(
  wxml: string,
  glazeConfig: Record<string, unknown>,
  directData: Record<string, unknown>,
  using?: Record<string, string>,
) {
  const space = new glassEasel.ComponentSpace()
  const glaze = mount(
    space,
    register(space, {
      is: 'glaze-root',
      wxml,
      config: captureDefinition(glazeConfig),
      using,
    }),
    'glaze-root',
  )
  const direct = mount(
    space,
    register(space, {
      is: 'direct-root',
      wxml,
      config: { data: directData },
      using,
    }),
    'direct-root',
  )
  return { glaze, direct }
}

const texts = (component: glassEasel.Component, selector: string) =>
  [...component.getShadowRoot()!.querySelectorAll(selector)].map(textContentOf)

const rowTexts = (component: glassEasel.Component) => texts(component, '.row')

async function expectSame(glaze: glassEasel.Component, direct: glassEasel.Component) {
  await settle()
  assert.deepEqual(glaze.data, direct.data)
  assert.deepEqual(rowTexts(glaze), rowTexts(direct))
}

test('scalar bindings and direct setData settle to the same data and text', async () => {
  let setValue
  const { glaze, direct } = pair(
    '<text id="value">{{b0}}</text><text id="copy">{{b1}}</text>',
    {
      data: { b0: null, b1: null },
      setup(ctx) {
        const [value, set] = createSignal('one')
        setValue = set
        ctx.bind(0, () => value())
        ctx.bind(1, () => value())
      },
    },
    { b0: 'one', b1: 'one' },
  )

  await settle()
  assert.deepEqual(glaze.data, direct.data)

  for (const value of ['two', 0, false, null]) {
    setValue(value)
    direct.setData({ b0: value, b1: value })
    await expectSame(glaze, direct)
    assert.equal(
      textContentOf(glaze.getShadowRoot()!.querySelector('#value')),
      textContentOf(direct.getShadowRoot()!.querySelector('#value')),
    )
  }
})

test('Glaze keeps the old view until its commit, while direct setData is synchronous', async () => {
  let setValue
  const { glaze, direct } = pair(
    '<text id="value">{{b0}}</text>',
    {
      data: { b0: null },
      setup(ctx) {
        const [value, set] = createSignal('old')
        setValue = set
        ctx.bind(0, () => value())
      },
    },
    { b0: 'old' },
  )
  await settle()

  setValue('new')
  direct.setData({ b0: 'new' })
  assert.equal(direct.data.b0, 'new')
  assert.equal(glaze.data.b0, 'old')

  await settle()
  assert.equal(glaze.data.b0, 'new')
  assert.deepEqual(glaze.data, direct.data)
})

test('keyed list patches and splices keep the same rendered order as direct setData', async () => {
  let setRows
  const { glaze, direct } = pair(
    '<view wx:for="{{b0}}" wx:key="id" class="row">{{item.title}}</view>',
    {
      data: { b0: null },
      listBindings: { 0: 'id' },
      setup(ctx) {
        const [rows, set] = createSignal([
          { id: 1, title: 'one' },
          { id: 2, title: 'two' },
          { id: 3, title: 'three' },
        ])
        setRows = set
        ctx.bind(0, () => rows())
      },
    },
    {
      b0: [
        { id: 1, title: 'one' },
        { id: 2, title: 'two' },
        { id: 3, title: 'three' },
      ],
    },
  )
  await settle()
  assert.deepEqual(rowTexts(glaze), ['one', 'two', 'three'])

  const updates = [
    [
      { id: 1, title: 'ONE' },
      { id: 2, title: 'two' },
      { id: 3, title: 'three' },
    ],
    [
      { id: 0, title: 'zero' },
      { id: 1, title: 'ONE' },
      { id: 2, title: 'two' },
      { id: 3, title: 'three' },
    ],
    [
      { id: 0, title: 'zero' },
      { id: 1, title: 'ONE' },
      { id: 3, title: 'three' },
    ],
    [
      { id: 3, title: 'three' },
      { id: 1, title: 'ONE' },
      { id: 0, title: 'zero' },
    ],
  ]

  for (const next of updates) {
    setRows(next)
    direct.setData({ b0: next })
    await expectSame(glaze, direct)
  }
})

test('a keyed reorder preserves row node identity in both implementations', async () => {
  let setRows
  const before = [
    { id: 1, title: 'one' },
    { id: 2, title: 'two' },
    { id: 3, title: 'three' },
  ]
  const after = [before[2], before[0], before[1]]
  const { glaze, direct } = pair(
    '<view wx:for="{{b0}}" wx:key="id" class="row">{{item.title}}</view>',
    {
      data: { b0: null },
      listBindings: { 0: 'id' },
      setup(ctx) {
        const [rows, set] = createSignal(before)
        setRows = set
        ctx.bind(0, () => rows())
      },
    },
    { b0: before },
  )
  await settle()

  const byText = (component: glassEasel.Component, text: string) =>
    [...component.getShadowRoot()!.querySelectorAll('.row')].find(
      (node) => textContentOf(node) === text,
    )
  const glazeTwo = byText(glaze, 'two')
  const directTwo = byText(direct, 'two')
  assert.ok(glazeTwo)
  assert.ok(directTwo)

  setRows(after)
  direct.setData({ b0: after })
  await expectSame(glaze, direct)

  assert.equal(byText(glaze, 'two'), glazeTwo)
  assert.equal(byText(direct, 'two'), directTwo)
})

test('nested object paths and conditional branches match direct setData', async () => {
  let setState
  const { glaze, direct } = pair(
    `<view wx:if="{{b0}}"><text id="value">{{b1.user.name}}</text></view>
     <text wx:else id="off">off</text>`,
    {
      data: { b0: false, b1: null },
      setup(ctx) {
        const [state, set] = createSignal({ open: false, user: { name: 'one' } })
        setState = set
        ctx.bind(0, () => state().open)
        ctx.bind(1, () => state())
      },
    },
    { b0: false, b1: { open: false, user: { name: 'one' } } },
  )
  await settle()
  assert.deepEqual(glaze.data, direct.data)
  assert.equal(
    textContentOf(glaze.getShadowRoot()!.querySelector('#off')),
    textContentOf(direct.getShadowRoot()!.querySelector('#off')),
  )

  const apply = async (open: boolean, name: string) => {
    setState({ open, user: { name } })
    direct.setData({ b0: open, b1: { open, user: { name } } })
    await settle()
    assert.deepEqual(glaze.data, direct.data)
    assert.equal(
      textContentOf(glaze.getShadowRoot()!.querySelector(open ? '#value' : '#off')),
      textContentOf(direct.getShadowRoot()!.querySelector(open ? '#value' : '#off')),
    )
  }

  await apply(true, 'two')
  await apply(false, 'three')
  await apply(true, 'four')
})

test('a child property update reaches the same child data as direct setData', async () => {
  const space = new glassEasel.ComponentSpace()
  register(space, {
    is: 'test-child',
    wxml: '<text id="child">{{count}}/{{label}}</text>',
    config: { properties: { count: { type: Number, value: 0 }, label: { type: String, value: '' } } },
  })

  let setCount
  let setLabel
  const glaze = mount(
    space,
    register(space, {
      is: 'glaze-parent',
      wxml: '<test-child id="child" count="{{b0}}" label="{{b1}}" />',
      config: captureDefinition({
        data: { b0: 1, b1: 'one' },
        setup(ctx) {
          const [count, setC] = createSignal(1)
          const [label, setL] = createSignal('one')
          setCount = setC
          setLabel = setL
          ctx.bind(0, () => count())
          ctx.bind(1, () => label())
        },
      }),
      using: { 'test-child': 'test-child' },
    }),
    'glaze-parent',
  )
  const direct = mount(
    space,
    register(space, {
      is: 'direct-parent',
      wxml: '<test-child id="child" count="{{b0}}" label="{{b1}}" />',
      config: { data: { b0: 1, b1: 'one' } },
      using: { 'test-child': 'test-child' },
    }),
    'direct-parent',
  )
  await settle()
  assert.deepEqual(glaze.data, direct.data)

  const childData = (parent: glassEasel.Component) =>
    (parent.getShadowRoot()!.querySelector('#child') as glassEasel.Component).data
  assert.deepEqual(childData(glaze), childData(direct))

  setCount(2)
  setLabel('two')
  direct.setData({ b0: 2, b1: 'two' })
  await settle()
  assert.deepEqual(glaze.data, direct.data)
  assert.deepEqual(childData(glaze), childData(direct))
  assert.equal(childData(glaze).count, 2)
  assert.equal(childData(glaze).label, 'two')
})
