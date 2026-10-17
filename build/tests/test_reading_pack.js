const assert = require('assert')
const fs = require('fs')
const path = require('path')
const pagePath = '../../miniprogram/pages/reading-pack/index'
assert(fs.existsSync(path.resolve(__dirname, pagePath + '.js')), '需要提供阅读包原生页面')
const notices = []
let payCalls = 0
global.wx = {
  showToast: (options) => notices.push(options.title),
  requestVirtualPayment: () => { payCalls++ },
}
global.getApp = () => ({ ready: Promise.resolve() })
let definition
global.Page = (page) => { definition = page }
require(pagePath)
const page = Object.assign({}, definition, { data: JSON.parse(JSON.stringify(definition.data)) })
page.setData = (patch) => Object.assign(page.data, patch)
let selectedTab = -1
page.getTabBar = () => ({ setTab: (index) => { selectedTab = index } })
assert.strictEqual(page.onShow, undefined, '阅读包入口关闭后不再选中底部导航')
page.onUnavailablePurchase()
assert.strictEqual(payCalls, 0, '支付未开通时不能发起真实交易')
assert(notices.some((notice) => notice.includes('尚未开放')))
const fileWrites = []
const documents = []
const failures = []
const originalConsoleError = console.error
console.error = (...args) => failures.push(args)
const sampleBytes = fs.readFileSync(path.resolve(__dirname, '../../design/reading-pack/sample.pdf'))
let failWrite = false
let packageReads = 0
wx.env = { USER_DATA_PATH: '/user-data' }
wx.getFileSystemManager = () => ({
  readFileSync: (filePath) => {
    packageReads++
    throw new Error(`readFileSync:fail no such file or directory ${filePath}`)
  },
  writeFileSync: (filePath, data, encoding) => {
    if (failWrite) throw new Error('storage full')
    assert.strictEqual(encoding, 'base64')
    fileWrites.push({ filePath, bytes: Buffer.from(data, encoding) })
  },
})
wx.openDocument = (options) => documents.push(options)
assert.strictEqual(typeof page.downloadSample, 'function', '阅读包需提供免费 PDF 下载测试入口')
page.downloadSample()
assert.strictEqual(packageReads, 0, '手机预览包不依赖直接读取 PDF 资源')
assert.strictEqual(page.data.sampleBusy, true)
assert.strictEqual(documents.length, 1)
assert.strictEqual(documents[0].fileType, 'pdf')
assert.strictEqual(documents[0].showMenu, true, '文件预览需提供保存、转发菜单')
assert(documents[0].filePath.startsWith('/user-data/'))
assert(documents[0].filePath.endsWith('.pdf'))
assert.deepStrictEqual(fileWrites[0].bytes, sampleBytes)
page.downloadSample()
assert.strictEqual(documents.length, 1, '打开中重复点击不再次写入或打开')
documents[0].complete()
assert.strictEqual(page.data.sampleBusy, false)
page.downloadSample()
documents[1].fail({ errMsg: 'openDocument:fail unable to open as fileType' })
documents[1].complete()
assert(notices.some((notice) => notice.includes('无法打开')))
failWrite = true
page.downloadSample()
assert.strictEqual(page.data.sampleBusy, false, '文件准备失败后可重试')
assert.strictEqual(documents.length, 2, '文件准备失败不打开文件')
assert(notices.some((notice) => notice.includes('保存失败')))
failWrite = false
page.downloadSample()
assert.strictEqual(documents.length, 3, '错误之后仍可再次打开样张')
documents[2].complete()
wx.openDocument = () => { throw new Error('openDocument unavailable') }
page.downloadSample()
assert.strictEqual(page.data.sampleBusy, false, '打开接口抛出异常后可重试')
assert.strictEqual(notices[notices.length - 1], '无法打开 PDF，请重试')
assert(failures.some(([message, error]) => message.includes('保存样张失败') && error.message === 'storage full'))
assert(failures.some(([message, error]) => message.includes('打开样张失败') && error.errMsg))
console.error = originalConsoleError
const bundledSample = require('../../miniprogram/data/reading-pack-sample')
assert.deepStrictEqual(Buffer.from(bundledSample, 'base64'), sampleBytes, '本机写出的 PDF 与免费样张逐字节一致')
const product = require('../../miniprogram/data/reading-pack')
assert.strictEqual(product.priceFen, 100)
assert.strictEqual(product.paymentEnabled, false)
assert.strictEqual(product.samples.length, 3)
assert(product.samples.every((item) => item.fields['说人话'] && item.title && item.num))
const about = fs.readFileSync(path.resolve(__dirname, '../../miniprogram/pages/about/index.wxml'), 'utf8')
assert(!about.includes('goReadingPack'), '关于页不再重复提供阅读包入口')
const app = require('../../miniprogram/app.json')
assert(app.pages.includes('pages/reading-pack/index'), '暂时关闭入口，保留阅读包页面以便恢复')
assert(!app.subPackages.find((entry) => entry.name === 'mine').pages.includes('pages/reading-pack/index'))
assert.deepStrictEqual(app.tabBar.list.map((entry) => entry.text), ['首页', '检索', '收藏', '关于'])
let tabDefinition
global.Component = (component) => { tabDefinition = component }
require('../../miniprogram/custom-tab-bar/index')
assert.deepStrictEqual(tabDefinition.data.list.map((entry) => entry.path), app.tabBar.list.map((entry) => '/' + entry.pagePath))
const switches = []
wx.switchTab = (options) => switches.push(options.url)
tabDefinition.methods.onTap.call({ data: tabDefinition.data }, { currentTarget: { dataset: { i: 3 } } })
assert.deepStrictEqual(switches, ['/pages/about/index'])
delete require.cache[require.resolve('../../miniprogram/pages/about/index')]
global.getApp = () => ({ globalData: { essentials: {} } })
require('../../miniprogram/pages/about/index')
definition.onShow.call({ getTabBar: page.getTabBar, apply() {} })
assert.strictEqual(selectedTab, 3, '关闭阅读包入口后关于页高亮第 4 项')
console.log('PASS 阅读包 PDF 下载、失败重试、100 分计划价格及未开通支付保护')
