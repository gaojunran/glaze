<template>
  <view class="bench">
    <text id="tick">{{ tick }}</text>
    <text id="title">{{ rows[0].a }}</text>
    <text id="last">{{ rows[499].h }}</text>
    <button id="update" class="update" @click="updateFirst">update</button>
    <button id="update-all" class="update-all" @click="updateAll">update all</button>
    <props-row-object
      v-for="row in rows"
      :key="row.id"
      class="row-card"
      :row="row"
    />
  </view>
</template>

<script>
import PropsRowObject from '../../components/PropsRowObject.vue'

const FIELDS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']

const ROWS = Array.from({ length: 500 }, (_, index) => {
  const row = { id: index }
  for (const field of FIELDS) row[field] = `r${index}-${field}`
  return row
})

const withTick = (row, tick) => {
  const next = { ...row }
  for (const field of FIELDS) next[field] = `r${row.id}-${field}-${tick}`
  return next
}

export default {
  components: { PropsRowObject },
  data() {
    return { rows: ROWS.slice(), tick: 0 }
  },
  methods: {
    updateFirst() {
      const nextTick = this.tick + 1
      this.tick = nextTick
      this.rows = this.rows.map((row, index) => (
        index === 0 ? withTick(row, nextTick) : row
      ))
    },
    updateAll() {
      const nextTick = this.tick + 1
      this.tick = nextTick
      this.rows = this.rows.map((row) => withTick(row, nextTick))
    },
  },
}
</script>

<style>
.bench { display: flex; flex-direction: column; }
</style>
