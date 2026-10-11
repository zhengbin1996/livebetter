const app = getApp()
const content = require('../../../../utils/content')
const refs = require('../../../../utils/refs')
const store = require('../../../../utils/store')
const advice = require('../../../../utils/advice')
const favorites = require('../../../../utils/favorites')
const sectionGuide = require('../../../../utils/section-guide')
const share = require('../../../../utils/share')
const shareCover = require('../../../../utils/share-cover')

Page({
  data: {
    loading: true,
    offline: false,
    sec: 0,
    secTitle: '',
    intro: [],
    guideOpen: false,
    guideSourceOpen: false,
    overview: '',
    groups: [],
    items: [],
    glossaryTerm: '',
    glossShow: false,
    labelMap: null,
  },

  async onLoad(query) {
    this.setData({ singlePage: share.singlePage() })
    share.enable(false)
    await app.ready
    this.query = query || {}
    this.setData({
      labelMap: ((app.globalData.essentials || {}).legend || {}).tagLabels || null,
    })
    await this.load()
  },

  onShow() {
    favorites.show(this, this.markFav)
    // 从详情页返回时刷新收藏标记
    if (this.data.items.length) this.markFav()
  },
  onHide() { favorites.hide(this) },
  onUnload() { favorites.hide(this) },
  onReady() { if (this.shareCoverInfo) shareCover.prepare(this, this.shareCoverInfo) },
  onShareAppMessage() { return !this.data.loading && !this.data.offline ? shareCover.attach(this, share.section(this.data.sec, this.data.secTitle)) : share.home() },
  onShareTimeline() { return share.timeline(this.onShareAppMessage()) },

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
        intro: refs.readableHtml((shard.intro || []).join('')),
        introLen: (shard.intro || []).length,
        overview: refs.readableHtml(sectionGuide.overview(shard.intro, shard.groups)),
        groups: sectionGuide.navigation(shard.groups),
        items: (shard.items || []).map((item) => advice.remember(Object.assign({}, item, { sec: shard.sec }))),
      })
      wx.setNavigationBarTitle({ title: `${shard.sec}. ${shard.secTitle}`.slice(0, 20) })
      this.markFav()
      share.enable(true)
      if (!this.data.singlePage) shareCover.prepare(this, shareCover.section(shard.sec, shard.secTitle, shard.intro))
      if (this.query.num) {
        // 从条目详情跳进来时定位到那一条
        setTimeout(() => this.scrollToItem(this.query.num), 60)
      }
    } catch (e) {
      this.setData({ loading: false, offline: true })
      share.enable(false)
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

  /**
   * item-row 是自定义组件：它在 onTap 里 `triggerEvent('tapitem', { sid, item })`，
   * 参数落在 **e.detail**，不是 e.currentTarget.dataset（那是原生事件的取法）。
   * 之前取 dataset.sid 恒为 undefined，跳过去变成 `?sid=undefined`，
   * 详情页解析不出节号就弹「这条建议没找到」—— 节内列表每点一条必现。
   * 另外带上条号：万一 sid 与云端内容版本对不上，详情页还能按条号兜底落到同一条。
   */
  goItem(e) {
    if (share.requireFullApp()) return
    const d = (e && e.detail) || {}
    const it = d.item || null
    const sid = d.sid || (it && it.sid) || ''
    if (!sid) {
      // 不能静默：绑定形状再写错时，这里必须留下线索
      console.error('[section-detail] tapitem 没有带 sid：', e)
      wx.showToast({ title: '这条打不开，请退回重进', icon: 'none' })
      return
    }
    const num = it && it.num ? `&num=${it.num}` : ''
    wx.navigateTo({ url: `/pages/item-detail/index?sid=${sid}${num}` })
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

  toggleGuide() {
    this.setData({ guideOpen: !this.data.guideOpen })
  },
  toggleGuideSource() {
    this.setData({ guideSourceOpen: !this.data.guideSourceOpen })
  },

  onRetry() {
    this.load()
  },
})
