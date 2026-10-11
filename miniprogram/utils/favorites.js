const store = require('./store')
const advice = require('./advice')
const share = require('./share')
const listeners = []

function subscribe(listener) {
  listeners.push(listener)
  return () => {
    const index = listeners.indexOf(listener)
    if (index >= 0) listeners.splice(index, 1)
  }
}

function refresh() { listeners.slice().forEach((listener) => listener()) }

function toggle(item) {
  if (share.requireFullApp()) return null
  if (!item || !item.sid) return null
  advice.remember(item)
  try {
    const saved = store.toggleFavorite(item.sid)
    refresh()
    wx.showToast({ title: saved ? '已收藏' : '已取消收藏', icon: 'none' })
    return saved
  } catch (error) {
    wx.showToast({ title: '未保存成功，请重试', icon: 'none' })
    return null
  }
}

function show(page, listener) {
  hide(page)
  if (share.singlePage()) return
  page.favoritesActive = true
  page.favoritesSubscription = subscribe(() => {
    if (page.favoritesActive && listener) listener.call(page)
  })
  refresh()
  store.pull().then(() => { if (page.favoritesActive) refresh() })
}

function hide(page) {
  page.favoritesActive = false
  if (page.favoritesSubscription) page.favoritesSubscription()
  page.favoritesSubscription = null
}

module.exports = { subscribe, refresh, toggle, show, hide }
