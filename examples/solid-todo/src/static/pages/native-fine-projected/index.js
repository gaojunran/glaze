// Native control for the fine benchmark: the page data is already projected to
// the fields the template reads, so the unused 2 KB `extra` field never crosses
// the setData boundary.
const viewRows = (rows) => rows.map(({ id, title, done }) => ({ id, title, done }))

const createRows = () =>
  viewRows(
    Array.from({ length: 5000 }, (_, index) => ({
      id: index,
      title: `Row ${index}`,
      done: index % 2 === 0,
      extra: 'x'.repeat(2000),
    })),
  )

Page({
  data: {
    tick: 0,
    rows: createRows(),
  },
  updateFirst() {
    const tick = this.data.tick + 1
    this.setData({
      tick,
      'rows[0].title': `Row 0 ${tick}`,
    })
  },
  bump() {
    this.setData({ tick: this.data.tick + 1 })
  },
  toggleFirst() {
    this.setData({
      'rows[0].done': !this.data.rows[0].done,
    })
  },
  insertFirst() {
    const id = -1 - this.data.tick
    this.setData({
      rows: [{ id, title: `Row ${id}`, done: false }, ...this.data.rows],
    })
  },
  deleteFirst() {
    this.setData({ rows: this.data.rows.slice(1) })
  },
  reverse() {
    this.setData({ rows: this.data.rows.slice().reverse() })
  },
})
