const assert = require('assert')
const memory = {}
const requests = []
const cloud = require('../../miniprogram/utils/cloud')
cloud.call = () => new Promise((resolve, reject) => { requests.push({ resolve, reject }) })
global.wx = {
  getStorageSync: (key) => memory[key] || '',
  setStorageSync: (key, value) => { memory[key] = value },
  getFileSystemManager: () => ({ readFileSync() { throw new Error('offline') } }),
  env: { USER_DATA_PATH: '/test' },
  showToast() {},
  hideKeyboard() {},
}
const app = { ready: Promise.resolve(), globalData: { essentials: { sections: [], docs: [{ sid: 'd-reader', kind: 'doc' }] } } }
global.getApp = () => app
let definition
global.Page = (page) => { definition = page }
require('../../miniprogram/pages/search/index')
function page() {
  const instance = Object.assign({}, definition, { data: JSON.parse(JSON.stringify(definition.data)) })
  instance.setData = (patch) => { Object.assign(instance.data, patch) }
  return instance
}
async function run() {
  const instance = page()
  instance.data.q = '旧词'
  const first = instance.run()
  instance.data.q = '新词'
  const second = instance.run()
  requests[1].resolve({ ok: true, hits: [{ sid: 's01-new', title: '新结果' }], total: 1 })
  await second
  requests[0].resolve({ ok: true, hits: [{ sid: 's01-old', title: '旧结果' }], total: 1 })
  await first
  assert.strictEqual(instance.data.hits[0].sid, 's01-new', '旧响应不能覆盖新结果')
  instance.applyHits([{ sid: 'd-verify', kind: 'doc', docKind: 'verify' }, { sid: 'd-reader', kind: 'doc', docKind: 'doc' }, { sid: 's01-safe', title: '建议' }, { sid: 'd-map', kind: 'doc', docKind: 'refsmap' }], 4, true, '建议')
  assert.deepStrictEqual(instance.data.hits.map((hit) => hit.sid), ['s01-safe', 'd-reader'], '建议优先且不显示修订材料')
  assert.strictEqual(instance.data.total, 2, '数量与可读结果一致')
  instance.applyHits([{ sid: 's01-safe', title: '建议' }, { sid: 'd-reader', kind: 'doc', docKind: 'doc' }, { sid: 'd-verify', kind: 'doc', docKind: 'verify' }], 678, true, '的')
  assert.strictEqual(instance.data.total, 677, '返回上限不截断建议总数，旧响应仅扣除过程材料')
  const content = require('../../miniprogram/utils/content')
  const originalRead = content.readLocal
  content.readLocal = (path) => path === 'docs/d-reader.json' ? { title: '专题阅读', body: '<p>应急装备</p>' } : null
  assert.deepStrictEqual(instance.searchLocal('应急').map((hit) => hit.sid), ['d-reader'], '离线搜索包含已缓存的专题')
  instance.data.grade = 'A'
  assert.strictEqual(instance.searchLocal('应急').length, 0, '条目筛选不匹配专题')
  instance.data.grade = ''
  content.readLocal = originalRead
  instance.data.q = '清空前'
  const pending = instance.run()
  instance.clearQ()
  requests[2].resolve({ ok: true, hits: [{ sid: 's01-old' }], total: 1 })
  await pending
  assert.strictEqual(instance.data.hits.length, 0, '清空后忽略旧响应')
  instance.toggleFilters()
  instance.pickGrade({ currentTarget: { dataset: { v: 'A' } } })
  assert.strictEqual(instance.data.grade, '', '编辑弹层不影响已应用条件')
  assert.strictEqual(instance.data.draft.grade, 'A')
  instance.closeFilters()
  assert.strictEqual(instance.data.grade, '')
  instance.toggleFilters()
  instance.pickGrade({ currentTarget: { dataset: { v: 'B' } } })
  instance.applyFilters()
  assert.strictEqual(instance.data.grade, 'B')
  assert.strictEqual(instance.data.filtersOpen, false)
  for (let index = 0; index < 8; index++) instance.unshiftSealed('词' + index)
  const restored = page()
  await restored.onLoad()
  assert.strictEqual(restored.data.sealed.length, 6)
  assert.strictEqual(restored.data.sealed[0], '词7')
  const callbacks = []
  require('../../miniprogram/utils/advice-content').hydrate = (items, callback) => { callbacks.push(callback) }
  instance.data.hits = [{ sid: 's01-a', kind: 'item', title: '原题' }]
  instance.data.visible = instance.data.hits.slice()
  instance.data.shown = 1
  instance.hydrateVisible()
  instance.hydrateVisible()
  callbacks[1]([{ sid: 's01-a', summary: '完整摘要', summaryFull: true }])
  callbacks[0]([{ sid: 's01-a', summary: '', summaryFull: false }])
  assert.strictEqual(instance.data.hits[0].summary, '完整摘要', '同一检索的过期补全不能覆盖完整摘要')
  console.log('PASS 搜索响应乱序、清空失效、筛选草稿应用与取消、六条搜索历史')
}
run().catch((error) => { console.error(error); process.exitCode = 1 })
