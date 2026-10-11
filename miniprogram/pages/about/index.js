const app = getApp()
const cfg = require('../../config')
const readingHelp = require('../../utils/reading-help')

Page({
  data: {
    bookName: cfg.BOOK_NAME,
    repo: cfg.REPO_URL,
    licenseName: cfg.LICENSE_NAME,
    licenseUrl: cfg.LICENSE_URL,
    attribution: '',
    disclaimer: cfg.DISCLAIMER,
    readingHelp,
  },

  async onLoad() {
    await app.ready
    this.apply()
  },

  onShow() {
    if (this.getTabBar) {
      const tabBar = this.getTabBar()
      if (tabBar) tabBar.setTab(4)
    }
    this.apply()
  },

  apply() {
    const essentials = app.globalData.essentials || {}
    const metadata = essentials.meta || {}
    const license = essentials.license || {}
    this.setData({
      bookName: metadata.book || cfg.BOOK_NAME,
      repo: metadata.repo || license.repo || cfg.REPO_URL,
      licenseName: metadata.license || license.name || cfg.LICENSE_NAME,
      licenseUrl: metadata.licenseUrl || license.url || cfg.LICENSE_URL,
      attribution: license.attribution || `《${metadata.book || cfg.BOOK_NAME}》，原作者`,
    })
  },

  copyRepo() {
    wx.setClipboardData({
      data: this.data.repo,
      success() { wx.showToast({ title: '原作链接已复制', icon: 'none' }) },
    })
  },
  copyLicense() {
    wx.setClipboardData({
      data: this.data.licenseUrl,
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
})
