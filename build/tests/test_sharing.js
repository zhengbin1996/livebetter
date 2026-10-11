const assert = require('assert')
const menus = []
global.wx = {
  showShareMenu: (options) => menus.push({ visible: true, options }),
  hideShareMenu: (options) => menus.push({ visible: false, options }),
}
const share = require('../../miniprogram/utils/share')
const homePath = '/pages/index/index'
assert.strictEqual(share.home().path, homePath)
assert.strictEqual(share.directory('sections').path, '/pages/section-list/index')
assert.strictEqual(share.directory('docs').path, '/pages/section-list/index?tab=docs')
const item = { sid: 's01-abc123', num: 3, title: '冬天在室内烧煤、用燃气取暖的装报警器', fav: true, summary: '风险降低 12%' }
const sharedItem = share.item(item)
assert.strictEqual(sharedItem.title, item.title)
assert.strictEqual(sharedItem.path, '/pages/item-detail/index?sid=s01-abc123&num=3')
assert.strictEqual(sharedItem.path.includes('fav'), false)
assert.deepStrictEqual(share.timeline(sharedItem), { title: item.title, query: 'sid=s01-abc123&num=3', imageUrl: '/assets/share-cover.png' })
assert.ok(require('fs').existsSync(require('path').join(__dirname, '../../miniprogram', sharedItem.imageUrl)), '分享封面随主包内置')
assert.strictEqual(share.item({ sid: 'undefined', title: '正文未下载' }).path, homePath)
assert.strictEqual(share.item(null).path, homePath)
assert.strictEqual(share.section(1, '不要早死').path, '/subpackages/read/pages/section-detail/index?sec=1')
assert.strictEqual(share.section(0, '').path, homePath)
assert.strictEqual(share.doc({ sid: 'd-family', title: '家庭应急装备清单' }).path, '/subpackages/read/pages/doc-read/index?sid=d-family')
assert.strictEqual(share.doc(null).path, homePath)
share.enable(true)
assert.deepStrictEqual(menus.pop().options.menus, ['shareAppMessage', 'shareTimeline'])
share.enable(false)
assert.strictEqual(menus.pop().visible, false)
global.wx = {}
assert.doesNotThrow(() => share.enable(true))
assert.doesNotThrow(() => share.enable(false))
global.wx = { getLaunchOptionsSync: () => ({ scene: 1154 }), showShareMenu() { throw new Error('forbidden in single page') }, showToast() {} }
assert.strictEqual(share.singlePage(), true)
assert.doesNotThrow(() => share.enable(true), '朋友圈单页不调用禁用的菜单接口')
assert.strictEqual(share.requireFullApp(), true)
const memory = {}
global.wx = {
  getStorageSync: (key) => memory[key] || '',
  setStorageSync: (key, value) => { memory[key] = value },
  getFileSystemManager: () => ({ readFileSync() { throw new Error('not cached') } }),
  env: { USER_DATA_PATH: '/test' },
  setNavigationBarTitle() {}, showToast() {},
  showShareMenu: (options) => menus.push({ visible: true, options }),
  hideShareMenu: () => menus.push({ visible: false }),
}
const app = { ready: Promise.resolve(), globalData: { version: 'test', essentials: { docs: [{ sid: 'd-family', kind: 'doc', title: '家庭应急装备清单' }], sections: [] } } }
global.getApp = () => app
let definition
global.Page = (page) => { definition = page }
function loadPage(path) {
  require('../../miniprogram/' + path)
  const page = Object.assign({}, definition, { data: JSON.parse(JSON.stringify(definition.data)) })
  page.setData = (patch, callback) => { Object.assign(page.data, patch); if (callback) callback() }
  return page
}
const content = require('../../miniprogram/utils/content')
async function run() {
  const directory = loadPage('pages/section-list/index')
  await directory.onLoad({ tab: 'docs' })
  assert.strictEqual(directory.data.tab, 'docs', '分享接收方保留专题分类')
  assert.strictEqual(directory.onShareAppMessage().path, share.directory('docs').path)
  const detail = loadPage('pages/item-detail/index')
  const currentItem = Object.assign({}, item, { sid: 's01-current', fields: { '说人话': '<p>仅适用于成人，风险降低 12%。</p>' } })
  content.resolveItem = async (query) => {
    assert.strictEqual(query.sid, item.sid)
    assert.strictEqual(query.num, 3)
    return { shard: { sec: 1, secTitle: '不要早死' }, item: currentItem, stale: true }
  }
  await detail.onLoad({ sid: item.sid, num: 3 })
  assert.strictEqual(detail.data.originalOpen, false, '分享接收页面优先摘要')
  assert.strictEqual(detail.data.shareable, true)
  assert.strictEqual(detail.onShareAppMessage().path, share.item(currentItem).path, '跨版本兜底后分享当前条目')
  const section = loadPage('subpackages/read/pages/section-detail/index')
  content.loadSection = async (sec) => {
    assert.strictEqual(sec, 1)
    return { sec, secTitle: '不要早死', items: [], intro: [] }
  }
  await section.onLoad({ sec: '1' })
  assert.strictEqual(section.data.guideOpen, false)
  assert.strictEqual(section.onShareAppMessage().path, share.section(1, '不要早死').path)
  const doc = loadPage('subpackages/read/pages/doc-read/index')
  let docLoads = 0
  content.loadDoc = async (sid) => { docLoads++; return { sid, title: '家庭应急装备清单', body: '<p>原文</p>' } }
  await doc.onLoad({ sid: 'd-family' })
  assert.strictEqual(doc.onShareTimeline().query, 'sid=d-family')
  const invalidDoc = loadPage('subpackages/read/pages/doc-read/index')
  await invalidDoc.onLoad({ sid: 'd-verify' })
  assert.strictEqual(docLoads, 1, '分享旧过程材料不能绕过读者白名单')
  assert.strictEqual(invalidDoc.onShareAppMessage().path, homePath)
  assert.strictEqual(menus[menus.length - 1].visible, false)
  global.wx.getLaunchOptionsSync = () => ({ scene: 1154 })
  global.wx.navigateTo = () => { throw new Error('single page cannot navigate') }
  const refs = require('../../miniprogram/utils/refs')
  assert.doesNotThrow(() => refs.goItem(item.sid))
  assert.strictEqual(refs.handle('ref://' + item.sid).kind, 'none')
  assert.strictEqual(require('../../miniprogram/utils/favorites').toggle(currentItem), null, '朋友圈单页不保存独立收藏')
  let application
  global.App = (value) => { application = value }
  global.wx.cloud = { init() { throw new Error('single page must not initialize authenticated cloud') } }
  require('../../miniprogram/app')
  await application.bootstrap()
  assert.strictEqual(application.globalData.cloudReady, false)
  console.log('PASS 分享目标、原文标题、朋友圈参数、菜单兼容、冷进入、跨版本与不可用内容')
}
run().catch((error) => { console.error(error); process.exitCode = 1 })
