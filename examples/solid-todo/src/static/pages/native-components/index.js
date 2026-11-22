const ROWS = Array.from({ length: 1000 }, (_, index) => ({
  id: index,
  title: `Item ${index}`,
  done: false,
}))

const STATE_ROWS = Array.from({ length: 1000 }, (_, index) => ({ id: index }))

Page({
  data: {
    rows: ROWS,
    stateRows: STATE_ROWS,
  },
  onLoad() {
    this.nextId = ROWS.length
  },
  updateRow() {
    this.setData({ 'rows[0].done': !this.data.rows[0].done })
  },
  toggleAll() {
    this.setData({
      rows: this.data.rows.map((row) => ({ ...row, done: !row.done })),
    })
  },
  reverseRows() {
    this.setData({ rows: this.data.rows.slice().reverse() })
  },
  appendRow() {
    const rows = this.data.rows.concat({
      id: this.nextId,
      title: `Appended ${this.nextId}`,
      done: false,
    })
    this.nextId += 1
    this.setData({ rows })
  },
  deleteRow() {
    this.setData({ rows: this.data.rows.slice(1) })
  },
})
