const app = getApp()
const content = require('../../../../utils/content')
const refs = require('../../../../utils/refs')

Page({
  data: {
    // 列表态
    list: [],
    filtered: [],
    q: '',
    // 阅读态
    sid: '',
    loading: false,
    offline: false,
    doc: null,
    tocOpen: false,
    glossaryTerm: '',
    glossShow: false,
  },

  async onLoad(query) {
    await app.ready
    this.query = query || {}
    const all = (app.globalData.essentials || {}).verify || []
    this.setData({ list: all, filtered: all })
    if (this.query.sid) {
      this.setData({ sid: this.query.sid })
      await this.loadDoc(this.query.sid)
    }
  },

  onInput(e) {
    const q = e.detail.value
    const needle = String(q || '').trim()
    const src = this.data.list || []
    this.setData({
      q,
      filtered: needle ? src.filter((d) => d.title.indexOf(needle) >= 0 || d.name.indexOf(needle) >= 0) : src,
    })
  },

  clearQ() {
    this.setData({ q: '', filtered: this.data.list })
  },

  async open(e) {
    const sid = e.currentTarget.dataset.sid
    this.setData({ sid })
    await this.loadDoc(sid)
  },

  async loadDoc(sid) {
    this.setData({ loading: true })
    try {
      const doc = await content.loadVerify(sid)
      this.setData({ loading: false, offline: false, doc })
      wx.setNavigationBarTitle({ title: doc.title.slice(0, 18) })
    } catch (err) {
      this.setData({ loading: false, offline: true })
    }
  },

  backList() {
    this.setData({ sid: '', doc: null, offline: false })
    wx.setNavigationBarTitle({ title: '核实记录' })
  },

  toggleToc() {
    this.setData({ tocOpen: !this.data.tocOpen })
  },
  goHead(e) {
    this.setData({ tocOpen: false })
    wx.pageScrollTo({ selector: `#${e.currentTarget.dataset.id}`, duration: 200, offsetTop: -20, fail() {} })
  },

  onLinkTap(e) {
    const href = e.detail && e.detail.href
    if (!href) return
    const info = refs.handle(href)
    if (info.kind === 'ref') refs.goItem(info.sid)
    else if (info.kind === 'gloss') this.setData({ glossaryTerm: info.term, glossShow: true })
  },
  onGlossClose() {
    this.setData({ glossShow: false })
  },

  onRetry() {
    if (this.data.sid) this.loadDoc(this.data.sid)
  },
})
