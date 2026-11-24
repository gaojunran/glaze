<template>
  <view class="bench">
    <text id="last">{{ rows[499].p8 }}</text>
    <button id="update" class="update" @click="updateFirst">update</button>
    <button id="update-all" class="update-all" @click="updateAll">update all</button>
    <props-shape-row
      v-for="row in rows"
      :key="row.id"
      class="row-card"
      :p1="row.p1"
      :p2="row.p2"
      :p3="row.p3"
      :p4="row.p4"
      :p5="row.p5"
      :p6="row.p6"
      :p7="row.p7"
      :p8="row.p8"
    />
  </view>
</template>

<script>
import PropsShapeRow from '../../components/PropsShapeRow.vue'
import { createPropsShapePage } from '../../bench/props-shape.js'

export default {
  components: { PropsShapeRow },
  ...createPropsShapePage(8),
}
</script>

<style>
.bench { display: flex; flex-direction: column; }
.row-card { display: flex; height: 20px; align-items: center; }
</style>
