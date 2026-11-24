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
  updateRange(count) {
    const tick = this.data.tick + 1
    const next = { tick }
    for (let index = 0; index < count; index += 1) {
      next[`rows[${index}].title`] = `Row ${index} ${tick}`
    }
    this.setData(next)
  },
  update10() { this.updateRange(10) },
  update100() { this.updateRange(100) },
  update500() { this.updateRange(500) },
  insertMid() {
    const id = -100000 - this.data.tick
    const tick = this.data.tick + 1
    const rows = this.data.rows.slice()
    rows.splice(2500, 0, { id, title: `Row ${id}`, done: false, extra: 'x' })
    this.setData({ tick, rows })
  },
  deleteMid() {
    const rows = this.data.rows.slice()
    rows.splice(2500, 1)
    this.setData({ rows })
  },
  insertTail() {
    const id = 100000 + this.data.tick
    const tick = this.data.tick + 1
    this.setData({
      tick,
      rows: [...this.data.rows, { id, title: `Row ${id}`, done: false, extra: 'x' }],
    })
  },
  deleteTail() {
    this.setData({ rows: this.data.rows.slice(0, -1) })
  },
  mixed() {
    const tick = this.data.tick + 1
    const next = { tick }
    for (let index = 0; index < 10; index += 1) {
      next[`rows[${index}].title`] = `Row ${index} ${tick}`
      next[`rows[${index}].done`] = !this.data.rows[index].done
    }
    this.setData(next)
  },
  noop() {
    const tick = this.data.tick + 1
    this.setData({
      tick,
      rows: this.data.rows.map((row, index) => (index === 0 ? { ...row } : row)),
    })
  },
  reverse() {
    this.setData({ rows: this.data.rows.slice().reverse() })
  },
})
