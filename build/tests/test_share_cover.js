const assert = require('assert')
const cover = require('../../miniprogram/utils/share-cover')
const measure = (text) => Array.from(text).length * 10
const sample = '成人风险降低 12%，儿童不能用；适用于冬季。'
const lines = cover.wrap(sample, measure, 100, 3)
assert.strictEqual(lines.join(''), sample)
assert.strictEqual(cover.wrap('一二三四五六七八九十十一十二', measure, 40, 2).join(''), '一二三四五六七…')
assert.strictEqual(cover.wrap('🙂🙂🙂🙂🙂', measure, 20, 2).join(''), '🙂🙂🙂…')
const info = cover.item({ title: '原书标题', fields: { '说人话': '<p>成人风险降低 <b>12%</b>，儿童不能用。</p>' }, summary: '旧摘要' })
assert.strictEqual(info.summary, '成人风险降低 12%，儿童不能用。')
assert.strictEqual(info.title, '原书标题')
assert.strictEqual(cover.item({ title: '缺失摘要' }).summary, '')
assert.strictEqual(cover.item({ title: '旧片段', summary: '旧摘要', summaryFull: false }).summary, '')
const page = { data: {}, setData(patch) { Object.assign(this.data, patch) } }
global.wx = {}
async function run() {
  await cover.prepare(page, info)
  assert.strictEqual(page.shareCoverPath, '', '不支持画布时保留静态兜底')
  const requests = []
  global.wx = {
    createSelectorQuery: () => ({ in() { return this }, select() { return this }, fields() { return this }, exec(callback) { callback([{ node: { width: 0, height: 0, getContext: () => new Proxy({ measureText: (text) => ({ width: measure(text) }) }, { get(target, key) { return target[key] || (() => {}) } }) } }]) } }),
    canvasToTempFilePath: (options) => requests.push(options),
  }
  const first = cover.prepare(page, info)
  const second = cover.prepare(page, Object.assign({}, info, { title: '新版标题' }))
  requests[1].success({ tempFilePath: '/new.png' })
  await second
  requests[0].success({ tempFilePath: '/old.png' })
  await first
  assert.strictEqual(page.shareCoverPath, '/new.png', '过期封面不能覆盖当前内容')
  assert.strictEqual(cover.attach(page, { title: '标题', imageUrl: '/fallback.png' }).imageUrl, '/new.png')
  const failed = cover.prepare(page, info)
  requests[2].fail(new Error('canvas unavailable'))
  await failed
  assert.strictEqual(page.shareCoverPath, '', '生成失败不得用上一条内容的封面')
  assert.strictEqual((await cover.attach(page, { imageUrl: '/fallback.png' }).promise).imageUrl, '/fallback.png')
  console.log('PASS 封面原文摘录、换行省略、缺失摘要、Unicode、生成失败与乱序')
}
run().catch((error) => { console.error(error); process.exitCode = 1 })
