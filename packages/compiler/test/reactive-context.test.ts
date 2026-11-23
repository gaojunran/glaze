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
