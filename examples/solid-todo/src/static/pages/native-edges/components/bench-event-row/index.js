Component({
  properties: {
    rowid: {
      type: Number,
      value: 0,
    },
  },
  data: {
    clicks: 0,
  },
  methods: {
    pick() {
      this.setData({ clicks: this.data.clicks + 1 })
      this.triggerEvent('pick', this.data.rowid)
    },
  },
})
