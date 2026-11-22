Component({
  properties: {
    title: String,
    index: Number,
  },
  data: {
    count: 0,
  },
  methods: {
    bump() {
      this.setData({ count: this.data.count + 1 })
    },
  },
})
