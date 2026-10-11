const assert = require('assert')
const memory = { 'htb.fav': { 's01-a': { title: '保留收藏' } } }
const notices = []
const clipboard = []
let pendingModal
let storageFails = false
let storageWriteFails = false
global.wx = {
  getStorageSync: (key) => {
    if (storageFails) throw new Error('storage unavailable')
    return memory[key] || ''
  },
  setStorageSync: (key, value) => {
    if (storageFails || storageWriteFails) throw new Error('storage full')
    memory[key] = value
  },
  getFileSystemManager: () => ({ readFileSync() { throw new Error('not cached') } }),
  env: { USER_DATA_PATH: '/test' },
  showToast: (notice) => notices.push(notice.title),
  showModal: (options) => { pendingModal = options },
  navigateTo() {},
  setClipboardData: ({ data }) => clipboard.push(data),
}
const sourceLegend = { evidence: [{ level: 'A', meaning: '原证据释义' }], howto: [{ head: '旧版安装', body: '旧版说明' }] }
const terms = [{ term: 'HR', meaning: '原术语释义' }]
const app = {
  ready: Promise.resolve(),
  globalData: {
    essentials: {
      glossary: terms,
      legend: sourceLegend,
      meta: { book: '当前书名', repo: 'https://example.com/current', license: 'CC BY 4.0', licenseUrl: 'https://example.com/license' },
      license: { attribution: '当前原作者署名', modifications: '原有改动说明' },
    },
  },
  versionInfo: () => ({ upstreamDate: '', syncedAt: '2020-01-01T00:00:00Z' }),
  refresh: async () => ({ ok: true }),
}
global.getApp = () => app
let definition
global.Page = (page) => { definition = page }
const content = require('../../miniprogram/utils/content')
content.localStats = () => ({ files: 1, total: 3, bytes: 100, totalBytes: 300, complete: false })
let pruned = 0
let cleared = 0
content.pruneOld = () => { pruned++; return 1 }
content.clearAll = () => { cleared++ }
function instance(modulePath) {
  delete require.cache[require.resolve(modulePath)]
  require(modulePath)
  const page = Object.assign({}, definition, { data: JSON.parse(JSON.stringify(definition.data)) })
  page.setData = (patch) => Object.assign(page.data, patch)
  return page
}
const cases = []
function test(name, run) { cases.push({ name, run }) }
const versionPath = '../../miniprogram/subpackages/mine/pages/version/index'
test('unknown content date never falls back to sync date', () => {
  const page = instance(versionPath)
  page.apply()
  assert.strictEqual(page.data.contentDate, '未知日期')
  assert.strictEqual(page.data.checkedText, '尚未检查')
})
test('successful checks update independent checked time', async () => {
  const page = instance(versionPath)
  await page.onSync()
  assert(Number.isFinite(Date.parse(memory['htb.content-checked-at'])))
  assert.notStrictEqual(page.data.checkedText, '尚未检查')
  const checkedAt = memory['htb.content-checked-at']
  app.refresh = async () => ({ ok: false, reason: 'CLOUD_INTERNAL_TRACE' })
  await page.onSync()
  assert.strictEqual(memory['htb.content-checked-at'], checkedAt)
  assert(!notices[notices.length - 1].includes('CLOUD_INTERNAL_TRACE'))
})
test('check exceptions recover busy state and do not leak details', async () => {
  const page = instance(versionPath)
  app.refresh = async () => { throw new Error('internal cloud path') }
  await page.onSync()
  assert.strictEqual(page.data.busy, false)
  assert(!notices[notices.length - 1].includes('internal cloud path'))
})
test('storage failures do not prevent a successful check', async () => {
  const page = instance(versionPath)
  storageFails = true
  app.refresh = async () => ({ ok: true })
  try {
    await page.onSync()
    assert.strictEqual(page.data.busy, false)
    assert.strictEqual(notices[notices.length - 1], '内容已更新到最新')
  } finally { storageFails = false }
})
test('failed checked-time writes still show the current successful check', async () => {
  const page = instance(versionPath)
  memory['htb.content-checked-at'] = '2000-01-01T00:00:00Z'
  storageWriteFails = true
  try {
    await page.onSync()
    assert(!page.data.checkedText.startsWith('2000-01-01'))
    assert.strictEqual(memory['htb.content-checked-at'], '2000-01-01T00:00:00Z')
  } finally { storageWriteFails = false }
})
test('download prevents pruning and clearing including delayed modal confirmation', async () => {
  const page = instance(versionPath)
  let finishDownload
  content.downloadAll = (onProgress) => {
    onProgress({ done: 1, total: 3, percent: 33, bytes: 100, totalBytes: 300 })
    return new Promise((resolve) => { finishDownload = resolve })
  }
  page.onClear()
  const confirmation = pendingModal
  const download = page.onDownload()
  assert.strictEqual(page.data.downBusy, true)
  assert.strictEqual(page.data.progress.text, '1 / 3 份')
  page.onPrune()
  page.onClear()
  confirmation.success({ confirm: true })
  assert.strictEqual(pruned, 0)
  assert.strictEqual(cleared, 0)
  finishDownload()
  await download
  assert.strictEqual(page.data.downBusy, false)
  page.onPrune()
  page.onClear()
  pendingModal.success({ confirm: true })
  assert.strictEqual(pruned, 1)
  assert.strictEqual(cleared, 1)
  assert.deepStrictEqual(memory['htb.fav'], { 's01-a': { title: '保留收藏' } })
})
test('download failure clears busy state and keeps internal errors out of notices', async () => {
  const page = instance(versionPath)
  content.downloadAll = async () => { throw new Error('private cloud://path') }
  await page.onDownload()
  assert.strictEqual(page.data.downBusy, false)
  assert.strictEqual(page.data.progress, null)
  assert(!notices[notices.length - 1].includes('cloud://'))
})
test('cache management starts collapsed and toggles without clearing content', () => {
  const page = instance(versionPath)
  const beforeClear = cleared
  assert.strictEqual(page.data.cacheManagementOpen, false)
  page.toggleCacheManagement()
  assert.strictEqual(page.data.cacheManagementOpen, true)
  page.toggleCacheManagement()
  assert.strictEqual(page.data.cacheManagementOpen, false)
  assert.strictEqual(cleared, beforeClear)
})
test('about uses current metadata for attribution and copied links', async () => {
  const page = instance('../../miniprogram/pages/about/index')
  await page.onLoad()
  assert.strictEqual(page.data.bookName, '当前书名')
  assert.strictEqual(page.data.attribution, '当前原作者署名')
  page.copyRepo()
  page.copyLicense()
  assert.deepStrictEqual(clipboard, ['https://example.com/current', 'https://example.com/license'])
})
test('glossary preserves original meanings and replaces reading help without mutating metadata', async () => {
  const page = instance('../../miniprogram/subpackages/mine/pages/glossary/index')
  await page.onLoad({ legend: '1' })
  assert.deepStrictEqual(page.data.terms, terms)
  assert.deepStrictEqual(page.data.legend.evidence, sourceLegend.evidence)
  assert.deepStrictEqual(page.data.legend.howto, require('../../miniprogram/utils/reading-help'))
  assert.deepStrictEqual(sourceLegend.howto, [{ head: '旧版安装', body: '旧版说明' }])
  page.onInput({ detail: { value: '原术语' } })
  assert.strictEqual(page.data.filtered[0].term, 'HR')
})
async function run() {
  let failures = 0
  for (const entry of cases) {
    try { await entry.run(); console.log(`PASS ${entry.name}`) }
    catch (error) { failures++; console.error(`FAIL ${entry.name}: ${error.message}`) }
  }
  if (failures) process.exitCode = 1
}
run()
