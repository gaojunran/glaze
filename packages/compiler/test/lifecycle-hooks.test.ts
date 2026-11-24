import assert from 'node:assert/strict'
import test from 'node:test'
import { compileComponent } from '../src/index.ts'

test('keeps runtime lifecycle hooks in the generated setup', () => {
  const result = compileComponent(
    `
      import { createEffect } from 'solid-js'
      import {
        onComponentError,
        onPageEvent,
        useAppVisible,
        usePageEvent,
        usePageVisible,
      } from '@glaze/runtime'

      export default function Page() {
        const pageVisible = usePageVisible()
        const appVisible = useAppVisible()
        const scroll = usePageEvent('scroll')
        createEffect(() => {
          if (!pageVisible() || !appVisible()) console.log('hidden')
          scroll()
        })
        onPageEvent('shareAppMessage', () => ({ title: 'page' }))
        onComponentError((error) => console.log(error))
        return <view><text>page</text></view>
      }
    `,
    { sourceFile: '/project/src/Page.tsx' },
  )

  assert.match(result.js, /from '@glaze\/runtime'/)
  assert.match(result.js, /usePageVisible\(\)/)
  assert.match(result.js, /useAppVisible\(\)/)
  assert.match(result.js, /usePageEvent\('scroll'\)/)
  assert.match(result.js, /onPageEvent\('shareAppMessage'/)
  assert.match(result.js, /onComponentError\(/)
})
