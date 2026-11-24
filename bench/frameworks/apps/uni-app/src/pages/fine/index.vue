<template>
  <view class="bench">
    <text id="tick">{{ tick }}</text>
    <text id="title">{{ rows[0].title }}</text>
    <button id="bump" class="bump" @click="bump">bump</button>
    <button id="update" class="update" @click="updateFirst">update</button>
    <button id="toggle" class="toggle" @click="toggleFirst">toggle</button>
    <button id="insert" class="insert" @click="insertFirst">insert</button>
    <button id="delete" class="delete" @click="deleteFirst">delete</button>
    <button id="reverse" class="reverse" @click="reverse">reverse</button>
    <text id="probe10">{{ rows[9].title }}</text>
    <text id="probe100">{{ rows[99].title }}</text>
    <text id="probe500">{{ rows[499].title }}</text>
    <button id="u10" class="u10" @click="update10">u10</button>
    <button id="u100" class="u100" @click="update100">u100</button>
    <button id="u500" class="u500" @click="update500">u500</button>
    <button id="im" class="im" @click="insertMid">insert mid</button>
    <button id="dm" class="dm" @click="deleteMid">delete mid</button>
    <button id="it" class="it" @click="insertTail">insert tail</button>
    <button id="dt" class="dt" @click="deleteTail">delete tail</button>
    <button id="mixed" class="mixed" @click="mixed">mixed</button>
    <button id="noop" class="noop" @click="noop">noop</button>
    <view v-for="row in rows" :key="row.id" class="row">
      <text class="row-title">{{ row.title }}</text>
      <text class="row-done">{{ row.done }}</text>
    </view>
  </view>
</template>

<script>
const ROWS = Array.from({ length: 5000 }, (_, index) => ({
  id: index,
  title: `Row ${index}`,
  done: index % 2 === 0,
  extra: 'x'.repeat(2000),
}))

export default {
  data() {
    return { rows: ROWS.slice(), tick: 0 }
  },
  methods: {
    bump() {
      this.tick += 1
    },
    updateFirst() {
      const nextTick = this.tick + 1
      this.tick = nextTick
      this.rows = this.rows.map((row, index) => (
        index === 0 ? { ...row, title: `Row 0 ${nextTick}` } : row
      ))
    },
    toggleFirst() {
      this.rows = this.rows.map((row, index) => (
        index === 0 ? { ...row, done: !row.done } : row
      ))
    },
    insertFirst() {
      const id = -1 - this.tick
      this.rows = [{ id, title: `Row ${id}`, done: false }, ...this.rows]
    },
    deleteFirst() {
      this.rows = this.rows.slice(1)
    },
    reverse() {
      this.rows = this.rows.slice().reverse()
    },
    updateRange(count) {
      const nextTick = this.tick + 1
      this.tick = nextTick
      this.rows = this.rows.map((row, index) => (
        index < count ? { ...row, title: `Row ${row.id} ${nextTick}` } : row
      ))
    },
    update10() { this.updateRange(10) },
    update100() { this.updateRange(100) },
    update500() { this.updateRange(500) },
    insertMid() {
      const id = -100000 - this.tick
      const nextTick = this.tick + 1
      const next = this.rows.slice()
      next.splice(2500, 0, { id, title: `Row ${id}`, done: false, extra: 'x' })
      this.tick = nextTick
      this.rows = next
    },
    deleteMid() {
      const next = this.rows.slice()
      next.splice(2500, 1)
      this.rows = next
    },
    insertTail() {
      const id = 100000 + this.tick
      const nextTick = this.tick + 1
      this.tick = nextTick
      this.rows = [...this.rows, { id, title: `Row ${id}`, done: false, extra: 'x' }]
    },
    deleteTail() {
      this.rows = this.rows.slice(0, -1)
    },
    mixed() {
      const nextTick = this.tick + 1
      this.tick = nextTick
      this.rows = this.rows.map((row, index) => (
        index < 10 ? { ...row, title: `Row ${row.id} ${nextTick}`, done: !row.done } : row
      ))
    },
    noop() {
      const nextTick = this.tick + 1
      this.tick = nextTick
      this.rows = this.rows.map((row, index) => (index === 0 ? { ...row } : row))
    },
  },
}
</script>

<style>
.bench { display: flex; flex-direction: column; }
.row { height: 20px; }
.row-title { font-size: 12px; }
.row-done { font-size: 10px; color: #666; }
</style>
