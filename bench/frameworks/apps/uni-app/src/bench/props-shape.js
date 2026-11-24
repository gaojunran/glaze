const FIELDS = Array.from({ length: 16 }, (_, index) => `p${index + 1}`)

const createRows = () => Array.from({ length: 500 }, (_, index) => {
  const row = { id: index }
  for (const field of FIELDS) row[field] = `r${index}-${field}`
  return row
})

const withTick = (row, fields, tick) => {
  const next = { ...row }
  for (const field of fields) next[field] = `r${row.id}-${field}-${tick}`
  return next
}

export const createPropsShapePage = (propCount) => {
  const fields = FIELDS.slice(0, propCount)
  return {
    data() {
      return { rows: createRows(), tick: 0 }
    },
    methods: {
      updateFirst() {
        const nextTick = this.tick + 1
        this.tick = nextTick
        this.rows = this.rows.map((row, index) => (
          index === 0 ? withTick(row, fields, nextTick) : row
        ))
      },
      updateAll() {
        const nextTick = this.tick + 1
        this.tick = nextTick
        this.rows = this.rows.map((row) => withTick(row, fields, nextTick))
      },
    },
  }
}
