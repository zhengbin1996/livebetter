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
    /** 内容版本对不上、分片里没有这一条（与 offline 区别对待，提示与出路都不同） */
    notFound: false,
    /** 命中了跨版本兜底：是按「同一条的位置」打开的另一版正文 */
    stale: false,
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
    /** 清单状态：none | today | later | done */
    listState: 'none',
    labelMap: null,
    glossaryTerm: '',
    glossShow: false,
    disclaimer: cfg.DISCLAIMER,
  },

  async onLoad(query) {
    // 存下来给「重试」用：小程序里**没有** this.options（那是别的框架的习惯），
    // 之前 onRetry 取 this.options 恒为 undefined → 重试时退化成空参数 →
    // 又落到 BAD_PARAM，再弹一次「这条建议没找到」。
    this.query = query || {}
    await app.ready
    this.setData({ labelMap: ((app.globalData.essentials || {}).legend || {}).tagLabels || null })
    await this.load(this.query)
  },

  async load(query) {
    this.setData({ loading: true })
    try {
      const { shard, item, error, stale } = await content.resolveItem(query)
      if (!item) {
        this.setData({ loading: false, offline: error === 'NOT_FOUND', notFound: !error || error === 'NOT_FOUND' })
        // 三种情况对用户含义完全不同，不能都报「没找到」：
        //   参数脏（旧链接 `?sid=undefined`）/ 内容版本对不上 / 真离线
        if (error === 'BAD_PARAM') {
          wx.showToast({ title: '这条链接不对，回上一页重进', icon: 'none' })
        } else if (error === 'NOT_FOUND') {
          wx.showToast({ title: '内容可能已更新，去检索里找找', icon: 'none' })
        }
        return
      }
      const f = item.fields || {}
      const legend = (app.globalData.essentials || {}).legend || {}
      const rec = store.getCheckin(item.sid)
      this.setData({
        loading: false,
        offline: false,
        notFound: false,
        item,
        stale: !!stale,
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
        checkin: rec,
        listState: this.listStateOf(rec),
      })
      // 等级与档位的释义来自 README 原文，保证和书上一致
      const iso = (legend.evidence || []).find((e) => e.level === item.evidenceLevel)
      this.setData({ tierNote: iso ? iso.meaning : '' })
      wx.setNavigationBarTitle({ title: `${item.num}. ${item.title}`.slice(0, 18) })
      this.loadTitles(item)
    } catch (err) {
      // 分片没拿到（离线且未缓存）—— 与「内容里没这条」是两回事，别混成一句提示
      console.error('[item-detail] 取正文失败：', err)
      this.setData({ loading: false, offline: true, notFound: false })
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

  listStateOf(rec) {
    if (!rec) return 'none'
    if (rec.done) return 'done'
    return rec.plan === 'later' ? 'later' : 'today'
  },

  syncListState() {
    const rec = store.getCheckin(this.data.item.sid)
    this.setData({ checkin: rec, listState: this.listStateOf(rec) })
  },

  /** 主按钮：加进「今天」/ 从「今天」移出 / 把已完成的标回今天 */
  onCheckin() {
    const sid = this.data.item.sid
    const s = this.data.listState
    if (s === 'today') {
      store.removeCheckin(sid)
      wx.showToast({ title: '已移出清单', icon: 'none' })
    } else if (s === 'done') {
      store.setCheckin(sid, { done: false, plan: 'today' })
      wx.showToast({ title: '已标回「今天做」', icon: 'none' })
    } else {
      store.setCheckin(sid, { done: false, plan: 'today' })
      wx.showToast({ title: s === 'later' ? '已移到「今天做」' : '已加进清单 · 今天', icon: 'none' })
    }
    this.syncListState()
  },

  /** 次级动作：放到「稍后」（不做但先记着） */
  onLater() {
    const sid = this.data.item.sid
    if (this.data.listState === 'later') {
      store.removeCheckin(sid)
      wx.showToast({ title: '已移出清单', icon: 'none' })
    } else {
      store.setCheckin(sid, { done: false, plan: 'later' })
      wx.showToast({ title: '已放到「稍后」', icon: 'none' })
    }
    this.syncListState()
  },

  onCopySource() {
    const text = (this.data.item.fields || {})['来源'] || ''
    wx.setClipboardData({
      data: String(text).replace(/<[^>]+>/g, ''),
      success() { wx.showToast({ title: '来源已复制', icon: 'none' }) },
    })
  },

  onRetry() {
    this.load(this.query || {})
  },

  onSearch() {
    wx.switchTab({ url: '/pages/search/index' })
  },
})
