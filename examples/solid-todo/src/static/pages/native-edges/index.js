const LEVEL_COUNT = 10
const FIELD_COUNT = 20
const CARD_COUNT = 100
const EVENT_COUNT = 100

Page({
  data: {
    chains: Array.from({ length: LEVEL_COUNT }, (_, id) => ({ id, count: 0 })),
    fields: Array.from({ length: FIELD_COUNT }, (_, id) => ({ id, value: '' })),
    cards: Array.from({ length: CARD_COUNT }, (_, id) => ({ id, text: `Card ${id}` })),
    eventRows: Array.from({ length: EVENT_COUNT }, (_, id) => ({ id })),
    picked: 'none',
    picks: 0,
  },
  bumpLeaf(event) {
    const index = event.currentTarget.dataset.index
    this.setData({ [`chains[${index}].count`]: this.data.chains[index].count + 1 })
  },
  onFieldInput(event) {
    const index = event.currentTarget.dataset.index
    this.setData({ [`fields[${index}].value`]: event.detail.value })
  },
  updateCard() {
    const text = this.data.cards[0].text
    this.setData({ 'cards[0].text': text === 'Card 0' ? 'Card 0 changed' : 'Card 0' })
  },
  onPick(event) {
    const picks = this.data.picks + 1
    this.setData({ picks, picked: `picked-${event.detail}-${picks}` })
  },
})
