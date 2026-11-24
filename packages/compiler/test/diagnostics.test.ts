import assert from 'node:assert/strict'
import test from 'node:test'
import { compileComponent } from '../src/index.ts'

test('warns when props are read after await inside an async memo', () => {
  const result = compileComponent(`
    import { createMemo } from 'solid-js'
    export default function Page(props) {
      const later = createMemo(async () => {
        const id = props.id
        await Promise.resolve()
        return props.title
      })
      return <text>{later()}</text>
    }
  `)
  assert.equal(result.warnings.length, 1)
  assert.equal(result.warnings[0].code, 'GLAZE_UNTRACKED_READ_AFTER_AWAIT')
  assert.match(result.warnings[0].message, /Read it into a local before awaiting/)
})

test('does not warn when the props read happens before await', () => {
  const result = compileComponent(`
    import { createMemo } from 'solid-js'
    export default function Page(props) {
      const later = createMemo(async () => {
        const title = props.title
        await Promise.resolve()
        return title
      })
      return <text>{later()}</text>
    }
  `)
  assert.equal(result.warnings.length, 0)
})

test('does not warn for props read in the awaited expression', () => {
  const result = compileComponent(`
    import { createMemo } from 'solid-js'
    export default function Page(props) {
      const later = createMemo(async () => {
        return await load(props.id)
      })
      return <text>{later()}</text>
    }
  `)
  assert.equal(result.warnings.length, 0)
})

test('warns for a nested async callback that reads props after await', () => {
  const result = compileComponent(`
    export default function Page(props) {
      async function load() {
        await Promise.resolve()
        return props.title
      }
      return <text onClick={load}>x</text>
    }
  `)
  assert.equal(result.warnings.length, 1)
})
