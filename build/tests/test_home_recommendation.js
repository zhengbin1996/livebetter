const assert = require('assert')

global.wx = {
  getStorageSync() { return '' },
  setStorageSync() {},
  getFileSystemManager() { return {} },
  env: { USER_DATA_PATH: '/test' },
}
const picks = ['a', 'b', 'c', 'd'].map((key, index) => ({
  sid: `s01-${key}`, t: `建议 ${key}`, s: 1, n: index + 1,
  summary: `完整原文 ${key}`, summaryFull: true,
}))
const app = {
  ready: Promise.resolve(),
  globalData: { version: 'test', essentials: { picks } },
  versionInfo() { return {} },
}
global.getApp = () => app
let definition
global.Page = (page) => { definition = page }
require('../../miniprogram/pages/index/index')
const favorites = require('../../miniprogram/utils/favorites')
favorites.show = () => {}
function instance() {
  const page = Object.assign({}, definition, { data: JSON.parse(JSON.stringify(definition.data)), openMap: {} })
  page.setData = (patch) => Object.assign(page.data, patch)
  return page
}

async function run() {
  const originalRandom = Math.random
  try {
    Math.random = () => 0
    const first = instance()
    first.buildPick(0)
    assert.strictEqual(first.data.pick.sid, picks[0].sid, '首次推荐使用随机抽样')
    Math.random = () => 0.99
    const second = instance()
    second.buildPick(0)
    assert.strictEqual(second.data.pick.sid, picks[3].sid, '不同随机值能抽到不同推荐')

    first.onShow()
    assert.strictEqual(first.data.pick.sid, picks[3].sid, '重新进入首页重新随机抽取')
    const selected = first.data.pick.sid
    first.apply()
    first.onAdviceRetry()
    await first.onLoad()
    assert.strictEqual(first.data.pick.sid, selected, '刷新数据、重试和启动完成不重新抽取')

    Math.random = () => 0
    first.onPickShuffle()
    assert.strictEqual(first.data.pick.sid, picks[0].sid, '换一条按随机结果选择')
    first.onPickShuffle()
    assert.strictEqual(first.data.pick.sid, picks[1].sid, '相同随机值也不连续重复')
    Math.random = () => 0.99
    first.onPickShuffle()
    assert.strictEqual(first.data.pick.sid, picks[3].sid, '换一条可以随机跳过中间条目')

    app.globalData.essentials.picks = [picks[0]]
    first.onShow()
    first.onPickShuffle()
    assert.strictEqual(first.data.pick.sid, picks[0].sid, '只有一条候选时仍能显示')
    app.globalData.essentials.picks = []
    first.onShow()
    assert.strictEqual(first.data.pick, null, '空候选池不显示推荐')
    assert.strictEqual(first.data.pickTotal, 0)
    console.log('PASS 首页随机推荐、返回重抽、相邻不重复、刷新保留及空池处理')
  } finally {
    Math.random = originalRandom
  }
}
run().catch((error) => { console.error(error); process.exitCode = 1 })
