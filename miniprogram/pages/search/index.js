const app = getApp()
const cloud = require('../../utils/cloud')
const content = require('../../utils/content')
const refs = require('../../utils/refs')
const advice = require('../../utils/advice')
const adviceContent = require('../../utils/advice-content')
const favorites = require('../../utils/favorites')
const reader = require('../../utils/reader-content')

/** 三维成本筛选 + 章节 / 证据等级 / 性价比 / 口径 */
const COST_DIMS = [
  { key: 'money', label: '花钱', opts: [['0', '不花钱'], ['少', '花一点'], ['多', '花不少']] },
  { key: 'time', label: '花时间', opts: [['少', '不占时间'], ['中', '占一些'], ['多', '占很多']] },
  { key: 'will', label: '要毅力', opts: [['否', '不用'], ['些', '要一点'], ['是', '很吃毅力']] },
]

const PAGE_SIZE = 30

Page({
  data: {
    q: '',
    searching: false,
    hits: [],
    visible: [],
    total: 0,
    byServer: false,
    offline: false,
    shown: 0,
    sealed: [],
    filtersOpen: false,
    draft: null,
    activeFilters: [],
    costDims: COST_DIMS,
    cost: { money: '', time: '', will: '' },
    grade: '',
    tier: '',
    caliber: '',
    secs: [],
    sec: '',
    labelMap: null,
    tabs: ['全部', '只看证据 A', '只看性价比极高'],
    tab: 0,
    hasSearched: false,
  },

  async onLoad() {
    await app.ready
    const e = app.globalData.essentials || {}
    this.setData({
      secs: (e.sections || []).map((s) => ({ sec: s.sec, title: s.title })),
      labelMap: (e.legend || {}).tagLabels || null,
      sealed: this.readHistory(),
    })
  },

  onShow() {
    favorites.show(this)
    if (this.getTabBar) {
      const tb = this.getTabBar()
      if (tb) tb.setTab(1)
    }
    const pending = app.globalData.pendingQuery
    if (pending) {
      app.globalData.pendingQuery = ''
      this.setData({ q: pending })
      this.run()
    }
  },
  onHide() { favorites.hide(this); this.closeFilters() },
  onUnload() { favorites.hide(this); this.requestId = (this.requestId || 0) + 1 },

  readHistory() {
    try { return wx.getStorageSync('htb.search-history') || [] } catch (error) { return [] }
  },

  onInput(e) {
    this.requestId = (this.requestId || 0) + 1
    this.setData({ q: e.detail.value, searching: false })
  },
  onConfirm() {
    this.run()
  },
  clearQ() {
    this.requestId = (this.requestId || 0) + 1
    this.setData({
      q: '', hits: [], visible: [], total: 0, shown: 0,
      byServer: false, offline: false, hasSearched: false, searching: false,
    })
  },

  toggleFilters() {
    if (this.data.filtersOpen) return this.closeFilters()
    wx.hideKeyboard()
    this.setData({ filtersOpen: true, draft: {
      cost: Object.assign({}, this.data.cost), grade: this.data.grade,
      tier: this.data.tier, caliber: this.data.caliber, sec: this.data.sec,
    } })
  },
  closeFilters() { this.setData({ filtersOpen: false, draft: null }) },
  noop() {},
  applyFilters() {
    const draft = this.data.draft
    if (!draft) return
    this.setData(Object.assign({}, draft, { filtersOpen: false, draft: null, tab: this.tabFor(draft) }))
    this.updateFilterLabels()
    if (this.data.q) this.run()
  },
  tabFor(filters) {
    if (!filters.grade && !filters.tier) return 0
    if (filters.grade === 'A' && !filters.tier) return 1
    if (!filters.grade && filters.tier === '极高') return 2
    return -1
  },
  updateFilterLabels() {
    const filters = []
    const data = this.data
    if (data.grade) filters.push({ key: 'grade', label: '证据 ' + data.grade })
    if (data.tier) filters.push({ key: 'tier', label: '性价比 ' + data.tier })
    if (data.caliber) filters.push({ key: 'caliber', label: ({ 死亡率: '换寿命', 金钱: '换钱', 时间: '换时间', 自由: '换自由' })[data.caliber] || data.caliber })
    if (data.sec) filters.push({ key: 'sec', label: '第 ' + data.sec + ' 节' })
    COST_DIMS.forEach((dimension) => {
      const option = dimension.opts.find((entry) => entry[0] === data.cost[dimension.key])
      if (option) filters.push({ key: 'cost.' + dimension.key, label: option[1] })
    })
    this.setData({ activeFilters: filters })
  },
  removeFilter(event) {
    const key = event.currentTarget.dataset.key
    if (key.indexOf('cost.') === 0) {
      const cost = Object.assign({}, this.data.cost, { [key.slice(5)]: '' })
      this.setData({ cost })
    } else this.setData({ [key]: '' })
    this.setData({ tab: this.tabFor(this.data) })
    this.updateFilterLabels()
    if (this.data.q) this.run()
  },

  setTab(e) {
    const i = Number(e.currentTarget.dataset.i)
    const patch = { tab: i }
    if (i === 0) Object.assign(patch, { grade: '', tier: '' })
    if (i === 1) Object.assign(patch, { grade: 'A', tier: '' })
    if (i === 2) Object.assign(patch, { grade: '', tier: '极高' })
    this.setData(patch)
    this.updateFilterLabels()
    if (this.data.q) this.run()
  },

  pickCost(e) {
    const dim = e.currentTarget.dataset.dim
    const val = e.currentTarget.dataset.val
    const cur = Object.assign({}, this.data.draft.cost)
    cur[dim] = cur[dim] === val ? '' : val
    this.setData({ draft: Object.assign({}, this.data.draft, { cost: cur }) })
  },
  pickGrade(e) {
    const v = e.currentTarget.dataset.v
    this.setData({ draft: Object.assign({}, this.data.draft, { grade: this.data.draft.grade === v ? '' : v }) })
  },
  pickTier(e) {
    const v = e.currentTarget.dataset.v
    this.setData({ draft: Object.assign({}, this.data.draft, { tier: this.data.draft.tier === v ? '' : v }) })
  },
  pickCaliber(e) {
    const v = e.currentTarget.dataset.v
    this.setData({ draft: Object.assign({}, this.data.draft, { caliber: this.data.draft.caliber === v ? '' : v }) })
  },
  pickSec(e) {
    const v = String(e.currentTarget.dataset.v || '')
    this.setData({ draft: Object.assign({}, this.data.draft, { sec: this.data.draft.sec === v ? '' : v }) })
  },
  resetFilters() {
    this.setData({ draft: {
      cost: { money: '', time: '', will: '' },
      grade: '', tier: '', caliber: '', sec: '',
    } })
  },

  /* ---------------------------------------------------------------- 检索 */

  async run() {
    const q = (this.data.q || '').trim()
    if (!q) {
      wx.showToast({ title: '输入关键词', icon: 'none' })
      return
    }
    const request = (this.requestId || 0) + 1
    this.requestId = request
    wx.hideKeyboard()
    this.setData({
      searching: true,
      sealed: this.unshiftSealed(q),
      hasSearched: true,
    })

    const payload = {
      q,
      filters: {
        sec: this.data.sec ? Number(this.data.sec) : null,
        evidence: this.data.grade || null,
        tier: this.data.tier || null,
        caliber: this.data.caliber || null,
        cost: this.data.cost,
      },
    }

    try {
      const res = await cloud.call('searchServer', payload, { timeout: 20000 })
      if (request !== this.requestId) return
      if (!res || !res.ok) throw new Error('bad_result')
      this.applyHits(res.hits || [], res.total || 0, true, q)
    } catch (e) {
      if (request !== this.requestId) return
      const local = this.searchLocal(q)
      this.applyHits(local, local.length, false, q)
      wx.showToast({ title: '服务端检索不可用，已搜本机缓存', icon: 'none' })
    }
  },

  applyHits(hits, total, byServer, q) {
    const readable = reader.readableHits(hits, app.globalData.essentials)
    const decorated = readable.map((h) => Object.assign(advice.normalize(h), {
      sid: h.sid,
      // 'item' = 建议条目；'doc' = 专题长文
      kind: h.kind || 'item',
      docKind: h.docKind || '',
      sec: h.sec,
      num: h.num,
      titleParts: refs.highlight(h.title || '', q),
      snippetParts: refs.highlight(h.snippet || h.preview || '', q),
      evidenceLevel: h.e || h.evidenceLevel || 'C',
      ratio: h.r || h.ratio || '一般',
      tag: h.tag || h.tags || null,
      dispute: !!h.dispute,
    }))
    this.setData({
      searching: false,
      offline: !byServer,
      byServer,
      hits: decorated,
      total: Math.max(decorated.length, (Number(total) || 0) - (hits.length - readable.length)),
      shown: Math.min(PAGE_SIZE, decorated.length),
      visible: decorated.slice(0, PAGE_SIZE),
    })
    this.hydrateVisible()
  },

  hydrateVisible() {
    const request = this.requestId
    const generation = (this.hydrationId || 0) + 1
    this.hydrationId = generation
    const items = this.data.visible.filter((item) => item.kind !== 'doc')
    adviceContent.hydrate(items, (rows) => {
      if (request !== this.requestId || generation !== this.hydrationId) return
      const updates = {}
      rows.forEach((item) => { updates[item.sid] = item })
      const hits = this.data.hits.map((item) => updates[item.sid] ? Object.assign({}, item, updates[item.sid]) : item)
      this.setData({ hits, visible: hits.slice(0, this.data.shown) })
    })
  },

  unshiftSealed(q) {
    const arr = (this.data.sealed || []).filter((x) => x !== q)
    arr.unshift(q)
    const sealed = arr.slice(0, 6)
    this.setData({ sealed })
    try { wx.setStorageSync('htb.search-history', sealed) } catch (error) {}
    return sealed
  },
  useSealed(e) {
    this.setData({ q: e.currentTarget.dataset.q })
    this.run()
  },

  /**
   * 本地兜底：只扫已经下载到本机的分片，断网可用。
   * 命中范围有限，界面会明确提示「仅搜已缓存」。
   */
  searchLocal(q) {
    const needle = String(q).replace(/\s+/g, '').toLowerCase()
    const out = []
    const e = app.globalData.essentials || {}
    const ver = app.globalData.version
    for (const s of e.sections || []) {
      const rel = `book/${String(s.sec).padStart(2, '0')}.json`
      const shard = content.readLocal(rel, ver)
      if (!shard) continue
      for (const it of shard.items || []) {
        const f = it.fields || {}
        const blob = [it.title, f['说人话'], f['收益'], f['备注'], f['成本']]
          .join('\n')
          .replace(/<[^>]+>/g, '')
          .replace(/\s+/g, '')
          .toLowerCase()
        if (blob.indexOf(needle) >= 0) {
          const filters = this.data
          const tag = it.tag || {}
          if (filters.sec && Number(filters.sec) !== s.sec) continue
          if (filters.grade && filters.grade !== it.evidenceLevel) continue
          if (filters.tier && filters.tier !== it.ratio) continue
          if (filters.caliber && filters.caliber !== tag.caliber) continue
          if (COST_DIMS.some((dimension) => filters.cost[dimension.key] && filters.cost[dimension.key] !== tag[dimension.key])) continue
          out.push(Object.assign({}, it, {
            sec: s.sec,
            snippet: (f['说人话'] || '').replace(/<[^>]+>/g, ''),
          }))
        }
      }
    }
    const filters = this.data
    if (!filters.sec && !filters.grade && !filters.tier && !filters.caliber && !COST_DIMS.some((dimension) => filters.cost[dimension.key])) {
      for (const entry of reader.readableDocs(e)) {
        const doc = content.readLocal(`docs/${entry.sid}.json`, ver)
        if (!doc) continue
        const plain = String(doc.body || '').replace(/<[^>]+>/g, '')
        const blob = (doc.title + plain).replace(/\s+/g, '').toLowerCase()
        if (blob.indexOf(needle) >= 0) out.push({ sid: entry.sid, kind: 'doc', docKind: 'doc', title: doc.title, snippet: plain.slice(0, 160) })
      }
    }
    return out
  },

  onResult(e) {
    const { sid, kind, dockind } = e.currentTarget.dataset
    if (kind === 'doc') {
      refs.goDoc(sid, dockind)
      return
    }
    refs.goItem(sid)
  },
  onAdviceOpen(event) {
    const item = event.detail.item
    wx.navigateTo({ url: `/pages/item-detail/index?sid=${item.sid}${item.num ? `&num=${item.num}` : ''}` })
  },
  onAdviceRetry() { this.hydrateVisible() },

  /** 已返回结果增量渲染，避免一次塞几百个节点 */
  loadMore() {
    const next = Math.min(this.data.shown + PAGE_SIZE, this.data.hits.length)
    if (next === this.data.shown) return
    this.setData({ shown: next, visible: this.data.hits.slice(0, next) })
    this.hydrateVisible()
  },
  onReachBottom() {
    this.loadMore()
  },
})
