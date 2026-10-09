const app = getApp()
const cfg = require('../../config')
const content = require('../../utils/content')
const fmt = require('../../utils/fmt')

Page({
  data: {
    appName: cfg.APP_NAME,
    bookName: cfg.BOOK_NAME,
    repo: cfg.REPO_URL,
    licenseName: cfg.LICENSE_NAME,
    licenseUrl: cfg.LICENSE_URL,
    disclaimer: cfg.DISCLAIMER,
    info: null,
    counts: {},
    license: null,
    cache: null,
    cacheText: '',
    busy: false,
  },

  async onLoad() {
    await app.ready
    this.apply()
  },

  onShow() {
    if (this.getTabBar) {
      const tb = this.getTabBar()
      if (tb) tb.setTab(3)
    }
    this.apply()
  },

  apply() {
    const e = app.globalData.essentials || {}
    const cache = content.localStats()
    this.setData({
      info: app.versionInfo(),
      counts: e.counts || {},
      license: e.license || null,
      cache,
      cacheText: `${cache.files} / ${cache.total} 节 · ${fmt.fmtBytes(cache.bytes)}`,
    })
  },

  copyRepo() {
    wx.setClipboardData({
      data: cfg.REPO_URL,
      success() { wx.showToast({ title: '仓库链接已复制', icon: 'none' }) },
    })
  },
  copyLicense() {
    wx.setClipboardData({
      data: cfg.LICENSE_URL,
      success() { wx.showToast({ title: '许可证链接已复制', icon: 'none' }) },
    })
  },

  goVersion() {
    wx.navigateTo({ url: '/subpackages/mine/pages/version/index' })
  },
  goGlossary() {
    wx.navigateTo({ url: '/subpackages/mine/pages/glossary/index' })
  },
  goLegend() {
    wx.navigateTo({ url: '/subpackages/mine/pages/glossary/index?legend=1' })
  },
  goVerify() {
    wx.navigateTo({ url: '/subpackages/read/pages/verify-read/index' })
  },

  async onSync() {
    if (this.data.busy) return
    this.setData({ busy: true })
    const r = await app.refresh()
    this.setData({ busy: false })
    this.apply()
    wx.showToast({ title: r.ok ? '已是最新' : (r.reason || '同步失败'), icon: 'none' })
  },
})
