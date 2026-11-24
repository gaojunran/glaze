import assert from 'node:assert/strict'
import test from 'node:test'
import { compileComponent } from '../src/index.ts'

test('keeps runtime lifecycle hooks in the generated setup', () => {
  const result = compileComponent(
    `
      import { createEffect } from 'solid-js'
      import { onComponentError, usePageVisible } from '@glaze/runtime'

      export default function Page() {
        const pageVisible = usePageVisible()
        createEffect(() => {
          if (!pageVisible()) console.log('hidden')
        })
        onComponentError((error) => console.log(error))
        return <view><text>page</text></view>
      }
    `,
    { sourceFile: '/project/src/Page.tsx' },
  )

  assert.match(result.js, /from '@glaze\/runtime'/)
  assert.match(result.js, /usePageVisible\(\)/)
  assert.match(result.js, /onComponentError\(/)
})
