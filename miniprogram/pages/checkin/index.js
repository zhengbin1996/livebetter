const app = getApp()
const content = require('../../utils/content')
const refs = require('../../utils/refs')
const store = require('../../utils/store')

Page({
  data: {
    tab: 'checkin', // checkin | fav
    items: [],
    all: [],
    done: 0,
    total: 0,
    percent: 0,
    loading: false,
    labelMap: null,
    filter: 'all', // all | todo | done
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
    const isCheckin = this.data.tab === 'checkin'
    const map = isCheckin ? store.getCheckins() : store.getFavorites()
    const sids = Object.keys(map)
    const resolved = await this.resolveMany(sids)

    const rows = resolved.map((it) => {
      const rec = map[it.sid] || {}
      return Object.assign({}, it, {
        done: !isCheckin || !!rec.done,
        checked: isCheckin ? !!rec.done : true,
      })
    })
    rows.sort((a, b) => (a.sec - b.sec) || (a.num - b.num))

    const done = isCheckin ? rows.filter((r) => r.checked).length : 0
    this.setData({
      all: rows,
      done,
      total: rows.length,
      percent: isCheckin && rows.length ? Math.round((done / rows.length) * 100) : 0,
    })
    this.applyFilter()
  },

  applyFilter() {
    const f = this.data.filter
    const src = this.data.all || []
    const isCheckin = this.data.tab === 'checkin'
    let list = src
    if (isCheckin && f === 'todo') list = src.filter((r) => !r.checked)
    if (isCheckin && f === 'done') list = src.filter((r) => r.checked)
    this.setData({ items: list })
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
    const tab = e.currentTarget.dataset.tab
    this.setData({ tab, filter: 'all', items: [], all: [], done: 0, total: 0, percent: 0 })
    this.build()
  },

  setFilter(e) {
    this.setData({ filter: e.currentTarget.dataset.f })
    this.applyFilter()
  },

  goItem(e) {
    refs.goItem(e.currentTarget.dataset.sid)
  },

  toggleDone(e) {
    const sid = e.currentTarget.dataset.sid
    const rec = store.getCheckin(sid) || { done: false }
    store.setCheckin(sid, { done: !rec.done })
    wx.showToast({ title: rec.done ? '标回待做' : '标为做到了', icon: 'none' })
    this.build()
  },

  remove(e) {
    const sid = e.currentTarget.dataset.sid
    if (this.data.tab === 'checkin') store.removeCheckin(sid)
    else store.removeFavorite(sid)
    wx.showToast({ title: '已移出', icon: 'none' })
    this.build()
  },

  goSearch() {
    wx.switchTab({ url: '/pages/search/index' })
  },
  goSections() {
    wx.navigateTo({ url: '/pages/section-list/index' })
  },
})
