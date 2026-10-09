const app = getApp()
const cfg = require('../../config')
const content = require('../../utils/content')
const fmt = require('../../utils/fmt')
const store = require('../../utils/store')

const PROBLEM_PREVIEW = 6

Page({
  data: {
    bookName: cfg.BOOK_NAME,
    tagline: '用最少的钱、时间和精力，换回寿命、金钱和人身自由',
    info: null,
    statsClaim: null,
    statLine: '',
    problems: [],
    visibleProblems: [],
    problemsAll: false,
    longDocs: [],
    verify: [],
    glossaryCount: 0,
    cache: null,
    cacheText: '',
    downloading: false,
    progress: null,
    disclaimer: cfg.DISCLAIMER,
    q: '',
  },

  async onLoad() {
    await app.ready
    this.apply()
    // 上游改标题会让条目 id 变；拿到新 manifest 后把收藏/打卡迁到新 id
    const m = app.globalData.manifest
    if (m && m.prevIdMap) {
      const n = store.migrate(m.prevIdMap)
      if (n) wx.showToast({ title: `已迁移 ${n} 项收藏 / 打卡`, icon: 'none' })
    }
  },

  onShow() {
    if (this.getTabBar) {
      const tb = this.getTabBar()
      if (tb) tb.setTab(0)
    }
    if (app.globalData.essentials) this.apply()
  },

  apply() {
    const e = app.globalData.essentials || {}
    const legend = e.legend || {}
    const stats = e.stats || {}
    const ev = stats.evidence || {}
    const tier = stats.tier || {}
    const counts = e.counts || {}
    const docs = e.docs || []
    const problems = e.problems || []
    const cache = content.localStats()

    this.setData({
      info: app.versionInfo(),
      statsClaim: stats.claim || null,
      counts,
      statLine: `${counts.items} 条 · ${counts.sections} 节 · 证据 A 级 ${ev.A || 0} 条 · 性价比极高 ${tier['极高'] || 0} 条`,
      problems,
      visibleProblems: this.data.problemsAll
        ? problems
        : problems.slice(0, PROBLEM_PREVIEW),
      longDocs: docs.filter((d) => d.kind === 'doc'),
      verify: e.verify || [],
      glossaryCount: (e.glossary || []).length,
      cache,
      cacheText: cache.complete
        ? '已完整存到本机，断网也能读'
        : `已存 ${cache.files} / ${cache.total} 节 · ${fmt.fmtBytes(cache.bytes)}`,
      labelMap: legend.tagLabels || null,
    })
  },

  toggleProblems() {
    const all = !this.data.problemsAll
    this.setData({
      problemsAll: all,
      visibleProblems: all
        ? this.data.problems
        : this.data.problems.slice(0, PROBLEM_PREVIEW),
    })
  },

  onProblem(e) {
    const sec = e.currentTarget.dataset.sec
    if (!sec) return
    wx.navigateTo({ url: `/subpackages/read/pages/section-detail/index?sec=${sec}` })
  },

  onSearchTap() {
    wx.switchTab({ url: '/pages/search/index' })
  },

  onSearchInput(e) {
    this.setData({ q: e.detail.value })
  },

  onSearchConfirm() {
    const q = (this.data.q || '').trim()
    if (!q) {
      wx.switchTab({ url: '/pages/search/index' })
      return
    }
    // tab 页之间不能带参数，把待查词放进 globalData 由检索页取走
    app.globalData.pendingQuery = q
    wx.switchTab({ url: '/pages/search/index' })
  },

  goSections() {
    wx.navigateTo({ url: '/pages/section-list/index' })
  },

  goDoc(e) {
    const sid = e.currentTarget.dataset.sid
    wx.navigateTo({ url: `/subpackages/read/pages/doc-read/index?sid=${sid}` })
  },

  goVerifyList() {
    wx.navigateTo({ url: '/subpackages/read/pages/verify-read/index' })
  },

  goRefsMap() {
    // 引用对照本身就是一篇带表格的长文，直接交给长文阅读器
    const d = content.refsMapEntry()
    if (!d) {
      wx.showToast({ title: '引用对照未随索引提供', icon: 'none' })
      return
    }
    wx.navigateTo({ url: `/subpackages/read/pages/doc-read/index?sid=${d.sid}` })
  },

  goGlossary() {
    wx.navigateTo({ url: '/subpackages/mine/pages/glossary/index' })
  },

  goVersion() {
    wx.navigateTo({ url: '/subpackages/mine/pages/version/index' })
  },

  async onDownload() {
    if (this.data.downloading) return
    if (!app.globalData.cloudReady) {
      wx.showToast({ title: '未连上云开发，无法下载', icon: 'none' })
      return
    }
    this.setData({
      downloading: true,
      progress: { percent: 0, done: 0, total: 0, text: '准备中', size: '' },
    })
    try {
      await content.downloadAll((p) => {
        this.setData({
          progress: Object.assign({}, p, {
            text: `${p.done} / ${p.total} 节`,
            size: `${fmt.fmtBytes(p.bytes)} / ${fmt.fmtBytes(p.totalBytes)}`,
          }),
        })
      })
      this.setData({ cache: content.localStats() })
      this.apply()
      wx.showToast({ title: '全书已存到本机', icon: 'success' })
    } catch (err) {
      wx.showToast({ title: '下载中断，可再点一次续传', icon: 'none' })
    } finally {
      this.setData({ downloading: false, progress: null })
    }
  },

  onClearCache() {
    wx.showModal({
      title: '清空本机内容缓存',
      content: '收藏和打卡清单不受影响。清空后再次阅读需要重新下载对应章节。',
      success: (r) => {
        if (!r.confirm) return
        content.clearAll()
        this.apply()
        wx.showToast({ title: '已清空', icon: 'none' })
      },
    })
  },

  noop() {},
})
