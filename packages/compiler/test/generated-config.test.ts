import assert from 'node:assert/strict'
import { unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import type { GeneratedConfigJson } from '@glaze/shared/protocol'
import { compileComponent } from '../src/index.ts'

const child = `
  export default function Child(props) {
    return <view><text>{props.title}</text><text>{props.done}</text></view>
  }
`

test('generated config matches the shared runtime protocol', async () => {
  const result = compileComponent(
    `
      import { Errored, For, Loading } from 'solid-js'
      import Child from './Child'

      export default function Page(props) {
        const items = [{ id: 1, title: 'a' }]
        return (
          <view>
            <text>{props.title}</text>
            <button onClick={() => props.onPick?.(props.title)}>pick</button>
            <For each={items} key="id">
              {(item) => <text>{item.title}</text>}
            </For>
            <Loading fallback={<text>wait</text>}>
              <Errored fallback={<text>bad</text>}>
                <text>{props.status}</text>
              </Errored>
            </Loading>
            <Child title={props.title} done={props.done} />
          </view>
        )
      }
    `,
    {
      sourceFile: '/project/src/Page.tsx',
      resolveComponent: () => ({
        source: child,
        file: '/project/src/Child.tsx',
        structuredProps: true,
      }),
    },
  )

  const generated = result.js
    .replace('export default defineGlazeComponent(', 'export const config = (')
    .replace(/^import \{[\s\S]*?\} from "@glaze\/runtime\/mini";\n/m, '')
  const file = path.join(
    import.meta.dirname,
    `.generated-config-${process.pid}-${Date.now()}.ts`,
  )
  try {
    await writeFile(file, generated)
    const { config } = (await import(pathToFileURL(file).href)) as {
      config: GeneratedConfigJson
    }

    // The JSON metadata is exactly the shared contract; `setup` is generated
    // code and must not appear among the JSON fields.
    assert.equal(typeof (config as { setup?: unknown }).setup, 'function')
    const jsonKeys = Object.keys(config).filter(
      (key) => typeof (config as Record<string, unknown>)[key] !== 'function',
    )
    for (const key of jsonKeys) {
      assert.ok(
        [
          'data',
          'properties',
          'propMap',
          'eventProps',
          'propSignals',
          'structuredProps',
          'boundaryContexts',
          'asyncStatus',
          'boundaries',
          'bindingGroupSize',
          'listBindings',
          'listFields',
          'handlerCount',
        ].includes(key),
        `unexpected generated config key ${key}`,
      )
    }
    assert.equal(typeof config.handlerCount, 'number')
    assert.equal(typeof config.listBindings, 'object')
    for (const key of Object.keys(config.data!)) {
      assert.match(key, /^b\d+$/)
      assert.ok(Number(key.slice(1)) < result.bindingCount)
    }
    assert.equal(Object.keys(config.data!).length, result.bindingCount)
    assert.deepEqual(config.properties, result.propertyNames)
    assert.equal(config.handlerCount, result.handlerCount)
    assert.ok(config.handlerCount! > 0)
    assert.equal('errorBoundary' in config, false)
    assert.equal('refCount' in config, false)
    assert.ok(result.wxml.includes('glazeprops'))
    assert.ok(Object.keys(config.listBindings!).length > 0)
    assert.ok(Object.keys(config.listFields!).length > 0)
    assert.ok(config.asyncStatus!.length > 0)
    assert.ok(config.propSignals!.length > 0)

    for (const [index, key] of Object.entries(config.listBindings!)) {
      assert.match(index, /^\d+$/)
      assert.ok(Number(index) < result.bindingCount)
      assert.equal(typeof key, 'string')
    }
    for (const index of Object.keys(config.listFields!)) {
      assert.ok(Object.hasOwn(config.listBindings!, index), `listFields ${index} has no listBindings entry`)
    }
    for (const status of config.asyncStatus!) {
      assert.ok(status.index < result.bindingCount)
    }
    for (const signal of config.propSignals!) {
      assert.ok(
        signal === 'glazecontext' || config.properties!.includes(signal),
        `prop signal ${signal} is not a declared property`,
      )
    }

    const handlerNames = [...result.wxml.matchAll(/="e(\d+)"/g)].map((match) =>
      Number(match[1]),
    )
    assert.ok(handlerNames.length > 0)
    for (const handler of handlerNames) {
      assert.ok(handler < config.handlerCount)
    }
  } finally {
    await unlink(file).catch(() => {})
  }
})
