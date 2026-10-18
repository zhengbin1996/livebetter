const app = getApp()
const cfg = require('../../config')
const store = require('../../utils/store')
const advice = require('../../utils/advice')
const adviceContent = require('../../utils/advice-content')
const favorites = require('../../utils/favorites')
const share = require('../../utils/share')

Page({
  data: {
    bookName: cfg.BOOK_NAME,
    tagline: '用最少的钱、时间和精力，换回寿命、金钱和人身自由',
    info: null,
    statsClaim: null,
    statLine: '',
    // 找问题：按处境分五组（来自 essentials.problemGroups）
    groups: [],
    disclaimer: cfg.DISCLAIMER,
    q: '',
    labelMap: null,
    pick: null,
    pickTotal: 0,
  },

  /** 分组的展开状态放页面实例上，不要进 data —— 否则 onShow 重建时会被重置 */
  openMap: {},

  async onLoad() {
    this.setData({ singlePage: share.singlePage() })
    share.enable(true)
    await app.ready
    this.apply()
    // 上游改标题会让条目 id 变；拿到新 manifest 后把收藏/打卡迁到新 id
    const m = app.globalData.manifest
    if (m && m.prevIdMap) {
      const n = store.migrate(m.prevIdMap)
      if (n) wx.showToast({ title: '本机记录已更新', icon: 'none' })
    }
  },

  onShow() {
    favorites.show(this)
    if (!share.singlePage() && this.getTabBar) {
      const tb = this.getTabBar()
      if (tb) tb.setTab(0)
    }
    if (app.globalData.essentials) this.apply(true)
  },

  onHide() { favorites.hide(this) },
  onUnload() { favorites.hide(this) },
  onShareAppMessage() { return share.home() },
  onShareTimeline() { return share.timeline(share.home()) },

  onAdviceOpen(event) {
    if (share.requireFullApp()) return
    const item = event.detail.item
    wx.navigateTo({ url: `/pages/item-detail/index?sid=${item.sid}${item.num ? `&num=${item.num}` : ''}` })
  },

  onAdviceRetry() { this.buildPick(0) },

  apply(shuffle) {
    const e = app.globalData.essentials || {}
    const legend = e.legend || {}
    const stats = e.stats || {}
    const ev = stats.evidence || {}
    const tier = stats.tier || {}
    const counts = e.counts || {}

    this.setData({
      info: app.versionInfo(),
      statsClaim: stats.claim || null,
      counts,
      statLine: `${counts.items} 条 · ${counts.sections} 节 · 证据 A 级 ${ev.A || 0} 条 · 性价比极高 ${tier['极高'] || 0} 条`,
      groups: this.buildGroups(e),
      labelMap: legend.tagLabels || null,
    })
    this.buildPick(shuffle)
  },

  buildGroups(e) {
    const problems = e.problems || []
    return (e.problemGroups || []).map((g) => ({
      key: g.key,
      name: g.name,
      tone: g.tone,
      count: g.count,
      open: !!this.openMap[g.key],
      problems: problems.filter((p) => p.group === g.key),
    }))
  },

  toggleGroup(e) {
    const key = e.currentTarget.dataset.key
    if (!key) return
    this.openMap[key] = !this.openMap[key]
    const groups = this.data.groups.map((g) =>
      g.key === key ? Object.assign({}, g, { open: this.openMap[key] }) : g
    )
    this.setData({ groups })
  },

  buildPick(shuffle) {
    const picks = ((app.globalData.essentials || {}).picks) || []
    const len = picks.length
    if (!len) {
      this.setData({ pick: null, pickTotal: 0 })
      return
    }
    let idx = picks.findIndex((pick) => this.data.pick && pick.sid === this.data.pick.sid)
    if (idx < 0) {
      idx = Math.floor(Math.random() * len)
    } else if (shuffle && len > 1) {
      // 从其余候选中均匀抽取，避免相邻两次显示同一条。
      const next = Math.floor(Math.random() * (len - 1))
      idx = next >= idx ? next + 1 : next
    }
    const selected = picks[idx]
    const p = advice.normalize(selected)
    this.setData({
      pick: p,
      pickTotal: len,
    })
    if (this.pickHydrating !== p.sid && !p.summaryFull) {
      this.pickHydrating = p.sid
      adviceContent.hydrate([p], (rows) => {
        if (this.favoritesActive && this.data.pick && this.data.pick.sid === p.sid) this.setData({ pick: rows[0] })
      }).finally(() => { if (this.pickHydrating === p.sid) this.pickHydrating = '' })
    }
  },

  onPickShuffle() {
    this.buildPick(1)
  },

  onPickOpen() {
    if (share.requireFullApp()) return
    const p = this.data.pick
    if (!p) return
    // 带上条号：万一内置索引与云端分片版本不一致，详情页还能按条号兜底落到同一条
    wx.navigateTo({ url: `/pages/item-detail/index?sid=${p.sid}${p.n ? `&num=${p.n}` : ''}` })
  },

  /* ---------------------------------------------------------------- 检索 */

  onSearchTap() {
    if (share.requireFullApp()) return
    wx.switchTab({ url: '/pages/search/index' })
  },

  onSearchInput(e) {
    this.setData({ q: e.detail.value })
  },

  onSearchConfirm() {
    if (share.requireFullApp()) return
    const q = (this.data.q || '').trim()
    if (!q) {
      wx.switchTab({ url: '/pages/search/index' })
      return
    }
    // tab 页之间不能带参数，把待查词放进 globalData 由检索页取走
    app.globalData.pendingQuery = q
    wx.switchTab({ url: '/pages/search/index' })
  },

  /* ---------------------------------------------------------------- 导航 */

  onProblem(e) {
    if (share.requireFullApp()) return
    const sec = e.currentTarget.dataset.sec
    if (!sec) return
    wx.navigateTo({ url: `/subpackages/read/pages/section-detail/index?sec=${sec}` })
  },

  goSections() {
    if (share.requireFullApp()) return
    wx.navigateTo({ url: '/pages/section-list/index' })
  },

  noop() {},
})
