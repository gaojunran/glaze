<template>
  <view class="row-card">
    <text class="row-title">{{ a }}</text>
    <text class="prop">{{ a }}</text>
    <text class="prop">{{ b }}</text>
    <text class="prop">{{ c }}</text>
    <text class="prop">{{ d }}</text>
    <text class="prop">{{ e }}</text>
    <text class="prop">{{ f }}</text>
    <text class="prop">{{ g }}</text>
    <text class="prop">{{ h }}</text>
  </view>
</template>

<script setup>
defineProps({
  a: String,
  b: String,
  c: String,
  d: String,
  e: String,
  f: String,
  g: String,
  h: String,
})
</script>

<style>
.row-card { display: flex; height: 20px; align-items: center; gap: 4px; }
.row-title { font-size: 12px; }
.prop { font-size: 10px; color: #666; }
</style>
