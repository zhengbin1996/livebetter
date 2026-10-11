const config = require('../config')
const MENUS = ['shareAppMessage', 'shareTimeline']

function payload(title, path, params) {
  const query = Object.keys(params || {}).map((key) => encodeURIComponent(key) + '=' + encodeURIComponent(params[key])).join('&')
  return { title, path: path + (query ? '?' + query : ''), imageUrl: '/assets/share-cover.png' }
}

function home() {
  return payload('《' + config.BOOK_NAME + '》', '/pages/index/index')
}

function directory(tab) {
  return payload('《' + config.BOOK_NAME + '》· 全书目录', '/pages/section-list/index', tab === 'docs' ? { tab: 'docs' } : {})
}

function item(entry) {
  if (!entry || !/^s\d{2}-[a-z\d]+$/i.test(entry.sid || '') || !entry.title || entry.title === '正文未下载') return home()
  const params = { sid: entry.sid }
  if (Number.isInteger(entry.num) && entry.num > 0) params.num = entry.num
  return payload(entry.title, '/pages/item-detail/index', params)
}

function section(sec, title) {
  if (!Number.isInteger(sec) || sec < 1 || !title) return home()
  return payload('第 ' + sec + ' 节 · ' + title, '/subpackages/read/pages/section-detail/index', { sec })
}

function doc(entry) {
  if (!entry || !/^d-[a-z\d-]+$/i.test(entry.sid || '') || !entry.title) return home()
  return payload(entry.title, '/subpackages/read/pages/doc-read/index', { sid: entry.sid })
}

function timeline(share) {
  return { title: share.title, query: share.path.split('?')[1] || '', imageUrl: share.imageUrl }
}

function enable(available) {
  if (singlePage()) return
  const method = available ? wx.showShareMenu : wx.hideShareMenu
  if (typeof method === 'function') method.call(wx, { menus: MENUS, withShareTicket: false })
}

function singlePage() {
  return typeof wx.getLaunchOptionsSync === 'function' && wx.getLaunchOptionsSync().scene === 1154
}

function requireFullApp() {
  if (!singlePage()) return false
  wx.showToast({ title: '请点击下方“前往小程序”继续', icon: 'none' })
  return true
}

module.exports = { home, directory, item, section, doc, timeline, enable, singlePage, requireFullApp }
