import assert from 'node:assert/strict'
import test from 'node:test'
import { kebabCase } from '../src/strings.ts'

test('converts camelCase component names', () => {
  assert.equal(kebabCase('TodoItem'), 'todo-item')
  assert.equal(kebabCase('HTTPClient'), 'http-client')
})

test('converts route paths used for component names', () => {
  assert.equal(kebabCase('pages/BenchComponents'), 'pages-bench-components')
})
