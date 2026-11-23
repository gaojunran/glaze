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
  updateFirst() {
    this.setData({
      tick: this.data.tick + 1,
      'items[0].title': `Item 0 ${this.data.tick + 1}`,
    })
  },
  reverse() {
    this.setData({ items: this.data.items.slice().reverse() })
  },
})
