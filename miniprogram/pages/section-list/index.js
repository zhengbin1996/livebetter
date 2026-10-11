const app = getApp()
const reader = require('../../utils/reader-content')
const share = require('../../utils/share')

Page({
  data: {
    sections: [],
    q: '',
    tab: 'sections',
    docs: [],
  },

  onLoad(query) {
    this.setData({ singlePage: share.singlePage() })
    share.enable(true)
    if (query && query.tab === 'docs') this.setData({ tab: 'docs' })
    app.ready.then(() => this.apply())
  },

  onShow() {
    if (app.globalData.essentials) this.apply()
  },
  onShareAppMessage() { return share.directory(this.data.tab) },
  onShareTimeline() { return share.timeline(share.directory(this.data.tab)) },

  apply() {
    const essentials = app.globalData.essentials || {}
    this.allSections = essentials.sections || []
    this.allDocs = reader.readableDocs(essentials)
    this.views = this.views || { sections: { q: '', scroll: 0 }, docs: { q: '', scroll: 0 } }
    this.filter(this.data.q)
  },

  onPageScroll(event) {
    if (this.views) this.views[this.data.tab].scroll = event.scrollTop
  },

  switchTab(event) {
    const tab = event.currentTarget.dataset.tab
    if (!this.views || !this.views[tab] || tab === this.data.tab) return
    this.views[this.data.tab].q = this.data.q
    const view = this.views[tab]
    this.setData({ tab, q: view.q })
    this.filter(view.q, () => wx.pageScrollTo({ scrollTop: view.scroll, duration: 0 }))
  },

  onInput(e) {
    this.setData({ q: e.detail.value })
    this.views[this.data.tab].q = e.detail.value
    this.filter(e.detail.value)
  },

  filter(q, callback) {
    const needle = String(q || '').trim().toLowerCase()
    const source = this.data.tab === 'docs' ? this.allDocs : this.allSections
    const rows = (source || []).filter((entry) => !needle || [entry.title, entry.summary, ...(entry.groups || []), ...(entry.headings || [])].join(' ').toLowerCase().includes(needle))
    this.setData({ [this.data.tab]: rows }, callback)
  },

  clearQ() {
    this.onInput({ detail: { value: '' } })
  },

  onTap(e) {
    if (share.requireFullApp()) return
    const sec = e.currentTarget.dataset.sec
    wx.navigateTo({ url: `/subpackages/read/pages/section-detail/index?sec=${sec}` })
  },

  onDoc(event) {
    if (share.requireFullApp()) return
    wx.navigateTo({ url: `/subpackages/read/pages/doc-read/index?sid=${event.currentTarget.dataset.sid}` })
  },
})
