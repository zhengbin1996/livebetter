const app = getApp()
const store = require('../../utils/store')
const adviceContent = require('../../utils/advice-content')
const favorites = require('../../utils/favorites')

Page({
  data: { items: [], count: 0 },
  async onLoad() { await app.ready; this.build() },
  onShow() {
    favorites.show(this, this.build)
    if (this.getTabBar) {
      const tabBar = this.getTabBar()
      if (tabBar) tabBar.setTab(2)
    }
  },
  onHide() { favorites.hide(this); this.buildRequest = (this.buildRequest || 0) + 1 },
  onUnload() { this.onHide() },
  build() {
    const sids = Object.keys(store.getFavorites())
    const items = adviceContent.initial(sids).sort((left, right) => left.sec - right.sec || left.num - right.num)
    const request = (this.buildRequest || 0) + 1
    this.buildRequest = request
    this.setData({ items, count: items.length })
    adviceContent.hydrate(items, (rows) => {
      if (this.favoritesActive && this.buildRequest === request) this.setData({ items: rows })
    })
  },
  goItem(event) {
    const item = event.detail.item
    wx.navigateTo({ url: `/pages/item-detail/index?sid=${item.sid}${item.num ? `&num=${item.num}` : ''}` })
  },
  onRetry() { this.build() },
  goSearch() { wx.switchTab({ url: '/pages/search/index' }) },
})
