const createRows = () => Array.from({ length: 2000 }, (_, index) => ({
  id: index,
  title: `Row ${index}`,
  done: index % 2 === 0,
  meta: { tag: `tag-${index}` },
}))

Page({
  data: { rows: createRows(), tick: 0 },
  updateDeep() {
    const tick = this.data.tick + 1
    this.setData({
      tick,
      'rows[0].meta.tag': `tag-${this.data.rows[0].id}-${tick}`,
    })
  },
  rotate() {
    const rows = this.data.rows
    this.setData({ rows: [rows[rows.length - 1], ...rows.slice(0, -1)] })
  },
  reverse() {
    this.setData({ rows: this.data.rows.slice().reverse() })
  },
  moveFront() {
    const rows = this.data.rows.slice()
    const [row] = rows.splice(1000, 1)
    this.setData({ rows: [row, ...rows] })
  },
  swap() {
    const rows = this.data.rows.slice()
    const last = rows.length - 1
    ;[rows[0], rows[last]] = [rows[last], rows[0]]
    this.setData({ rows })
  },
})
