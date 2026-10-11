const assert = require('assert')
const memory = {}
global.wx = {
  getStorageSync: (key) => memory[key] || '',
  setStorageSync: (key, value) => { memory[key] = value },
  getFileSystemManager: () => ({ readFileSync() { throw new Error('not cached') } }),
  env: { USER_DATA_PATH: '/test' },
  showToast() {}, setNavigationBarTitle() {}, pageScrollTo() {},
}
const app = { ready: Promise.resolve(), globalData: { version: 'test', essentials: { sidIndex: { 's01-missing': [1, 7] } } } }
global.getApp = () => app
let definition
global.Page = (page) => { definition = page }
const content = require('../../miniprogram/utils/content')
let loads = 0
content.loadSection = async () => { throw new Error('offline') }
const originalHtml = '<p>适用于<a href="gloss:成年人">成年人</a>，风险下降 <b>12%</b>，但儿童不能用。<a href="https://example.com/source">来源</a></p>'
content.resolveItem = async () => {
  loads++
  return { shard: { sec: 1, secTitle: '原节标题' }, item: { sid: 's01-a', title: '原题', num: 1, fields: { '说人话': originalHtml } } }
}
function instance() {
  const page = Object.assign({}, definition, { data: JSON.parse(JSON.stringify(definition.data)) })
  page.setData = (patch, callback) => { Object.assign(page.data, patch); if (callback) callback() }
  return page
}
async function run() {
  require('../../miniprogram/pages/item-detail/index')
  const detail = instance()
  await detail.onLoad({ sid: 's01-a' })
  assert.strictEqual(detail.data.originalOpen, false)
  assert(detail.data.plainHtml.includes('儿童不能用'))
  assert.strictEqual(detail.data.plainHtml, originalHtml)
  detail.toggleOriginal()
  assert.strictEqual(detail.data.originalOpen, true)
  detail.toggleOriginal()
  assert.strictEqual(loads, 1, '反复展开原文不得重新请求')
  content.resolveItem = async () => { throw new Error('offline') }
  const cached = instance()
  await cached.onLoad({ sid: 's01-a' })
  assert.strictEqual(cached.data.item.title, '原题')
  assert(cached.data.plainHtml.includes('儿童不能用'))
  assert.strictEqual(cached.data.plainHtml, originalHtml, '缓存摘要保留原有数字、链接与术语')
  assert.strictEqual(cached.data.offline, true)
  assert.strictEqual(cached.data.shareable, true, '离线已缓存的标题仍可分享')
  const unavailable = instance()
  await unavailable.onLoad({ sid: 's01-missing' })
  assert.strictEqual(unavailable.data.item.num, 7)
  assert.strictEqual(unavailable.data.item.unavailable, true)
  assert.strictEqual(unavailable.data.shareable, false, '无标题的占位内容不提供分享')
  require('../../miniprogram/pages/favorites/index')
  const list = instance()
  memory['htb.fav'] = { 's01-missing': { at: new Date().toISOString() } }
  list.favoritesActive = true
  list.build()
  assert.strictEqual(list.data.items.length, 1)
  assert.strictEqual(list.data.items[0].num, 7)
  assert.strictEqual(list.data.items[0].unavailable, true)
  await new Promise((resolve) => setImmediate(resolve))
  assert.strictEqual(list.data.items.length, 1, '离线正文失败后不能丢掉收藏条目')
  console.log('PASS 原文默认收起、摘要完整、展开不重复请求、离线收藏占位保留')
}
run().catch((error) => { console.error(error); process.exitCode = 1 })
