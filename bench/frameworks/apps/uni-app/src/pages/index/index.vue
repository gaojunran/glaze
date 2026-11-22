<template>
  <view class="bench">
    <text id="tick">{{ tick }}</text>
    <text id="title">{{ rows[0].title }}</text>
    <button id="update" class="update" @click="updateFirst">update</button>
    <button id="reverse" class="reverse" @click="reverse">reverse</button>
    <view v-for="row in rows" :key="row.id" class="row">
      <text class="row-title">{{ row.title }}</text>
    </view>
  </view>
</template>

<script>
const ROWS = Array.from({ length: 1000 }, (_, index) => ({
  id: index,
  title: `Row ${index}`,
  done: index % 2 === 0,
}))

export default {
  data() {
    return { rows: ROWS.slice(), tick: 0 }
  },
  methods: {
    updateFirst() {
      const next = this.rows.slice()
      next[0] = { ...next[0], title: `Row 0 ${this.tick + 1}` }
      this.rows = next
      this.tick += 1
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
</style>
