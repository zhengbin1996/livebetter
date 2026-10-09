const app = getApp()
const content = require('../../../../utils/content')
const refs = require('../../../../utils/refs')

Page({
  data: {
    loading: true,
    offline: false,
    doc: null,
    toc: [],
    tocOpen: false,
    glossaryTerm: '',
    glossShow: false,
    big: false,
  },

  async onLoad(query) {
    await app.ready
    this.query = query || {}
    await this.load()
  },

  async load() {
    const sid = this.query.sid
    if (!sid) {
      this.setData({ loading: false, offline: true })
      return
    }
    try {
      const doc = await content.loadDoc(sid)
      this.setData({
        loading: false,
        offline: false,
        doc,
        // 只展示前两级标题，再深就成噪音了
        toc: (doc.toc || []).filter((t) => t.level <= 2),
        // 超长文档（如「引用对照」268 KB）提示折叠大纲
        big: (doc.chars || 0) > 60000,
      })
      wx.setNavigationBarTitle({ title: doc.title.slice(0, 20) })
    } catch (e) {
      this.setData({ loading: false, offline: true })
    }
  },

  toggleToc() {
    this.setData({ tocOpen: !this.data.tocOpen })
  },

  goHead(e) {
    const id = e.currentTarget.dataset.id
    this.setData({ tocOpen: false })
    wx.pageScrollTo({ selector: `#${id}`, duration: 200, offsetTop: -20, fail() {} })
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
    this.load()
  },
})
