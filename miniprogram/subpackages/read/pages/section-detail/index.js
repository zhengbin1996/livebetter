const app = getApp()
const content = require('../../../../utils/content')
const refs = require('../../../../utils/refs')
const store = require('../../../../utils/store')

Page({
  data: {
    loading: true,
    offline: false,
    sec: 0,
    secTitle: '',
    intro: [],
    groups: [],
    items: [],
    glossaryTerm: '',
    glossShow: false,
    labelMap: null,
  },

  async onLoad(query) {
    await app.ready
    this.query = query || {}
    this.setData({
      labelMap: ((app.globalData.essentials || {}).legend || {}).tagLabels || null,
    })
    await this.load()
  },

  onShow() {
    // 从详情页返回时刷新收藏标记
    if (this.data.items.length) this.markFav()
  },

  async load() {
    const sec = parseInt(this.query.sec, 10)
    if (!sec) {
      this.setData({ loading: false, offline: true })
      return
    }
    try {
      const shard = await content.loadSection(sec)
      this.setData({
        loading: false,
        offline: false,
        sec: shard.sec,
        secTitle: shard.secTitle,
        // mp-html 的 content 传字符串最稳（数组形态在不同版本行为不一致）
        intro: (shard.intro || []).join(''),
        introLen: (shard.intro || []).length,
        groups: shard.groups || [],
        items: shard.items || [],
      })
      wx.setNavigationBarTitle({ title: `${shard.sec}. ${shard.secTitle}`.slice(0, 20) })
      this.markFav()
      if (this.query.num) {
        // 从条目详情跳进来时定位到那一条
        setTimeout(() => this.scrollToItem(this.query.num), 60)
      }
    } catch (e) {
      this.setData({ loading: false, offline: true })
    }
  },

  scrollToItem(num) {
    wx.pageScrollTo({ selector: `#i${num}`, duration: 200, offsetTop: -12, fail() {} })
  },

  markFav() {
    const items = this.data.items.map((it) =>
      Object.assign({}, it, { fav: store.isFavorite(it.sid) })
    )
    this.setData({ items })
  },

  goItem(e) {
    const sid = e.currentTarget.dataset.sid
    wx.navigateTo({ url: `/pages/item-detail/index?sid=${sid}` })
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

  goGroup(e) {
    const num = e.currentTarget.dataset.num
    if (num) this.scrollToItem(num)
  },

  onRetry() {
    this.load()
  },
})
