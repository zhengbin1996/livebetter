const app = getApp()
const cfg = require('../../config')
const content = require('../../utils/content')
const fmt = require('../../utils/fmt')
const store = require('../../utils/store')

/**
 * 「今天」页 = 行动起点。
 *
 * 旧版首页是一份导航目录（书封 + 34 个问题平铺 + 目录 + 材料 + 离线 + 版本），
 * 打开它并不回答用户最关心的那句话：「我今天该做哪一条？」
 * 现在首屏第一屏就是这条建议本身（今天做一条），并且**离线也能推**——
 * 候选池 picks 随主包内置，不必为了显示一条去下一个分片。
 */

/** 同一天进来看到同一条；隔天自动换。用本地日期算种子，避免 UTC 午夜换条。 */
function daySeed() {
  const d = new Date()
  return d.getFullYear() * 372 + (d.getMonth() + 1) * 31 + d.getDate()
}

Page({
  data: {
    bookName: cfg.BOOK_NAME,
    tagline: '用最少的钱、时间和精力，换回寿命、金钱和人身自由',
    info: null,
    statsClaim: null,
    statLine: '',
    // 找问题：按处境分五组（来自 essentials.problemGroups）
    groups: [],
    longDocs: [],
    verify: [],
    glossaryCount: 0,
    cache: null,
    cacheText: '',
    offline: null,
    downloading: false,
    progress: null,
    disclaimer: cfg.DISCLAIMER,
    q: '',
    labelMap: null,
    // 今天做一条
    pick: null,
    pickState: 'none', // none | todo | done
    pickTotal: 0,
  },

  /** 分组的展开状态放页面实例上，不要进 data —— 否则 onShow 重建时会被重置 */
  openMap: {},
  pickIdx: -1,

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
    const cache = content.localStats()
    const cloudSyncing = app.globalData.cloudReady && !app.globalData.manifest

    this.setData({
      info: app.versionInfo(),
      statsClaim: stats.claim || null,
      counts,
      statLine: `${counts.items} 条 · ${counts.sections} 节 · 证据 A 级 ${ev.A || 0} 条 · 性价比极高 ${tier['极高'] || 0} 条`,
      groups: this.buildGroups(e),
      longDocs: docs.filter((d) => d.kind === 'doc'),
      verify: e.verify || [],
      glossaryCount: (e.glossary || []).length,
      cache,
      cacheText: cache.complete
        ? '已完整存到本机，断网也能读'
        : cloudSyncing
          ? '云端内容同步中，同步完成后可下载'
          : `已存 ${cache.files} / ${cache.total} 节 · ${fmt.fmtBytes(cache.bytes)}`,
      offline: this.offlineStrip(cache, cloudSyncing),
      labelMap: legend.tagLabels || null,
    })
    this.buildPick(0)
  },

  /** 首屏的离线状态条：三态（未存 / 下载中 / 已存） */
  offlineStrip(cache, cloudSyncing) {
    if (cache.complete) {
      return { tone: 'g', text: `已存本机 ${fmt.fmtBytes(cache.bytes)} · 断网可读`, action: '管理' }
    }
    if (cloudSyncing) {
      return { tone: 'off', text: '云端内容同步中，稍后可下载全书', action: '' }
    }
    if (cache.files > 0) {
      return {
        tone: 'a',
        text: `已存 ${cache.files} / ${cache.total} 节 · ${fmt.fmtBytes(cache.bytes)}`,
        action: '续传',
      }
    }
    return { tone: 'off', text: '未下载 · 断网时读不了', action: '下载全书' }
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

  /* ---------------------------------------------------------------- 今天做一条 */

  buildPick(step) {
    const picks = ((app.globalData.essentials || {}).picks) || []
    const len = picks.length
    if (!len) {
      this.setData({ pick: null, pickState: 'none', pickTotal: 0 })
      return
    }
    const check = store.getCheckins()
    const isDone = (sid) => !!(check[sid] && check[sid].done)

    let idx = this.pickIdx
    if (idx < 0) idx = daySeed() % len
    if (step) idx = (idx + step + len * 10) % len
    // 落点若已经做完，往后找第一个还没做的（最多绕一圈，全是已完成就停在原地）
    let guard = 0
    while (guard < len && isDone(picks[idx].sid)) {
      idx = (idx + 1) % len
      guard += 1
    }
    this.pickIdx = idx

    const p = picks[idx]
    const rec = check[p.sid]
    this.setData({
      pick: p,
      pickTotal: len,
      pickState: rec ? (rec.done ? 'done' : 'todo') : 'none',
    })
  },

  onPickShuffle() {
    this.buildPick(1)
  },

  onPickOpen() {
    const p = this.data.pick
    if (!p) return
    wx.navigateTo({ url: `/pages/item-detail/index?sid=${p.sid}` })
  },

  /** 首屏就能行动：列表层直接加进清单，不必先进详情页 */
  onPickToggle() {
    const p = this.data.pick
    if (!p) return
    if (this.data.pickState === 'none') {
      store.addToList(p.sid, 'today')
      wx.showToast({ title: '已加进清单 · 今天', icon: 'none' })
    } else {
      store.removeCheckin(p.sid)
      wx.showToast({ title: '已移出清单', icon: 'none' })
    }
    this.buildPick(0)
  },

  /* ---------------------------------------------------------------- 检索 */

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

  /* ---------------------------------------------------------------- 导航 */

  onProblem(e) {
    const sec = e.currentTarget.dataset.sec
    if (!sec) return
    wx.navigateTo({ url: `/subpackages/read/pages/section-detail/index?sec=${sec}` })
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

  /* ---------------------------------------------------------------- 离线 */

  onOfflineTap() {
    if (this.data.cache && this.data.cache.complete) {
      wx.showToast({ title: '全书已在手机里，断网也能读', icon: 'none' })
      return
    }
    this.onDownload()
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
      // 必须留痕：这个 catch 包着 183 次网络请求，不打印就完全没法定位
      console.error('[download] 下载全书失败：', err)
      const tips = {
        NO_MANIFEST: '云端内容还没同步好，稍后再试',
        SYNCING: '云端内容同步中，稍后再试',
      }
      wx.showToast({
        title: (err && tips[err.code]) || '下载中断，可再点一次续传',
        icon: 'none',
      })
    } finally {
      this.setData({ downloading: false, progress: null })
    }
  },

  onClearCache() {
    wx.showModal({
      title: '清空本机内容缓存',
      content: '收藏和清单不受影响。清空后再次阅读需要重新下载对应章节。',
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
