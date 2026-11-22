<template>
  <view class="row-card">
    <text class="row-title">{{ label }}</text>
    <text class="row-index">{{ index }}</text>
    <text class="row-count">{{ count }}</text>
    <button class="row-bump" @click="bump">bump</button>
  </view>
</template>

<script setup>
import { ref } from 'vue'

const props = defineProps({
  label: String,
  index: Number,
})

const count = ref(0)
const bump = () => {
  count.value += 1
}
</script>

<style>
.row-card { display: flex; height: 20px; align-items: center; gap: 4px; }
.row-title { font-size: 12px; }
.row-index, .row-count { font-size: 10px; color: #666; }
</style>
