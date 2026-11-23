const createRows = () => Array.from({ length: 80 }, (_, row) => ({
  id: row,
  cells: Array.from({ length: 25 }, (_, cell) => ({ id: cell, value: row * 25 + cell })),
}))

Page({
  data: { rows: createRows() },
  updateCell() {
    this.setData({ 'rows[0].cells[0].value': this.data.rows[0].cells[0].value + 1 })
  },
  updateRow() {
    this.setData({
      'rows[0].cells': this.data.rows[0].cells.map((cell) => ({ ...cell, value: cell.value + 1 })),
    })
  },
})
