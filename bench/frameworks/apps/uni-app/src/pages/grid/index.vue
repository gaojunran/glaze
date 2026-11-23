<template>
  <view class="bench">
    <text id="cell-value">{{ rows[0].cells[0].value }}</text>
    <text id="last-cell">{{ rows[0].cells[24].value }}</text>
    <button id="cell" class="btn-cell" @click="bumpCell">cell</button>
    <button id="row" class="btn-row" @click="bumpRow">row</button>
    <view v-for="row in rows" :key="row.id" class="grid-row">
      <text
        v-for="cell in row.cells"
        :key="cell.id"
        class="cell"
      ><text class="cell-value">{{ cell.value }}</text></text>
    </view>
  </view>
</template>

<script>
const ROWS = Array.from({ length: 80 }, (_, rowIndex) => ({
  id: rowIndex,
  cells: Array.from({ length: 25 }, (_, cellIndex) => ({
    id: `${rowIndex}-${cellIndex}`,
    value: rowIndex * 25 + cellIndex,
  })),
}))

export default {
  data() {
    return { rows: ROWS.slice() }
  },
  methods: {
    replaceFirstRow(cells) {
      this.rows = [{ ...this.rows[0], cells }, ...this.rows.slice(1)]
    },
    bumpCell() {
      const cells = this.rows[0].cells.map((cell, index) => (
        index === 0 ? { ...cell, value: cell.value + 1 } : cell
      ))
      this.replaceFirstRow(cells)
    },
    bumpRow() {
      const cells = this.rows[0].cells.map((cell) => ({ ...cell, value: cell.value + 1 }))
      this.replaceFirstRow(cells)
    },
  },
}
</script>

<style>
.bench { display: flex; flex-direction: column; }
.grid-row { display: flex; flex-direction: row; height: 16px; }
.cell { font-size: 10px; }
.cell-value { font-size: 10px; }
</style>
