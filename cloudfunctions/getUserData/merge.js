/**
 * 收藏 / 打卡的合并逻辑（纯函数，可本地单测）。
 *
 * 合并口径 Last-Write-Wins：
 *   * 收藏按 `at` 比大小，打卡按 `updatedAt` 比大小，新者胜。
 *   * 时刻相同则保守保留已有值，避免两端来回抖动。
 *   * 删除用 tombstone 表达（{removed:true, at}），不是抹掉记录 ——
 *     否则「A 端删了、B 端还留着」时，B 端下次上报会把它复活。
 */

const TOMBSTONE_KEEP = 400 // 最多保留多少个删除标记

/** 按时间字段取新：inc 比 cur 新才采用 */
function pickNewer(curMap, incMap, timeKey) {
  const out = Object.assign({}, curMap || {})
  const inc = incMap || {}
  for (const sid of Object.keys(inc)) {
    const n = inc[sid]
    if (!n || typeof n !== 'object') continue
    const l = out[sid]
    if (!l) {
      out[sid] = n
      continue
    }
    const nt = n[timeKey] || ''
    const lt = l[timeKey] || ''
    if (nt > lt) out[sid] = n
  }
  return out
}

/** 把 tombstone 数量收敛一下，别让文档无限长大 */
function pruneTombstones(map) {
  const keys = Object.keys(map || {})
  if (keys.length <= TOMBSTONE_KEEP) return map
  const dead = keys.filter((k) => map[k] && map[k].removed)
  if (dead.length <= TOMBSTONE_KEEP) return map
  dead.sort((a, b) =>
    String(map[a].at || map[a].updatedAt || '').localeCompare(String(map[b].at || map[b].updatedAt || ''))
  )
  for (const k of dead.slice(0, dead.length - TOMBSTONE_KEEP)) delete map[k]
  return map
}

function sizeOf(map) {
  return map ? Object.keys(map).length : 0
}

/** 一次完整合并：返回 { favorite, checkin } */
function mergeAll(cur, inc) {
  const c = cur || {}
  const i = inc || {}
  return {
    favorite: pruneTombstones(pickNewer(c.favorite || {}, i.favorite || {}, 'at')),
    checkin: pruneTombstones(pickNewer(c.checkin || {}, i.checkin || {}, 'updatedAt')),
  }
}

module.exports = { pickNewer, pruneTombstones, sizeOf, mergeAll, TOMBSTONE_KEEP }
