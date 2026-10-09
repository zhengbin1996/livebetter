const app = getApp()
const content = require('../../../../utils/content')
const fmt = require('../../../../utils/fmt')
const store = require('../../../../utils/store')

Page({
  data: {
    info: null,
    counts: {},
    stats: null,
    history: [],
    cache: null,
    cacheText: '',
    busy: false,
    downBusy: false,
    progress: null,
  },

  async onLoad() {
    await app.ready
    this.apply()
  },

  apply() {
    const g = app.globalData
    const e = g.essentials || {}
    const cache = content.localStats()
    const info = app.versionInfo()
    this.setData({
      info,
      counts: (g.manifest && g.manifest.counts) || e.counts || {},
      stats: e.stats || null,
      history: (store.readSync().history || []).map((h) =>
        Object.assign({}, h, { atText: fmt.fmtDateTime(h.at) })
      ),
      cache,
      cacheText: `${cache.files} / ${cache.total} 节 · ${fmt.fmtBytes(cache.bytes)} / ${fmt.fmtBytes(cache.totalBytes)}`,
      upText: info.upstreamDate ? fmt.fmtDateTime(info.upstreamDate) : '—',
      genText: (g.manifest && g.manifest.generatedAt) ? fmt.fmtDateTime(g.manifest.generatedAt) : '—',
      syncText: info.syncedAt ? fmt.fmtDateTime(info.syncedAt) : '尚未同步',
    })
  },

  async onSync() {
    if (this.data.busy) return
    this.setData({ busy: true })
    const r = await app.refresh()
    this.setData({ busy: false })
    this.apply()
    if (r.ok) {
      const m = app.globalData.manifest
      if (m && m.prevIdMap) store.migrate(m.prevIdMap)
      wx.showToast({ title: `已是 ${r.version}`, icon: 'none' })
    } else {
      wx.showToast({ title: r.reason || '同步失败', icon: 'none' })
    }
  },

  async onDownload() {
    if (this.data.downBusy) return
    this.setData({ downBusy: true, progress: { percent: 0, text: '准备中', size: '' } })
    try {
      await content.downloadAll((p) => {
        this.setData({
          progress: {
            percent: p.percent,
            text: `${p.done} / ${p.total} 节`,
            size: `${fmt.fmtBytes(p.bytes)} / ${fmt.fmtBytes(p.totalBytes)}`,
          },
        })
      })
      wx.showToast({ title: '已存到本机', icon: 'success' })
    } catch (e) {
      console.error('[download] 下载全书失败：', e)
      const tips = {
        NO_MANIFEST: '云端内容还没同步好，稍后再试',
        SYNCING: '云端内容同步中，稍后再试',
      }
      wx.showToast({
        title: (e && tips[e.code]) || '下载中断，可续传',
        icon: 'none',
      })
    } finally {
      this.setData({ downBusy: false, progress: null })
      this.apply()
    }
  },

  onPrune() {
    const n = content.pruneOld()
    this.apply()
    wx.showToast({ title: n ? `清掉 ${n} 个旧版本` : '没有旧版本', icon: 'none' })
  },

  onClear() {
    wx.showModal({
      title: '清空本机内容缓存',
      content: '收藏与打卡不受影响。',
      success: (r) => {
        if (!r.confirm) return
        content.clearAll()
        this.apply()
        wx.showToast({ title: '已清空', icon: 'none' })
      },
    })
  },

  copyCommit() {
    wx.setClipboardData({
      data: (this.data.info && this.data.info.commit) || '',
      success() { wx.showToast({ title: 'commit 已复制', icon: 'none' }) },
    })
  },
})
