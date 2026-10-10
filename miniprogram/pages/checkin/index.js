const app = getApp()
const content = require('../../utils/content')
const refs = require('../../utils/refs')
const store = require('../../utils/store')

/**
 * 清单 = 行动看板，不是收藏夹。
 *
 * 旧版把「收藏」和「待办」混在一个 `3 / 12 · 25%` 的进度条里 ——
 * 那条进度条隐含的心智模型是「做完 12 条就完成」，
 * 而这本书的用法恰恰是「挑一两条先做」，UI 在鼓励错误的期待。
 * 现在按行动节奏分成 今天 / 稍后 / 已完成，并给出连续天数。
 */

const TABS = [
  { key: 'today', label: '今天' },
  { key: 'later', label: '稍后' },
  { key: 'done', label: '已完成' },
  { key: 'fav', label: '收藏' },
]

Page({
  data: {
    tabs: TABS.map((t) => ({ key: t.key, label: t.label, n: 0 })),
    tab: 'today',
    items: [],
    loading: false,
    labelMap: null,
    counts: { today: 0, later: 0, done: 0, fav: 0 },
    streak: 0,
    todayDone: 0,
    hint: '',
    isEmpty: true,
  },

  async onLoad() {
    await app.ready
    this.setData({
      labelMap: ((app.globalData.essentials || {}).legend || {}).tagLabels || null,
    })
  },

  onShow() {
    if (this.getTabBar) {
      const tb = this.getTabBar()
      if (tb) tb.setTab(2)
    }
    this.refresh(true)
  },

  async refresh(pullToo) {
    this.setData({ loading: true })
    if (pullToo) await store.pull()
    await this.build()
    this.setData({ loading: false })
  },

  async build() {
    const tab = this.data.tab
    const checkMap = store.getCheckins()
    const favMap = store.getFavorites()
    const buckets = store.listBuckets()

    let sids
    let map
    if (tab === 'fav') {
      map = favMap
      sids = Object.keys(favMap)
    } else {
      map = checkMap
      sids = buckets[tab] || []
    }

    const resolved = await this.resolveMany(sids)
    const rows = resolved
      .map((it) => {
        const rec = map[it.sid] || {}
        return Object.assign({}, it, {
          done: tab === 'fav' ? false : !!rec.done,
          plan: rec.plan || 'today',
        })
      })
      .sort((a, b) => (a.sec - b.sec) || (a.num - b.num))

    const day = store.dayStats()
    const counts = {
      today: buckets.today.length,
      later: buckets.later.length,
      done: buckets.done.length,
      fav: Object.keys(favMap).length,
    }
    this.setData({
      items: rows,
      isEmpty: !rows.length,
      counts,
      tabs: TABS.map((t) => ({ key: t.key, label: t.label, n: counts[t.key] })),
      streak: day.streak,
      todayDone: day.today,
      hint: this.hintFor(counts, day.today),
    })
  },

  hintFor(counts, todayDone) {
    if (todayDone > 0) return '要不要再挑一条？'
    if (counts.today > 0) return '从下面挑一条开始，做完打勾'
    if (counts.later > 0) return '「今天」是空的，从「稍后」里挑一条放进来'
    if (counts.done > 0) return '今天还没打勾；休息也是允许的'
    return '在任一条建议的详情页底部点「今天做」，就会出现在这里'
  },

  /**
   * 把 sid 解析成条目标题。按节分组后只下载必需的分片，
   * 收藏分散在 34 节时最多 34 个分片；未缓存的会被安静跳过。
   */
  async resolveMany(sids) {
    const bySec = {}
    sids.forEach((sid) => {
      const sec = content.secFromSid(sid)
      if (!sec) return
      ;(bySec[sec] = bySec[sec] || []).push(sid)
    })
    const out = []
    for (const sec of Object.keys(bySec)) {
      try {
        const shard = await content.loadSection(Number(sec))
        const want = bySec[sec]
        ;(shard.items || []).forEach((it) => {
          if (want.indexOf(it.sid) >= 0) out.push(Object.assign({}, it, { sec: shard.sec }))
        })
      } catch (e) {
        // 未缓存或离线：这条先不显示，下次联网再补
      }
    }
    return out
  },

  switchTab(e) {
    this.setData({ tab: e.currentTarget.dataset.tab, items: [] })
    this.build()
  },

  goItem(e) {
    refs.goItem(e.currentTarget.dataset.sid)
  },

  toggleDone(e) {
    const sid = e.currentTarget.dataset.sid
    const rec = store.getCheckin(sid) || { done: false, plan: 'today' }
    store.setCheckin(sid, { done: !rec.done })
    wx.showToast({ title: rec.done ? '标回待做' : '标为做到了', icon: 'none' })
    this.build()
  },

  /** 今天做不了，挪到「稍后」 */
  toLater(e) {
    const sid = e.currentTarget.dataset.sid
    store.setPlan(sid, 'later')
    wx.showToast({ title: '已挪到稍后', icon: 'none' })
    this.build()
  },

  /** 「稍后」里挑回今天 */
  toToday(e) {
    const sid = e.currentTarget.dataset.sid
    store.setPlan(sid, 'today')
    wx.showToast({ title: '已放回今天', icon: 'none' })
    this.build()
  },

  remove(e) {
    const sid = e.currentTarget.dataset.sid
    if (this.data.tab === 'fav') store.removeFavorite(sid)
    else store.removeCheckin(sid)
    wx.showToast({ title: '已移出', icon: 'none' })
    this.build()
  },

  goSearch() {
    wx.switchTab({ url: '/pages/search/index' })
  },
  goSections() {
    wx.navigateTo({ url: '/pages/section-list/index' })
  },
  /** 完成一条之后，回「今天」再挑一条 —— 闭环的下一步 */
  goToday() {
    wx.switchTab({ url: '/pages/index/index' })
  },
})
