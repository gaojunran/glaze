Page({
  data: {
    tick: 0,
    rows: Array.from({ length: 5000 }, (_, index) => ({
      id: index,
      title: `Row ${index}`,
      done: index % 2 === 0,
  extra: 'x'.repeat(2000),
    })),
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
