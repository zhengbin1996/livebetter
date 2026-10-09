/**
 * 返回当前内容版本的 manifest。
 *
 * 小程序启动时调一次：拿到 commit / 版本号 / 分片清单（含云存储 fileID）。
 * 客户端不需要再问每个分片「fileID 是多少」，直接从 manifest 里取。
 *
 * 集合：manifest，固定用 _id = 'current' 的单文档。
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async () => {
  try {
    const r = await db.collection('manifest').doc('current').get()
    const m = r.data || {}

    // 关键：brokenRefs 只回数量，不回全量明细（可能几百条，客户端用不上）
    const broken = Array.isArray(m.brokenRefs) ? m.brokenRefs.length : 0
    const out = Object.assign({}, m, { brokenRefCount: broken })
    delete out.brokenRefs
    delete out._id
    delete out._openid

    return Object.assign({ ok: true }, out)
  } catch (e) {
    // 集合或文档还不存在（尚未完成首次同步）
    return { ok: false, error: 'NO_MANIFEST', message: String(e && e.errMsg ? e.errMsg : e) }
  }
}
