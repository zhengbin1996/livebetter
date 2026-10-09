const app = getApp()
const cloud = require('../../utils/cloud')
const content = require('../../utils/content')
const refs = require('../../utils/refs')

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
    })
  },

  onShow() {
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

  onInput(e) {
    this.setData({ q: e.detail.value })
  },
  onConfirm() {
    this.run()
  },
  clearQ() {
    this.setData({
      q: '', hits: [], visible: [], total: 0, shown: 0,
      byServer: false, offline: false, hasSearched: false,
    })
  },

  toggleFilters() {
    this.setData({ filtersOpen: !this.data.filtersOpen })
  },

  setTab(e) {
    const i = Number(e.currentTarget.dataset.i)
    const patch = { tab: i }
    if (i === 0) Object.assign(patch, { grade: '', tier: '' })
    if (i === 1) Object.assign(patch, { grade: 'A', tier: '' })
    if (i === 2) Object.assign(patch, { grade: '', tier: '极高' })
    this.setData(patch)
    if (this.data.q) this.run()
  },

  pickCost(e) {
    const dim = e.currentTarget.dataset.dim
    const val = e.currentTarget.dataset.val
    const cur = Object.assign({}, this.data.cost)
    cur[dim] = cur[dim] === val ? '' : val
    this.setData({ cost: cur })
    if (this.data.q) this.run()
  },
  pickGrade(e) {
    const v = e.currentTarget.dataset.v
    this.setData({ grade: this.data.grade === v ? '' : v, tab: -1 })
    if (this.data.q) this.run()
  },
  pickTier(e) {
    const v = e.currentTarget.dataset.v
    this.setData({ tier: this.data.tier === v ? '' : v, tab: -1 })
    if (this.data.q) this.run()
  },
  pickCaliber(e) {
    const v = e.currentTarget.dataset.v
    this.setData({ caliber: this.data.caliber === v ? '' : v })
    if (this.data.q) this.run()
  },
  pickSec(e) {
    const v = String(e.currentTarget.dataset.v || '')
    this.setData({ sec: this.data.sec === v ? '' : v })
    if (this.data.q) this.run()
  },
  resetFilters() {
    this.setData({
      cost: { money: '', time: '', will: '' },
      grade: '', tier: '', caliber: '', sec: '', tab: 0,
    })
    if (this.data.q) this.run()
  },

  /* ---------------------------------------------------------------- 检索 */

  async run() {
    const q = (this.data.q || '').trim()
    if (!q) {
      wx.showToast({ title: '输入关键词', icon: 'none' })
      return
    }
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
      if (!res || !res.ok) throw new Error('bad_result')
      this.applyHits(res.hits || [], res.total || 0, true, q)
    } catch (e) {
      const local = this.searchLocal(q)
      this.applyHits(local, local.length, false, q)
      wx.showToast({ title: '服务端检索不可用，已搜本机缓存', icon: 'none' })
    }
  },

  applyHits(hits, total, byServer, q) {
    const decorated = hits.map((h) => ({
      sid: h.sid,
      // 'item' = 建议条目；'doc' = 长文 / 核实记录（没有节号、成本这些维度）
      kind: h.kind || 'item',
      docKind: h.docKind || '',
      sec: h.sec,
      num: h.num,
      titleParts: refs.highlight(h.title || '', q),
      snippetParts: refs.highlight(h.snippet || h.preview || '', q, 90),
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
      total,
      shown: Math.min(PAGE_SIZE, decorated.length),
      visible: decorated.slice(0, PAGE_SIZE),
    })
  },

  unshiftSealed(q) {
    const arr = (this.data.sealed || []).filter((x) => x !== q)
    arr.unshift(q)
    return arr.slice(0, 6)
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
          out.push(Object.assign({}, it, {
            sec: s.sec,
            snippet: (f['说人话'] || '').replace(/<[^>]+>/g, ''),
          }))
        }
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

  /** 服务端一次返回全量命中，这里只做增量渲染，避免一次塞几百个节点 */
  loadMore() {
    const next = Math.min(this.data.shown + PAGE_SIZE, this.data.hits.length)
    if (next === this.data.shown) return
    this.setData({ shown: next, visible: this.data.hits.slice(0, next) })
  },
  onReachBottom() {
    this.loadMore()
  },
})
