const assert = require('assert')
const memory = { 'htb.check': {
  's01-kept': { done: false, plan: 'today', updatedAt: '2026-10-11T10:00:00Z' },
  's01-deleted': { removed: true, updatedAt: '2026-10-11T11:00:00Z' },
} }
global.wx = {
  getStorageSync: (key) => JSON.parse(JSON.stringify(memory[key] || '')),
  setStorageSync: (key, value) => { memory[key] = JSON.parse(JSON.stringify(value)) },
}
const calls = []
const remoteFavorites = {}
require('../../miniprogram/utils/cloud').call = async (name, payload) => {
  calls.push(payload)
  if (payload.op === 'read') return { ok: true, favorite: remoteFavorites, checkin: {
    's01-deleted': { done: false, updatedAt: '2026-10-10T10:00:00Z' },
  } }
  return { ok: true }
}
const store = require('../../miniprogram/utils/store')
async function run() {
  await store.pull()
  await store.flush()
  const merged = calls.find((payload) => payload.op === 'merge')
  assert(merged, '冷启动后需要补传已保存本机的操作')
  assert.strictEqual(merged.checkin['s01-kept'].plan, 'today')
  assert.strictEqual(merged.checkin['s01-deleted'].removed, true)
  assert.strictEqual(store.getCheckin('s01-deleted'), null)
  store.toggleFavorite('s01-favorite')
  remoteFavorites['s01-favorite'] = Object.assign({}, store.getFavorites()['s01-favorite'])
  store.removeFavorite('s01-favorite')
  await store.pull()
  assert.strictEqual(store.isFavorite('s01-favorite'), false, '较旧云端收藏不能覆盖本机删除')
  assert.strictEqual(memory['htb.fav']['s01-favorite'].removed, true)
  delete require.cache[require.resolve('../../miniprogram/utils/store')]
  const restarted = require('../../miniprogram/utils/store')
  calls.length = 0
  await restarted.pull()
  await restarted.flush()
  assert.strictEqual(restarted.isFavorite('s01-favorite'), false)
  assert.strictEqual(calls.find((payload) => payload.op === 'merge').favorite['s01-favorite'].removed, true)
  const inflight = []
  require('../../miniprogram/utils/cloud').call = (name, payload) => new Promise((resolve) => { inflight.push({ payload, resolve }) })
  restarted.setCheckin('s01-order', { done: true })
  const first = restarted.flush()
  restarted.setCheckin('s01-order', { done: false })
  const second = restarted.flush()
  assert.strictEqual(inflight.length, 1, '完成与撤销不得并发写云端')
  inflight[0].resolve({ ok: true })
  await Promise.all([first, second])
  const last = restarted.flush()
  assert.strictEqual(inflight[1].payload.checkin['s01-order'].done, false)
  inflight[1].resolve({ ok: true })
  await last
  console.log('PASS 冷启动补传本机行动与删除，旧云记录不会复活清单')
}
run().catch((error) => { console.error(error); process.exitCode = 1 })
