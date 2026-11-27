// Compare the data-object size before and after nested list projection.
// Run from the repository root:
//   node --experimental-strip-types bench/frameworks/nested-projection.mjs
import { projectList } from '../../packages/runtime/src/list.ts'

const rows = Array.from({ length: 5000 }, (_, index) => ({
  id: index,
  title: `row ${index}`,
  meta: { tag: `tag-${index}`, extra: 'x'.repeat(2000) },
}))

const started = performance.now()
const projected = projectList(rows, ['id', 'title', 'meta.tag'])
const elapsed = performance.now() - started
const bytes = (value) => Buffer.byteLength(JSON.stringify(value))

console.log(
  JSON.stringify(
    {
      rows: rows.length,
      projectMs: Number(elapsed.toFixed(3)),
      beforeBytes: bytes(rows),
      afterBytes: bytes(projected),
      first: projected[0],
    },
    null,
    2,
  ),
)
