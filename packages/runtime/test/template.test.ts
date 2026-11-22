import assert from 'node:assert/strict'
import test from 'node:test'
import * as glassEasel from 'glass-easel'
import { mount, register, textContentOf, textOf, tick } from './harness.ts'

const space = () => new glassEasel.ComponentSpace()

test('renders WXML text, attributes and class bindings', async () => {
  const root = space()
  const def = register(root, {
    wxml: '<view id="box" class="{{b1}}" data-label="{{b2}}"><text>{{b0}}</text></view>',
    config: { data: { b0: 'hello', b1: 'on', b2: 'boxed' } },
  })
  const comp = mount(root, def)
  await tick()
  const box = comp.getShadowRoot().querySelector('#box')
  assert.equal(box?.getAttribute('data-label'), 'boxed')
  assert.match(textOf(box), /class="on"/)
  assert.equal(textContentOf(box), 'hello')
  comp.setData({ b0: 'world' })
  await tick()
  assert.equal(textContentOf(box), 'world')
})

test('renders wx:if / wx:elif / wx:else branches', async () => {
  const root = space()
  const def = register(root, {
    wxml: `<view id="a" wx:if="{{b0 === 'a'}}">A</view>
      <view id="b" wx:elif="{{b0 === 'b'}}">B</view>
      <view id="c" wx:else>C</view>`,
    config: { data: { b0: 'b' } },
  })
  const comp = mount(root, def)
  await tick()
  const shadow = comp.getShadowRoot()
  assert.equal(shadow.querySelector('#b')?.childNodes[0]?.textContent, 'B')
  comp.setData({ b0: 'c' })
  await tick()
  assert.equal(shadow.querySelector('#c')?.childNodes[0]?.textContent, 'C')
})

test('renders keyed wx:for and updates appended rows', async () => {
  const root = space()
  const def = register(root, {
    wxml: '<view wx:for="{{b0}}" wx:key="id" class="row">{{item.title}}</view>',
    config: { data: { b0: [{ id: 1, title: 'one' }] } },
  })
  const comp = mount(root, def)
  await tick()
  const shadow = comp.getShadowRoot()
  const first = shadow.querySelectorAll('.row')[0]
  assert.equal(first.childNodes[0]?.textContent, 'one')
  comp.setData({ b0: [{ id: 1, title: 'one' }, { id: 2, title: 'two' }] })
  await tick()
  assert.equal(shadow.querySelectorAll('.row').length, 2)
  // A stable key keeps the first DOM node instead of recreating it.
  assert.equal(shadow.querySelectorAll('.row')[0], first)
})

test('dispatches a normalized bindtap event with dataset index', async () => {
  const root = space()
  let seen
  const def = register(root, {
    wxml: '<button id="btn" bindtap="e0" data-glaze-index="{{b0}}">go</button>',
    config: {
      data: { b0: 3 },
      methods: {
        e0(event) {
          seen = event.currentTarget.dataset.glazeIndex
        },
      },
    },
  })
  const comp = mount(root, def)
  await tick()
  comp.getShadowRoot().querySelector('#btn')?.triggerEvent('tap', null, { bubbles: true })
  assert.equal(seen, 3)
})

test('passes a property to a child component and forwards its custom event', async () => {
  const root = space()
  const child = register(root, {
    is: 'test-child',
    wxml: '<text id="label">{{count}}</text>',
    config: { properties: { count: { type: Number, value: 0 } } },
  })
  let detail
  const parent = register(root, {
    is: 'test-parent',
    wxml: '<test-child id="child" count="{{b0}}" bind:ping="e0" />',
    using: { 'test-child': 'test-child' },
    config: {
      data: { b0: 7 },
      methods: {
        e0(event) {
          detail = event.detail
        },
      },
    },
  })
  const comp = mount(root, parent, 'test-parent')
  await tick()
  const childElement = comp.getShadowRoot().querySelector('#child')
  assert.ok(childElement)
  assert.equal(childElement.data.count, 7)
  assert.equal(
    (childElement as glassEasel.Component).getShadowRoot().querySelector('#label')?.childNodes[0]
      ?.textContent,
    '7',
  )
  childElement.triggerEvent('ping', 'pong', { bubbles: true })
  assert.equal(detail, 'pong')
  assert.ok(child)
})

test('updates a template after detach and reattach', async () => {
  const root = space()
  const def = register(root, {
    wxml: '<text id="value">{{b0}}</text>',
    config: { data: { b0: 'before' } },
  })
  const comp = mount(root, def)
  await tick()
  glassEasel.Element.pretendDetached(comp)
  comp.setData({ b0: 'after' })
  await tick()
  glassEasel.Element.pretendAttached(comp)
  await tick()
  assert.equal(textContentOf(comp.getShadowRoot().querySelector('#value')), 'after')
})
