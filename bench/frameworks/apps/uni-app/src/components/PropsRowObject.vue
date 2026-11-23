<template>
  <view class="row-card">
    <text class="row-title">{{ row.a }}</text>
    <text class="prop">{{ row.a }}</text>
    <text class="prop">{{ row.b }}</text>
    <text class="prop">{{ row.c }}</text>
    <text class="prop">{{ row.d }}</text>
    <text class="prop">{{ row.e }}</text>
    <text class="prop">{{ row.f }}</text>
    <text class="prop">{{ row.g }}</text>
    <text class="prop">{{ row.h }}</text>
  </view>
</template>

<script setup>
defineProps({
  row: Object,
})
</script>

<style>
.row-card { display: flex; height: 20px; align-items: center; gap: 4px; }
.row-title { font-size: 12px; }
.prop { font-size: 10px; color: #666; }
</style>
