<template>
  <view class="bench">
    <text id="tick">{{ tick }}</text>
    <text id="title">{{ rows[0].title }}</text>
    <text id="last">{{ rows[499].title }}</text>
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
  },
}
</script>

<style>
.bench { display: flex; flex-direction: column; }
</style>
