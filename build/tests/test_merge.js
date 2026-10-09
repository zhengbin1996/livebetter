/**
 * getUserData 合并逻辑的本地自测（不需要云环境）。
 * 跑法：node build/tests/test_merge.js
 */
const merge = require('../../cloudfunctions/getUserData/merge')

let failed = 0
function ok(name, cond, extra) {
  if (cond) console.log('  PASS ' + name)
  else {
    failed += 1
    console.log('  FAIL ' + name + (extra ? '  -> ' + extra : ''))
  }
}

// 1) 时间新者胜
{
  const cur = { a: { at: '2026-01-01T00:00:00Z' } }
  const inc = { a: { at: '2026-02-01T00:00:00Z' } }
  const out = merge.pickNewer(cur, inc, 'at')
  ok('新时刻覆盖旧时刻', out.a.at === '2026-02-01T00:00:00Z')
}

// 2) 旧值不覆盖新值
{
  const cur = { a: { at: '2026-02-01T00:00:00Z' } }
  const inc = { a: { at: '2026-01-01T00:00:00Z' } }
  const out = merge.pickNewer(cur, inc, 'at')
  ok('旧值不覆盖新值', out.a.at === '2026-02-01T00:00:00Z')
}

// 3) 时刻相同保留原值（防抖动）
{
  const cur = { a: { at: '2026-02-01T00:00:00Z', note: 'server' } }
  const inc = { a: { at: '2026-02-01T00:00:00Z', note: 'client' } }
  const out = merge.pickNewer(cur, inc, 'at')
  ok('时刻相同保守保留原值', out.a.note === 'server')
}

// 4) 新增项被合入
{
  const out = merge.pickNewer({}, { b: { at: '2026-02-01T00:00:00Z' } }, 'at')
  ok('新增项被合入', !!out.b)
}

// 5) 删除（tombstone）能压过更早的收藏
{
  const cur = { a: { at: '2026-01-01T00:00:00Z' } }
  const inc = { a: { removed: true, at: '2026-03-01T00:00:00Z' } }
  const out = merge.pickNewer(cur, inc, 'at')
  ok('删除压过更早的收藏', out.a.removed === true)
}

// 6) 不会复活：服务端已标记删除，客户端旧收藏不该把它拉回来
{
  const cur = { a: { removed: true, at: '2026-03-01T00:00:00Z' } }
  const inc = { a: { at: '2026-01-01T00:00:00Z' } }
  const out = merge.pickNewer(cur, inc, 'at')
  ok('旧收藏不会复活已删除项', out.a.removed === true)
}

// 7) 打卡按 updatedAt
{
  const cur = { s1: { done: false, updatedAt: '2026-01-01T00:00:00Z' } }
  const inc = { s1: { done: true, updatedAt: '2026-02-01T00:00:00Z' } }
  const out = merge.pickNewer(cur, inc, 'updatedAt')
  ok('打卡按 updatedAt 取新', out.s1.done === true)
}

// 8) tombstone 收敛
{
  const big = {}
  for (let i = 0; i < 500; i++) big['k' + i] = { removed: true, at: '2026-01-01T00:00:00Z' }
  big.keep = { at: '2026-05-01T00:00:00Z' }
  const out = merge.pruneTombstones(big)
  const deadLeft = Object.keys(out).filter((k) => out[k].removed).length
  ok('tombstone 被收敛到上限内', deadLeft <= merge.TOMBSTONE_KEEP, 'left=' + deadLeft)
  ok('非删除项不被误删', !!out.keep)
}

// 9) mergeAll 端到端
{
  const cur = { favorite: { a: { at: '2026-01-01T00:00:00Z' } }, checkin: {} }
  const inc = {
    favorite: { a: { at: '2026-03-01T00:00:00Z' }, b: { at: '2026-02-01T00:00:00Z' } },
    checkin: { s2: { done: true, updatedAt: '2026-02-01T00:00:00Z' } },
  }
  const out = merge.mergeAll(cur, inc)
  ok('mergeAll 收藏合并对', out.favorite.a.at === '2026-03-01T00:00:00Z' && !!out.favorite.b)
  ok('mergeAll 打卡合并对', out.checkin.s2.done === true)
}

// 10) 入参缺省不抛错
{
  const out = merge.mergeAll(null, null)
  ok('空入参返回空结构', Object.keys(out.favorite).length === 0 && Object.keys(out.checkin).length === 0)
}

// 11) 忽略非对象值
{
  const out = merge.pickNewer({}, { bad: 'oops', good: { at: '2026-01-01T00:00:00Z' } }, 'at')
  ok('忽略非对象值', !out.bad && !!out.good)
}

console.log('\n' + (failed ? failed + ' 项失败' : '全部通过'))
process.exit(failed ? 1 : 0)
