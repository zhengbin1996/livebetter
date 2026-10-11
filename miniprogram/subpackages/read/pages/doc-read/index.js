const app = getApp()
const content = require('../../../../utils/content')
const refs = require('../../../../utils/refs')
const reader = require('../../../../utils/reader-content')
const share = require('../../../../utils/share')
const shareCover = require('../../../../utils/share-cover')

Page({
  data: {
    loading: true,
    offline: false,
    doc: null,
    toc: [],
    tocOpen: false,
    glossaryTerm: '',
    glossShow: false,
  },

  async onLoad(query) {
    this.setData({ singlePage: share.singlePage() })
    share.enable(false)
    await app.ready
    this.query = query || {}
    await this.load()
  },
  onReady() { if (this.shareCoverInfo) shareCover.prepare(this, this.shareCoverInfo) },
  onShareAppMessage() { return !this.data.loading && !this.data.offline ? shareCover.attach(this, share.doc(this.data.doc)) : share.home() },
  onShareTimeline() { return share.timeline(this.onShareAppMessage()) },

  async load() {
    const sid = this.query.sid
    if (!sid || !reader.readableDocs(app.globalData.essentials).some((entry) => entry.sid === sid)) {
      this.setData({ loading: false, offline: true })
      return
    }
    try {
      const doc = await content.loadDoc(sid)
      this.setData({
        loading: false,
        offline: false,
        doc: Object.assign({}, doc, { body: refs.readableHtml(doc.body) }),
        // 只展示前两级标题，再深就成噪音了
        toc: (doc.toc || []).filter((t) => t.level <= 2),
      })
      wx.setNavigationBarTitle({ title: doc.title.slice(0, 20) })
      share.enable(true)
      if (!this.data.singlePage) shareCover.prepare(this, shareCover.doc(doc))
    } catch (e) {
      this.setData({ loading: false, offline: true })
      share.enable(false)
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
