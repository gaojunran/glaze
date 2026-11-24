<template>
  <view class="row-card">
    <text class="row-title">{{ p1 }} {{ p2 }} {{ p3 }} {{ p4 }} {{ p5 }} {{ p6 }} {{ p7 }} {{ p8 }} {{ p9 }} {{ p10 }} {{ p11 }} {{ p12 }} {{ p13 }} {{ p14 }} {{ p15 }} {{ p16 }}</text>
  </view>
</template>

<script setup>
defineProps({
  p1: String,
  p2: String,
  p3: String,
  p4: String,
  p5: String,
  p6: String,
  p7: String,
  p8: String,
  p9: String,
  p10: String,
  p11: String,
  p12: String,
  p13: String,
  p14: String,
  p15: String,
  p16: String,
})
</script>

<style>
.row-card { display: flex; height: 20px; align-items: center; }
.row-title { font-size: 12px; }
</style>
