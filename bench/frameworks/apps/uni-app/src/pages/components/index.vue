<template>
  <view class="bench">
    <text id="tick">{{ tick }}</text>
    <text id="title">{{ rows[0].title }}</text>
    <text id="last">{{ rows[499].title }}</text>
    <text id="probe10">{{ rows[9].title }}</text>
    <text id="probe100">{{ rows[99].title }}</text>
    <button id="u10" class="u10" @click="update10">u10</button>
    <button id="u100" class="u100" @click="update100">u100</button>
    <button id="update" class="update" @click="updateFirst">update</button>
    <button id="update-all" class="update-all" @click="updateAll">update all</button>
    <row-card
      class="row-card"
      v-for="row in rows"
      :key="row.id"
      :label="row.title"
      :index="row.id"
    />
  </view>
</template>

<script>
import RowCard from '../../components/RowCard.vue'

const ROWS = Array.from({ length: 500 }, (_, index) => ({
  id: index,
  title: `Row ${index}`,
}))

export default {
  components: { RowCard },
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
    updateAll() {
      const nextTick = this.tick + 1
      const suffix = `${nextTick}-${Date.now() % 100000}`
      this.tick = nextTick
      this.rows = this.rows.map((row) => ({ ...row, title: `${row.title.split(' ').slice(0, 2).join(' ')} ${suffix}` }))
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
  },
}
</script>

<style>
.bench { display: flex; flex-direction: column; }
</style>
