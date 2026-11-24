<template>
  <view class="bench">
    <text id="tick">{{ tick }}</text>
    <text id="title">{{ rows[0].title }}</text>
    <text id="tag">{{ rows[0].meta.tag }}</text>
    <button id="deep" class="deep" @click="deep">deep</button>
    <button id="rotate" class="rotate" @click="rotate">rotate</button>
    <button id="reverse" class="reverse" @click="reverse">reverse</button>
    <button id="mfront" class="mfront" @click="moveFront">move front</button>
    <button id="swap" class="swap" @click="swap">swap ends</button>
    <view v-for="row in rows" :key="row.id" class="row">
      <text class="row-title">{{ row.title }}</text>
      <text class="row-done">{{ row.done }}</text>
      <text class="row-tag">{{ row.meta.tag }}</text>
    </view>
  </view>
</template>

<script>
const ROWS = Array.from({ length: 2000 }, (_, index) => ({
  id: index,
  title: `Row ${index}`,
  done: index % 2 === 0,
  meta: { tag: `tag-${index}` },
}))

export default {
  data() {
    return { rows: ROWS.slice(), tick: 0 }
  },
  methods: {
    deep() {
      const nextTick = this.tick + 1
      this.tick = nextTick
      const first = this.rows[0]
      this.rows = [
        { ...first, meta: { ...first.meta, tag: `tag-${first.id}-${nextTick}` } },
        ...this.rows.slice(1),
      ]
    },
    rotate() {
      const last = this.rows[this.rows.length - 1]
      this.rows = [last, ...this.rows.slice(0, this.rows.length - 1)]
    },
    reverse() {
      this.rows = this.rows.slice().reverse()
    },
    moveFront() {
      const next = this.rows.slice()
      const [row] = next.splice(1000, 1)
      this.rows = [row, ...next]
    },
    swap() {
      if (this.rows.length < 2) return
      const next = this.rows.slice()
      const last = next.length - 1
      ;[next[0], next[last]] = [next[last], next[0]]
      this.rows = next
    },
  },
}
</script>

<style>
.bench { display: flex; flex-direction: column; }
.row { height: 20px; }
.row-title { font-size: 12px; }
.row-done, .row-tag { font-size: 10px; color: #666; }
</style>
