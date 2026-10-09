/**
 * 用户数据：收藏 + 打卡清单。
 *
 * 隔离方式
 *   集合 user_data 的文档 _id 就是 openid，openid 只从 wxContext 取，
 *   **绝不接受客户端传进来**（否则任何人改个参数就能读别人的收藏）。
 *   因为身份来自调用上下文，所以没有登录页、没有授权弹窗。
 *
 * 合并口径（Last-Write-Wins）
 *   收藏按 `at` 比大小，打卡按 `updatedAt` 比大小，新者胜。
 *   删除用tombstone 表达（{removed:true, at}），而不是直接抹掉记录 ——
 *   否则「A 端删了、B 端还留着」时，B 端下次上报会把它复活。
 *
 * 调用
 *   { op: 'read' }                          → { ok, favorite, checkin }
 *   { op: 'merge', favorite:{}, checkin:{} } → { ok, favorite, checkin }（合并后的全量）
 */
const cloud = require('wx-server-sdk')
const merge = require('./merge')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const COLL = 'user_data'
const MAX_KEYS = 2000 // 单次合并最多接受多少个 key，防滥用

/* ---------------------------------------------------------------- 存储 */

async function readDoc(openid) {
  try {
    const r = await db.collection(COLL).doc(openid).get()
    return r.data || {}
  } catch (e) {
    return null // 不存在（或集合还没建）
  }
}

async function ensureCollection() {
  try {
    await db.createCollection(COLL)
  } catch (e) {
    // 已存在（-501001 / -502005 之类）就忽略
  }
}

async function writeDoc(openid, data) {
  try {
    await db.collection(COLL).doc(openid).set({ data })
  } catch (e) {
    // 首次运行时集合可能还没建，建完再试一次
    await ensureCollection()
    await db.collection(COLL).doc(openid).set({ data })
  }
}

/* ---------------------------------------------------------------- 入口 */

exports.main = async (event) => {
  const ev = event || {}
  const wx = cloud.getWXContext()
  const openid = wx.OPENID
  if (!openid) return { ok: false, error: 'NO_OPENID' }

  const op = ev.op || 'read'
  const cur = (await readDoc(openid)) || {}

  if (op === 'read') {
    return { ok: true, favorite: cur.favorite || {}, checkin: cur.checkin || {}, updatedAt: cur.updatedAt || '' }
  }

  if (op === 'merge') {
    const incFav = ev.favorite || {}
    const incChk = ev.checkin || {}
    if (merge.sizeOf(incFav) > MAX_KEYS || merge.sizeOf(incChk) > MAX_KEYS) {
      return { ok: false, error: 'TOO_MANY_KEYS' }
    }

    const { favorite, checkin } = merge.mergeAll(cur, { favorite: incFav, checkin: incChk })
    await writeDoc(openid, { favorite, checkin, updatedAt: new Date().toISOString() })
    return { ok: true, favorite, checkin }
  }

  return { ok: false, error: 'BAD_OP', message: 'op 只能是 read 或 merge' }
}
