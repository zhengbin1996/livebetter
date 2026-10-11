const assert = require('assert')
const fs = require('fs')
const path = require('path')
const root = path.resolve(__dirname, '../../miniprogram')
const config = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
assert.deepStrictEqual(config.tabBar.list.map((tab) => tab.text), ['首页', '检索', '收藏', '阅读包', '关于'])
assert(config.pages.includes('pages/favorites/index'))
assert(!config.pages.includes('pages/checkin/index'))
const templates = ['pages/index/index.wxml', 'pages/search/index.wxml', 'pages/favorites/index.wxml', 'pages/item-detail/index.wxml', 'subpackages/read/pages/section-detail/index.wxml', 'components/item-row/index.wxml']
templates.forEach((file) => {
  const source = fs.readFileSync(path.join(root, file), 'utf8')
  assert(!/action-control|action-feedback|今天待做|标记完成|移到今天/.test(source), file)
})
const homeTemplate = fs.readFileSync(path.join(root, 'pages/index/index.wxml'), 'utf8')
assert(!/goVerifyList|goRefsMap|goGlossary/.test(homeTemplate), '阅读辅助入口不再出现在首页')
const aboutTemplate = fs.readFileSync(path.join(root, 'pages/about/index.wxml'), 'utf8')
assert(aboutTemplate.includes('原作与说明') && aboutTemplate.includes('阅读帮助'))
const memory = { 'htb.check': { 's01-a': { done: true, plan: 'today' } } }
global.wx = {
  getStorageSync: (key) => memory[key] || '',
  setStorageSync: (key, value) => { memory[key] = JSON.parse(JSON.stringify(value)) },
  getFileSystemManager: () => ({ readFileSync() { throw new Error('not cached') } }),
  env: { USER_DATA_PATH: '/test' }, showToast() {},
}
const app = { ready: Promise.resolve(), globalData: { version: 'test', essentials: { picks: [{ sid: 's01-a', t: '推荐原题', s: 1, n: 1, summary: '完整原文', summaryFull: true }] } } }
global.getApp = () => app
let definition
global.Page = (page) => { definition = page }
require('../../miniprogram/pages/index/index')
const home = Object.assign({}, definition, { data: JSON.parse(JSON.stringify(definition.data)) })
home.setData = (patch) => Object.assign(home.data, patch)
home.buildPick(0)
assert.strictEqual(home.data.pick.sid, 's01-a', '旧清单记录不能影响推荐')
const favorites = require('../../miniprogram/utils/favorites')
let refreshed = 0
const unsubscribe = favorites.subscribe(() => { refreshed++ })
assert.strictEqual(favorites.toggle(home.data.pick), true)
assert.strictEqual(require('../../miniprogram/utils/store').isFavorite('s01-a'), true)
assert.strictEqual(favorites.toggle(home.data.pick), false)
assert.strictEqual(refreshed, 2)
global.wx.setStorageSync = () => { throw new Error('full') }
assert.strictEqual(favorites.toggle(home.data.pick), null)
assert.strictEqual(refreshed, 2, '保存失败不展示成功')
unsubscribe()
const destinations = []
global.wx.navigateTo = ({ url }) => destinations.push(url)
require('../../miniprogram/pages/about/index')
definition.goGlossary()
definition.goVersion()
assert.deepStrictEqual(destinations, ['/subpackages/mine/pages/glossary/index', '/subpackages/mine/pages/version/index'])
assert.strictEqual(definition.goVerify, undefined)
assert.strictEqual(definition.goRefsMap, undefined)
console.log('PASS 阅读导航、行动模块移除、推荐独立、收藏刷新与保存失败')
process.exit(0)
