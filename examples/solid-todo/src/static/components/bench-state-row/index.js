Component({
  data: {
    clicks: 0,
  },
  methods: {
    bump() {
      this.setData({ clicks: this.data.clicks + 1 })
    },
  },
})
