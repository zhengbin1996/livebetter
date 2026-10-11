const app = getApp()
const content = require('../../../../utils/content')
const fmt = require('../../../../utils/fmt')
const store = require('../../../../utils/store')

const CHECKED_AT_KEY = 'htb.content-checked-at'

Page({
  data: {
    contentDate: '未知日期',
    checkedText: '尚未检查',
    cache: null,
    cacheText: '',
    busy: false,
    downBusy: false,
    progress: null,
    cacheManagementOpen: false,
  },

  async onLoad() {
    await app.ready
    this.apply()
  },

  apply() {
    const cache = content.localStats()
    const info = app.versionInfo()
    let checkedAt = this.checkedAt || ''
    if (!checkedAt) {
      try { checkedAt = wx.getStorageSync(CHECKED_AT_KEY) || '' } catch (error) {}
    }
    this.setData({
      cache,
      cacheText: `${cache.files} / ${cache.total} 份 · ${fmt.fmtBytes(cache.bytes)} / ${fmt.fmtBytes(cache.totalBytes)}`,
      contentDate: fmt.fmtDate(info.upstreamDate) || '未知日期',
      checkedText: fmt.fmtDateTime(checkedAt) || '尚未检查',
    })
  },

  async onSync() {
    if (this.data.busy || this.data.downBusy) return
    this.setData({ busy: true })
    try {
      const result = await app.refresh()
      if (result && result.ok) {
        this.checkedAt = new Date().toISOString()
        try { wx.setStorageSync(CHECKED_AT_KEY, this.checkedAt) } catch (error) {}
        const manifest = app.globalData.manifest
        if (manifest && manifest.prevIdMap) {
          try { store.migrate(manifest.prevIdMap) } catch (error) {}
        }
        wx.showToast({ title: '内容已更新到最新', icon: 'none' })
      } else {
        wx.showToast({ title: '暂时无法检查更新，请联网后重试', icon: 'none' })
      }
    } catch (error) {
      wx.showToast({ title: '暂时无法检查更新，请联网后重试', icon: 'none' })
    } finally {
      this.setData({ busy: false })
      this.apply()
    }
  },

  async onDownload() {
    if (this.data.downBusy || this.data.busy) return
    this.setData({ downBusy: true, progress: { percent: 0, text: '准备中', size: '' } })
    try {
      await content.downloadAll((progress) => {
        this.setData({
          progress: {
            percent: progress.percent,
            text: `${progress.done} / ${progress.total} 份`,
            size: `${fmt.fmtBytes(progress.bytes)} / ${fmt.fmtBytes(progress.totalBytes)}`,
          },
        })
      })
      wx.showToast({ title: '全书已存到本机', icon: 'success' })
    } catch (error) {
      const tips = {
        NO_MANIFEST: '内容尚未准备好，请先检查更新',
        SYNCING: '内容正在更新，请稍后下载',
      }
      wx.showToast({ title: (error && tips[error.code]) || '下载中断，可联网后继续', icon: 'none' })
    } finally {
      this.setData({ downBusy: false, progress: null })
      this.apply()
    }
  },

  toggleCacheManagement() {
    this.setData({ cacheManagementOpen: !this.data.cacheManagementOpen })
  },

  onPrune() {
    if (this.data.downBusy || this.data.busy) return
    const removed = content.pruneOld()
    this.apply()
    wx.showToast({ title: removed ? `已清理 ${removed} 个旧版本` : '没有旧版本缓存', icon: 'none' })
  },

  onClear() {
    if (this.data.downBusy || this.data.busy) return
    wx.showModal({
      title: '清空本机内容缓存',
      content: '收藏不受影响。清空后，离线阅读需要重新下载正文。',
      success: (result) => {
        if (!result.confirm || this.data.downBusy || this.data.busy) return
        content.clearAll()
        this.apply()
        wx.showToast({ title: '已清空正文缓存', icon: 'none' })
      },
    })
  },
})
