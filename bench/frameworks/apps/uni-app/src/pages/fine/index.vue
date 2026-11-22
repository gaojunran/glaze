<template>
  <view class="bench">
    <text id="tick">{{ tick }}</text>
    <text id="title">{{ rows[0].title }}</text>
    <button id="update" class="update" @click="updateFirst">update</button>
    <button id="toggle" class="toggle" @click="toggleFirst">toggle</button>
    <button id="insert" class="insert" @click="insertFirst">insert</button>
    <button id="delete" class="delete" @click="deleteFirst">delete</button>
    <button id="reverse" class="reverse" @click="reverse">reverse</button>
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
  },
}
</script>

<style>
.bench { display: flex; flex-direction: column; }
.row { height: 20px; }
.row-title { font-size: 12px; }
.row-done { font-size: 10px; color: #666; }
</style>
