const product = require('../../data/reading-pack')
const samplePDF = require('../../data/reading-pack-sample')

Page({
  data: {
    contentDate: product.contentDate,
    sections: product.sections,
    items: product.items,
    docs: product.docs,
    themeNames: product.themeNames,
    sampleBusy: false,
  },

  downloadSample() {
    if (this.data.sampleBusy) return
    this.setData({ sampleBusy: true })
    let stage = '保存'
    try {
      const fileSystem = wx.getFileSystemManager()
      const filePath = `${wx.env.USER_DATA_PATH}/高性价比人生指南-免费样张.pdf`
      fileSystem.writeFileSync(filePath, samplePDF, 'base64')
      stage = '打开'
      wx.openDocument({
        filePath,
        fileType: 'pdf',
        showMenu: true,
        fail: (error) => {
          console.error('[reading-pack] 打开样张失败', error)
          wx.showToast({ title: '无法打开 PDF，请重试', icon: 'none' })
        },
        complete: () => this.setData({ sampleBusy: false }),
      })
    } catch (error) {
      console.error(`[reading-pack] ${stage}样张失败`, error)
      this.setData({ sampleBusy: false })
      wx.showToast({ title: stage === '保存' ? 'PDF 保存失败，请重试' : '无法打开 PDF，请重试', icon: 'none' })
    }
  },

  onUnavailablePurchase() {
    wx.showToast({ title: '阅读包购买尚未开放', icon: 'none' })
  },
})
