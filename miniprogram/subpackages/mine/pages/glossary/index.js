const app = getApp()

Page({
  data: {
    terms: [],
    filtered: [],
    q: '',
    openTerm: '',
    legend: null,
    tagRows: [],
    tab: 'terms', // terms | legend
  },

  async onLoad(query) {
    await app.ready
    const e = app.globalData.essentials || {}
    const terms = e.glossary || []
    const legend = e.legend || {}
    const labels = legend.tagLabels || {}
    const order = [
      ['money', '钱'],
      ['time', '时间'],
      ['will', '毅力'],
      ['benefit', '收益'],
      ['caliber', '口径'],
    ]
    const tagRows = order.map(([key, cn]) => {
      const m = labels[key] || {}
      const vals = Object.keys(m).map((k) => m[k])
      return { k: cn, v: vals.length ? vals.join(' / ') : '—' }
    })
    this.setData({
      terms,
      filtered: terms,
      legend,
      tagRows,
      tab: query && query.legend ? 'legend' : 'terms',
    })
  },

  switchTab(e) {
    this.setData({ tab: e.currentTarget.dataset.tab })
  },

  onInput(e) {
    const q = e.detail.value
    const needle = String(q || '').trim()
    const src = this.data.terms || []
    this.setData({
      q,
      filtered: needle
        ? src.filter((t) => t.term.indexOf(needle) >= 0 || t.meaning.indexOf(needle) >= 0)
        : src,
    })
  },

  clearQ() {
    this.setData({ q: '', filtered: this.data.terms })
  },

  toggleTerm(e) {
    const term = e.currentTarget.dataset.term
    this.setData({ openTerm: this.data.openTerm === term ? '' : term })
  },
})
