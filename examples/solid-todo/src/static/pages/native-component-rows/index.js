Page({
  data: {
    tick: 0,
    rows: Array.from({ length: 500 }, (_, index) => ({
      id: index,
      title: `Row ${index}`,
    })),
  },
  updateAll() {
    const tick = this.data.tick + 1
    const suffix = `${tick}-${Date.now() % 100000}`
    this.setData({
      tick,
      rows: this.data.rows.map((row) => ({ ...row, title: `${row.title.split(' ').slice(0, 2).join(' ')} ${suffix}` })),
    })
  },
  updateFirst() {
    const tick = this.data.tick + 1
    this.setData({
      tick,
      'rows[0].title': `Row 0 ${tick}`,
    })
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
})
