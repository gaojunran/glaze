import assert from 'node:assert/strict'
import test from 'node:test'
import { compileComponent } from '../src/index.ts'

test('passes a provider value reader for reactive object contexts', () => {
  const result = compileComponent(`
    import { createContext } from 'solid-js'
    const Theme = createContext({ color: 'light' })
    export default function Page(props) {
      return (
        <Theme.Provider value={props.theme}>
          <text>inside</text>
        </Theme.Provider>
      )
    }
  `)
  assert.match(
    result.js,
    /withProvider\(Theme, \(props\.theme\), \(\) => \{[\s\S]*\}, \(\) => \(props\.theme\)\);/,
  )
})

test('passes a boundary context reader to the child setup', () => {
  const child = compileComponent(
    `
      import { useContext } from 'solid-js'
      import { Theme } from './theme'
      export default function Child() {
        const theme = useContext(Theme)
        return <text>{theme.color}</text>
      }
    `,
    { sourceFile: '/app/Child.tsx' },
  )
  assert.match(child.js, /withBoundaryContexts\(\[\{ context: Theme, key: "\/app\/theme#Theme" \}\], \(\) => __glazeProps\.glazecontext, \(\) => \{/)
})

test('a same-file context crosses a component boundary by source key', () => {
  const child = compileComponent(
    `
      import { createContext, useContext } from 'solid-js'
      const Local = createContext('local')
      export default function Child() {
        const value = useContext(Local)
        return <text>{String(value)}</text>
      }
    `,
    { sourceFile: '/app/Same.tsx' },
  )
  assert.deepEqual(child.boundaryContexts, [
    { name: 'Local', key: '/app/Same.tsx#Local' },
  ])
  assert.match(child.js, /const value = ctx\.context\(Local\)/)
  assert.match(child.js, /ctx\.bind\(0, \(\) => \(String\(value\(\)\)\)\)/)
})

test('a context provided in the same component does not become a boundary prop', () => {
  const result = compileComponent(`
    import { createContext, useContext } from 'solid-js'
    const Local = createContext('local')
    export default function Page() {
      return (
        <Local value="inline">
          <text>{useContext(Local)}</text>
        </Local>
      )
    }
  `)
  assert.deepEqual(result.boundaryContexts, [])
  assert.ok(!result.props.includes('glazecontext'))
  assert.match(result.js, /withProvider\(Local, \("inline"\)/)
  assert.match(result.js, /ctx\.context\(Local\)\(\)/)
})
