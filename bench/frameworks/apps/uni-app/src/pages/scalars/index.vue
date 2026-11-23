<template>
  <view class="bench">
    <text id="tick">{{ s0 }}</text>
    <button id="bump" class="bump" @click="bump">bump</button>
    <text class="scalar"><text class="scalar-value">{{ s0 }}</text></text>
    <text class="scalar"><text class="scalar-value">{{ s1 }}</text></text>
    <text class="scalar"><text class="scalar-value">{{ s2 }}</text></text>
    <text class="scalar"><text class="scalar-value">{{ s3 }}</text></text>
    <text class="scalar"><text class="scalar-value">{{ s4 }}</text></text>
    <text class="scalar"><text class="scalar-value">{{ s5 }}</text></text>
    <text class="scalar"><text class="scalar-value">{{ s6 }}</text></text>
    <text class="scalar"><text class="scalar-value">{{ s7 }}</text></text>
    <text class="scalar"><text class="scalar-value">{{ s8 }}</text></text>
    <text class="scalar"><text class="scalar-value">{{ s9 }}</text></text>
    <text class="scalar"><text class="scalar-value">{{ s10 }}</text></text>
    <text class="scalar"><text class="scalar-value">{{ s11 }}</text></text>
    <text class="scalar"><text class="scalar-value">{{ s12 }}</text></text>
    <text class="scalar"><text class="scalar-value">{{ s13 }}</text></text>
    <text class="scalar"><text class="scalar-value">{{ s14 }}</text></text>
    <text class="scalar"><text class="scalar-value">{{ s15 }}</text></text>
  </view>
</template>

<script>
export default {
  data() {
    return {
      s0: 0,
      s1: 1,
      s2: 2,
      s3: 3,
      s4: 4,
      s5: 5,
      s6: 6,
      s7: 7,
      s8: 8,
      s9: 9,
      s10: 10,
      s11: 11,
      s12: 12,
      s13: 13,
      s14: 14,
      s15: 15,
    }
  },
  methods: {
    bump() {
      this.s0 += 1
      this.s1 += 1
      this.s2 += 1
      this.s3 += 1
      this.s4 += 1
      this.s5 += 1
      this.s6 += 1
      this.s7 += 1
      this.s8 += 1
      this.s9 += 1
      this.s10 += 1
      this.s11 += 1
      this.s12 += 1
      this.s13 += 1
      this.s14 += 1
      this.s15 += 1
    },
  },
}
</script>

<style>
.bench { display: flex; flex-direction: column; }
.scalar { font-size: 11px; height: 20px; }
.scalar-value { font-size: 11px; }
</style>
