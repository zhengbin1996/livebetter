/**
 * 全文检索云函数（入口）。
 *
 * 为什么放服务端
 *   检索语料约 3.6 MB。放主包会撞 2 MB 上限；放分片则每次搜索都得先把全书
 *   下载一遍。放云函数既省用户流量，又能借热实例的内存做缓存。
 *
 * 索引策略
 *   语料只有 675 + 145 条，线性扫描单次只要几毫秒，所以不建倒排索引 ——
 *   少一份要维护、要在构建期同步的复杂结构。
 *   corpus.json 按 manifest 里的 fileID 从云存储取一次，模块级按版本缓存；
 *   热实例上的后续查询全是内存操作。
 *
 * 调用
 *   event = { q, filters: { sec, evidence, tier, caliber, cost:{money,time,will} } }
 *   返回  = { ok, version, total, hits:[...], took }
 *   hits 项：{ sid, kind:'item'|'doc', sec, num, title, snippet, e, r, tag, dispute }
 *
 * 纯逻辑（归一化 / 打分 / 摘要）在 search.js，这里只管 I/O 与缓存。
 */
const cloud = require('wx-server-sdk')
const fs = require('fs')
const search = require('./search')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const MANIFEST_TTL = 60 * 1000 // manifest 缓存 60 秒，省掉每次调用的 DB 读

let manifestCache = { at: 0, data: null }
let corpusCache = { version: '', corpus: null }

/* ---------------------------------------------------------------- 语料 */

async function getManifest() {
  const now = Date.now()
  if (manifestCache.data && now - manifestCache.at < MANIFEST_TTL) return manifestCache.data
  const r = await db.collection('manifest').doc('current').get()
  manifestCache = { at: now, data: r.data || null }
  return manifestCache.data
}

/** 取语料，按版本缓存；版本没变就直接用内存里的 */
async function getCorpus() {
  const m = await getManifest()
  if (!m) throw new Error('NO_MANIFEST')
  const shard = (m.shards || []).find((s) => s.kind === 'corpus')
  if (!shard || !shard.fileID) throw new Error('NO_CORPUS')
  if (corpusCache.corpus && corpusCache.version === m.version) return corpusCache.corpus

  const dl = await cloud.downloadFile({ fileID: shard.fileID })
  let text
  if (dl && dl.fileContent) {
    text = Buffer.isBuffer(dl.fileContent) ? dl.fileContent.toString('utf8') : String(dl.fileContent)
  } else if (dl && dl.tempFilePath) {
    text = fs.readFileSync(dl.tempFilePath, 'utf8')
  } else {
    throw new Error('CORPUS_EMPTY')
  }

  const corpus = search.prepare(JSON.parse(text))
  corpusCache = { version: m.version, corpus }
  return corpus
}

/* ---------------------------------------------------------------- 主入口 */

exports.main = async (event) => {
  const ev = event || {}
  const q = String(ev.q || '').trim()
  if (!q) return { ok: false, error: 'EMPTY_QUERY' }

  const started = Date.now()
  let corpus
  try {
    corpus = await getCorpus()
  } catch (e) {
    // 让客户端退回本地缓存检索，而不是弹错误
    return { ok: false, error: String((e && e.message) || e) }
  }

  const r = search.runSearch(corpus, q, ev.filters || null)
  return {
    ok: true,
    version: corpus.version,
    total: r.total,
    items: r.items,
    docs: r.docs,
    hits: r.hits,
    took: Date.now() - started,
  }
}
