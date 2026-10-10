/**
 * 清单（行动看板）本地逻辑自测 —— 不需要小程序环境。
 * 跑法：node build/tests/test_store.js
 *
 * 为什么要测：清单的三段（今天/稍后/已完成）与「连续天数」都只由本地存储推导，
 * 逻辑错了在界面上**看不出来**（最多是数字不对，没人会怀疑到存储层）。
 * 这里把 store.js 的 wx.getStorageSync/setStorageSync 换成内存实现，
 * 直接验证桶划分、done 翻转与完成日记的增减。
 */

// --- 迷你 wx 运行时：只需要存储 ---
const mem = {}
global.wx = {
  getStorageSync: (k) => (k in mem ? mem[k] : ''),
  setStorageSync: (k, v) => {
    mem[k] = JSON.parse(JSON.stringify(v))
  },
}

const store = require('../../miniprogram/utils/store')

let failed = 0
function ok(name, cond, extra) {
  if (cond) console.log('  PASS ' + name)
  else {
    failed += 1
    console.log('  FAIL ' + name + (extra !== undefined ? '  -> ' + extra : ''))
  }
}

function reset() {
  Object.keys(mem).forEach((k) => delete mem[k])
}

const pad2 = (n) => (n < 10 ? `0${n}` : `${n}`)
function dayKeyOf(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}
function seedDays(offsets) {
  // offsets: { 0: 1, 1: 2 } 表示今天 1 条、昨天 2 条
  const days = {}
  Object.keys(offsets).forEach((off) => {
    const d = new Date()
    d.setDate(d.getDate() - Number(off))
    days[dayKeyOf(d)] = offsets[off]
  })
  mem['htb.days'] = days
}

// 1) 加进清单默认落在「今天」
{
  reset()
  store.addToList('s01-aaa', '')
  const b = store.listBuckets()
  ok('新加的条目落在「今天」', b.today.includes('s01-aaa') && !b.later.length && !b.done.length)
  ok('记录里 plan=today', store.getCheckin('s01-aaa').plan === 'today')
  ok('加进清单不算完成（不动完成日记）', store.dayStats().today === 0)
}

// 2) 挪到「稍后」
{
  reset()
  store.addToList('s01-aaa')
  store.setPlan('s01-aaa', 'later')
  const b = store.listBuckets()
  ok('挪到稍后后不在「今天」', !b.today.length && b.later.includes('s01-aaa'))
}

// 3) 标记做到 → 进「已完成」并写完成日记
{
  reset()
  store.addToList('s01-aaa')
  store.setCheckin('s01-aaa', { done: true })
  const b = store.listBuckets()
  ok('做到后进「已完成」', b.done.includes('s01-aaa') && !b.today.length)
  ok('完成日记记到今天', store.dayStats().today === 1)
  ok('连续天数为 1', store.dayStats().streak === 1)
}

// 4) 先「稍后」再做到，也算完成（计划状态不阻碍完成）
{
  reset()
  store.addToList('s01-aaa', 'later')
  store.setCheckin('s01-aaa', { done: true })
  ok('稍后里的条目也能标做到', store.listBuckets().done.includes('s01-aaa'))
  ok('完成日记 +1', store.dayStats().today === 1)
}

// 5) 取消做到 → 完成日记要减回去（否则连续天数会虚高）
{
  reset()
  store.addToList('s01-aaa')
  store.setCheckin('s01-aaa', { done: true })
  store.setCheckin('s01-aaa', { done: false })
  ok('取消做到后完成日记归零', store.dayStats().today === 0)
  ok('取消做到后回到「今天」', store.listBuckets().today.includes('s01-aaa'))
}

// 6) 直接移出一条已完成的记录，也不能留下幽灵计数
{
  reset()
  store.addToList('s01-aaa')
  store.setCheckin('s01-aaa', { done: true })
  store.removeCheckin('s01-aaa')
  ok('移出已完成条目后完成日记归零', store.dayStats().today === 0)
  ok('移出后清单里没有它', Object.keys(store.getCheckins()).length === 0)
}

// 7) 连续天数：今天还没做，但昨天和前天做了 → 仍算 2 天
{
  reset()
  seedDays({ 1: 1, 2: 1 })
  const d = store.dayStats()
  ok('今天没做不算断签', d.streak === 2, 'streak=' + d.streak)
  ok('今天完成数为 0', d.today === 0)
}

// 8) 连续天数：中间断了一天就停在断点
{
  reset()
  seedDays({ 0: 1, 1: 1, 3: 1 }) // 前天（off=2）是空的
  const d = store.dayStats()
  ok('中途断开后只数到断点', d.streak === 2, 'streak=' + d.streak)
}

// 8b) 昨天与今天都没做 → 连续天数必须归零（不能把前天的记录接着数）
{
  reset()
  seedDays({ 2: 1 })
  const d = store.dayStats()
  ok('昨天没做则连续天数归零', d.streak === 0, 'streak=' + d.streak)
}

// 9) 完全没记录 → 0 天，不报错
{
  reset()
  const d = store.dayStats()
  ok('空记录返回 0 天', d.streak === 0 && d.today === 0)
}

// 10) plan 只认 'later'，其它值一律当今天（防脏数据把条目藏起来）
{
  reset()
  store.setCheckin('s01-aaa', { plan: 'whatever' })
  ok('非法 plan 归一为 today', store.getCheckin('s01-aaa').plan === 'today')
}

// 11) 收藏与清单互不影响
{
  reset()
  store.toggleFavorite('s01-aaa')
  ok('收藏不进入清单桶', store.listBuckets().today.length === 0)
  ok('收藏里有它', Object.keys(store.getFavorites()).includes('s01-aaa'))
}

console.log('\n' + (failed ? failed + ' 项失败' : '全部通过'))
process.exit(failed ? 1 : 0)
