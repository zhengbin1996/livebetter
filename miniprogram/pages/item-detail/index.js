const app = getApp()
const cfg = require('../../config')
const content = require('../../utils/content')
const refs = require('../../utils/refs')
const store = require('../../utils/store')
const fmt = require('../../utils/fmt')

Page({
  data: {
    loading: true,
    offline: false,
    item: null,
    sec: 0,
    secTitle: '',
    crumb: '',
    // 渲染好的字段：说人话单独放最高位，其余按固定顺序
    plainHtml: '',
    benefitHtml: '',
    costHtml: '',
    noteHtml: '',
    sourceHtml: '',
    evidenceText: '',
    tierNote: '',
    refsOut: [],
    refsIn: [],
    fav: false,
    checkin: null,
    labelMap: null,
    glossaryTerm: '',
    glossShow: false,
    disclaimer: cfg.DISCLAIMER,
  },

  async onLoad(query) {
    await app.ready
    this.setData({ labelMap: ((app.globalData.essentials || {}).legend || {}).tagLabels || null })
    await this.load(query)
  },

  async load(query) {
    this.setData({ loading: true })
    try {
      const { shard, item, error } = await content.resolveItem(query)
      if (!item) {
        this.setData({ loading: false, offline: error === 'NOT_FOUND' })
        wx.showToast({ title: '这条建议没找到', icon: 'none' })
        return
      }
      const f = item.fields || {}
      const legend = (app.globalData.essentials || {}).legend || {}
      this.setData({
        loading: false,
        offline: false,
        item,
        sec: shard.sec,
        secTitle: shard.secTitle,
        crumb: fmt.crumb(shard.sec, item.num, shard.secTitle),
        plainHtml: f['说人话'] || '',
        benefitHtml: f['收益'] || '',
        costHtml: f['成本'] || '',
        noteHtml: f['备注'] || '',
        sourceHtml: f['来源'] || '',
        evidenceText: fmt.evidenceText(item.evidenceLevel),
        refsOut: item.refs || [],
        refsIn: item.refIn || [],
        fav: store.isFavorite(item.sid),
        checkin: store.getCheckin(item.sid),
      })
      // 等级与档位的释义来自 README 原文，保证和书上一致
      const iso = (legend.evidence || []).find((e) => e.level === item.evidenceLevel)
      this.setData({ tierNote: iso ? iso.meaning : '' })
      wx.setNavigationBarTitle({ title: `${item.num}. ${item.title}`.slice(0, 18) })
      this.loadTitles(item)
    } catch (err) {
      this.setData({ loading: false, offline: true })
    }
  },

  /**
   * 补上「指向哪条」的标题。同节命中内存缓存、跨节各多下一个分片，
   * 拿不到（离线且未缓存）就不显示标题，链接本身仍然可点。
   */
  async loadTitles(item) {
    const out = item.refs || []
    if (!out.length) return
    const secs = []
    out.forEach((r) => {
      if (r.toSec && secs.indexOf(r.toSec) < 0) secs.push(r.toSec)
    })
    const titles = {}
    for (const s of secs) {
      try {
        const shard = await content.loadSection(s)
        ;(shard.items || []).forEach((it) => { titles[it.sid] = it.title })
      } catch (e) {
        /* 未缓存，跳过 */
      }
    }
    this.setData({
      refsOut: out.map((r) => Object.assign({}, r, { targetTitle: titles[r.toSid] || '' })),
    })
  },

  onCellTap() {
    wx.navigateTo({ url: '/subpackages/mine/pages/glossary/index?legend=1' })
  },

  /** mp-html 的全部点击都在这里落地 */
  onLinkTap(e) {
    const href = e.detail && e.detail.href
    if (!href) return
    const info = refs.handle(href)
    if (info.kind === 'ref') {
      refs.goItem(info.sid)
    } else if (info.kind === 'gloss') {
      this.setData({ glossaryTerm: info.term, glossShow: true })
    }
  },
  onGlossClose() {
    this.setData({ glossShow: false })
  },

  goSection() {
    wx.navigateTo({ url: `/subpackages/read/pages/section-detail/index?sec=${this.data.sec}&num=${this.data.item.num}` })
  },
  goRef(e) {
    refs.goItem(e.currentTarget.dataset.sid)
  },
  goSec(e) {
    wx.navigateTo({ url: `/subpackages/read/pages/section-detail/index?sec=${e.currentTarget.dataset.sec}` })
  },

  onFav() {
    const on = store.toggleFavorite(this.data.item.sid)
    this.setData({ fav: on })
    wx.showToast({ title: on ? '已收藏' : '已取消收藏', icon: 'none' })
  },

  onCheckin() {
    const cur = this.data.checkin || { done: false }
    const next = store.setCheckin(this.data.item.sid, { done: !cur.done })
    this.setData({ checkin: next })
    wx.showToast({ title: next.done ? '已记进清单' : '已移出清单', icon: 'none' })
  },

  onCopySource() {
    const text = (this.data.item.fields || {})['来源'] || ''
    wx.setClipboardData({
      data: String(text).replace(/<[^>]+>/g, ''),
      success() { wx.showToast({ title: '来源已复制', icon: 'none' }) },
    })
  },

  onRetry() {
    this.load(this.options || {})
  },
})
