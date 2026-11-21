Page({
  data: {
    tick: 0,
    items: Array.from({ length: 1000 }, (_, index) => ({
      id: index,
      title: `Item ${index}`,
    })),
  },
  bump() {
    this.setData({ tick: this.data.tick + 1 })
  },
})
