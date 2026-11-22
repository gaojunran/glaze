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
})
