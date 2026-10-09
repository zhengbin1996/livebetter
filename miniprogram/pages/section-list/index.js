const app = getApp()

Page({
  data: {
    sections: [],
    q: '',
    all: [],
  },

  onLoad() {
    app.ready.then(() => this.apply())
  },

  onShow() {
    if (app.globalData.essentials) this.apply()
  },

  apply() {
    const e = app.globalData.essentials || {}
    const rows = (e.sections || []).map((s) => ({
      sec: s.sec,
      title: s.title,
      items: s.items,
      summary: s.summary || '',
      groups: s.groups || [],
      tierText: `极高 ${((s.tier || {})['极高']) || 0}`,
      evText: `A 级 ${((s.evidence || {}).A) || 0}`,
    }))
    this.setData({ all: rows })
    this.filter(this.data.q)
  },

  onInput(e) {
    this.setData({ q: e.detail.value })
    this.filter(e.detail.value)
  },

  filter(q) {
    const needle = String(q || '').trim()
    const src = this.data.all || []
    if (!needle) {
      this.setData({ sections: src })
      return
    }
    this.setData({
      sections: src.filter(
        (s) =>
          s.title.indexOf(needle) >= 0 ||
          s.summary.indexOf(needle) >= 0 ||
          s.groups.join('').indexOf(needle) >= 0
      ),
    })
  },

  clearQ() {
    this.setData({ q: '' })
    this.filter('')
  },

  onTap(e) {
    const sec = e.currentTarget.dataset.sec
    wx.navigateTo({ url: `/subpackages/read/pages/section-detail/index?sec=${sec}` })
  },
})
