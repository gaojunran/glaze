const createRows = () => Array.from({ length: 500 }, (_, index) => ({
  id: index,
  p1: `r${index}-p1`, p2: `r${index}-p2`, p3: `r${index}-p3`, p4: `r${index}-p4`,
  p5: `r${index}-p5`, p6: `r${index}-p6`, p7: `r${index}-p7`, p8: `r${index}-p8`,
  p9: `r${index}-p9`, p10: `r${index}-p10`, p11: `r${index}-p11`, p12: `r${index}-p12`,
  p13: `r${index}-p13`, p14: `r${index}-p14`, p15: `r${index}-p15`, p16: `r${index}-p16`,
}))

const bump = (row, tick, count) => {
  const next = { ...row }
  for (let p = 1; p <= count; p += 1) next[`p${p}`] = `r${row.id}-p${p}-${tick}`
  return next
}

let tick = 0

Page({
  data: { rows: createRows() },
  updateFirst() {
    tick += 1
    this.setData({ 'rows[0]': bump(this.data.rows[0], tick, 16) })
  },
  updateAll() {
    tick += 1
    this.setData({ rows: this.data.rows.map((row) => bump(row, tick, 16)) })
  },
})
