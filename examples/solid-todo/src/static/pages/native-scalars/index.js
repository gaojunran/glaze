Page({
  data: {
    s0: 0, s1: 1, s2: 2, s3: 3, s4: 4, s5: 5, s6: 6, s7: 7,
    s8: 8, s9: 9, s10: 10, s11: 11, s12: 12, s13: 13, s14: 14, s15: 15,
  },
  bump() {
    const next = {}
    for (let index = 0; index < 16; index += 1) next[`s${index}`] = this.data[`s${index}`] + 1
    this.setData(next)
  },
})
