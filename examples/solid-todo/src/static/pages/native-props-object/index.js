const createRows = () => Array.from({ length: 500 }, (_, index) => ({
  id: index,
  a: `r${index}-a`, b: `r${index}-b`, c: `r${index}-c`, d: `r${index}-d`,
  e: `r${index}-e`, f: `r${index}-f`, g: `r${index}-g`, h: `r${index}-h`,
}))

const rewrite = (row, tick) => ({
  ...row,
  a: `r${row.id}-a-${tick}`, b: `r${row.id}-b-${tick}`, c: `r${row.id}-c-${tick}`, d: `r${row.id}-d-${tick}`,
  e: `r${row.id}-e-${tick}`, f: `r${row.id}-f-${tick}`, g: `r${row.id}-g-${tick}`, h: `r${row.id}-h-${tick}`,
})

Page({
  data: { rows: createRows(), tick: 0 },
  updateFirst() {
    const tick = this.data.tick + 1
    this.setData({ tick, 'rows[0]': rewrite(this.data.rows[0], tick) })
  },
  updateAll() {
    const tick = this.data.tick + 1
    this.setData({ tick, rows: this.data.rows.map((row) => rewrite(row, tick)) })
  },
})
