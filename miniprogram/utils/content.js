const config = require('../config')
const cloud = require('./cloud')

/**
 * 内容分片服务。
 *
 * 数据分层（与 build/parse.py 的产物一一对应）：
 *   essentials.js     主包内置（**JS 模块，不是 JSON** —— 小程序 require 不了 JSON），
 *                     安装即有，首屏与降级都靠它
 *   book/NN.json      34 个节分片，点开该节时下载
 *   docs/*.json       长文
 *   docs/verify/*.json 核实记录
 *   search/corpus.json 只给服务端，**不下发客户端**
 *
 * 正文一律落在 wx.env.USER_DATA_PATH 的文件系统里，不用 setStorage
 * （单 key 约 1 MB，装不下分片）。
 * 缓存按版本号分目录，所以上游更新后旧版仍在，用户读着的页面不会突然变样。
 */

const FS = wx.getFileSystemManager()
const ROOT = `${wx.env.USER_DATA_PATH}/${config.LOCAL_ROOT}`
const mem = Object.create(null)

const CONCURRENCY = 4
/** 单片下载失败时的重试次数（183 片里只要一片抖一下就整体中断，代价太大） */
const SHARD_ATTEMPTS = 3

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function globalData() {
  const app = getApp()
  return (app && app.globalData) || {}
}

function version() {
  return globalData().version || ''
}

function manifest() {
  return globalData().manifest || null
}

/** 可分发给客户端的分片（排除服务端专用的检索语料） */
function clientShards() {
  const m = manifest()
  const list = (m && m.shards) || []
  return list.filter((s) => s.kind !== 'corpus')
}

function shardPath(kind, key) {
  if (kind === 'book') return `book/${String(key).padStart(2, '0')}.json`
  if (kind === 'doc' || kind === 'refsmap') return `docs/${key}.json`
  if (kind === 'verify') return `docs/verify/${key}.json`
  return key
}

/* ---------------------------------------------------------------- 本地文件 */

function ensureDir(dir) {
  try {
    FS.accessSync(dir)
  } catch (e) {
    try {
      FS.mkdirSync(dir, true)
    } catch (e2) {
      /* 并发创建时可能已被别人建好 */
    }
  }
}

function fileFor(rel, ver) {
  const v = ver || version() || 'unknown'
  return `${ROOT}/${v}/${rel.replace(/\//g, '__')}`
}

function readLocal(rel, ver) {
  try {
    const txt = FS.readFileSync(fileFor(rel, ver), 'utf8')
    return JSON.parse(txt)
  } catch (e) {
    return null
  }
}

function writeLocal(rel, obj, ver) {
  const p = fileFor(rel, ver)
  ensureDir(p.slice(0, p.lastIndexOf('/')))
  try {
    FS.writeFileSync(p, JSON.stringify(obj), 'utf8')
    return true
  } catch (e) {
    return false
  }
}

function hasLocal(rel, ver) {
  try {
    FS.accessSync(fileFor(rel, ver))
    return true
  } catch (e) {
    return false
  }
}

/* ---------------------------------------------------------------- 加载 */

/**
 * 从云存储取分片。
 *
 * 分片的 fileID 由 syncIngest 在入云时写进 manifest，所以这里不用再问一次
 * 「第 N 版第 X 个分片的 fileID 是什么」——180 个分片就省了 4 次批量往返
 * 和整整一个云函数。
 * 用 wx.cloud.downloadFile 而不是 wx.downloadFile：前者走云开发通道，
 * 不受 request/downloadFile 合法域名白名单限制（GitHub 系域名进不了白名单）。
 */
async function fetchFromCloud(rels, onEach) {
  const m = manifest()
  const byPath = {}
  ;((m && m.shards) || []).forEach((s) => {
    byPath[s.path] = s
  })

  const queue = rels.filter((r) => byPath[r] && byPath[r].fileID)
  const result = {}
  let cursor = 0

  async function worker() {
    while (cursor < queue.length) {
      const rel = queue[cursor++]
      const shard = byPath[rel]
      // 单片重试：183 个分片里任何一片网络抖一下都会让 Promise.all 整体 reject，
      // 没有重试的话「下载全书」几乎必然被一次抖动打断
      let lastErr = null
      for (let attempt = 1; attempt <= SHARD_ATTEMPTS; attempt++) {
        try {
          const tmp = await cloud.download(shard.fileID)
          const obj = JSON.parse(FS.readFileSync(tmp, 'utf8'))
          writeLocal(rel, obj)
          result[rel] = obj
          if (typeof onEach === 'function') onEach(rel, shard)
          lastErr = null
          break
        } catch (e) {
          lastErr = e
          if (attempt < SHARD_ATTEMPTS) await sleep(attempt * 400)
        }
      }
      if (lastErr) {
        // 错误必须带上「是哪一片、原始原因」，否则 catch 到的人只能看到一句
        // 「下载中断」，完全无法定位（已经真实发生过）
        const raw = (lastErr && (lastErr.errMsg || lastErr.message)) || String(lastErr)
        const err = new Error(`${rel}: ${raw}`)
        err.code = 'SHARD_FAIL'
        err.shard = rel
        throw err
      }
    }
  }

  const workers = []
  for (let i = 0; i < Math.min(CONCURRENCY, queue.length); i++) workers.push(worker())
  await Promise.all(workers)
  return result
}

/**
 * 取一个分片：内存 → 本地文件 → 云端。
 * 断网且本地没有时会抛 OFFLINE，调用方据此给出「未缓存」提示。
 */
async function load(rel, opts) {
  const force = opts && opts.force
  const ver = version()
  const key = `${ver}|${rel}`

  if (!force && mem[key]) return mem[key]

  const local = readLocal(rel, ver)
  if (local) {
    mem[key] = local
    return local
  }

  if (!globalData().cloudReady) {
    const err = new Error('OFFLINE')
    err.code = 'OFFLINE'
    throw err
  }

  const res = await fetchFromCloud([rel])
  const obj = res[rel]
  if (!obj) {
    const err = new Error('NOT_FOUND')
    err.code = 'NOT_FOUND'
    throw err
  }
  mem[key] = obj
  return obj
}

/* 分片路径规则与 build/parse.py 的 dump() 完全对应：文件名一律用 sid */
const loadSection = (sec) => load(shardPath('book', sec))
const loadDoc = (sid) => load(shardPath('doc', sid))
const loadVerify = (sid) => load(shardPath('verify', sid))
const loadRefsMap = (sid) => load(shardPath('refsmap', sid))

/** 从 essentials.docs 里挑出「引用对照」那一篇 */
function refsMapEntry() {
  const app = getApp()
  const docs = (app && app.globalData.essentials && app.globalData.essentials.docs) || []
  for (const d of docs) if (d.kind === 'refsmap') return d
  return null
}

/** 长文（不含引用对照） */
function longDocs() {
  const app = getApp()
  const docs = (app && app.globalData.essentials && app.globalData.essentials.docs) || []
  return docs.filter((d) => d.kind === 'doc')
}

function secFromSid(sid) {
  if (!sid || sid[0] !== 's') return null
  const n = parseInt(sid.slice(1, 3), 10)
  return isNaN(n) ? null : n
}

/**
 * 定位一条建议：优先按 sid（稳定主键），退化为「节号 + 条号」。
 * 用 sid 时不必信条号，所以上游删条目造成的条号漂移不影响这里。
 */
async function resolveItem(params) {
  const sid = params && params.sid
  let sec = params && params.sec ? parseInt(params.sec, 10) : null
  const num = params && params.num ? parseInt(params.num, 10) : null
  if (!sec && sid) sec = secFromSid(sid)
  if (!sec) return { shard: null, item: null, error: 'BAD_PARAM' }

  const shard = await loadSection(sec)
  let item = null
  if (sid) item = (shard.items || []).find((x) => x.sid === sid) || null
  if (!item && num) item = (shard.items || [])[num - 1] || null
  if (!item && !num && !sid) item = (shard.items || [])[0] || null
  return { shard, item, error: item ? null : 'NOT_FOUND' }
}

/* ---------------------------------------------------------------- 下载全书 */

/**
 * 下载全书：把所有客户端分片落到本地，之后完全离线可读。
 * 中断可续：已存在的分片会跳过。
 *
 * 失败分三类（err.code），调用方据此给出不同提示，别一律报「下载中断」：
 *   NO_MANIFEST  云端还没有内容清单 —— 首次同步未完成（manifest/current 没翻转）
 *   SYNCING      清单在、但部分分片还没有云存储 fileID —— 同步尚未写完
 *   SHARD_FAIL   某一片重试 3 次仍然失败 —— message 里带片名与原始 errMsg
 */
async function downloadAll(onProgress) {
  const shards = clientShards()
  if (!shards.length) {
    const err = new Error('云端还没有内容清单（首次同步未完成）')
    err.code = 'NO_MANIFEST'
    throw err
  }
  // 缺 fileID 的分片会在 fetchFromCloud 里被静默跳过 —— 不拦的话会「假装下完」，
  // 用户以为全书已离线，之后读到缺的节才发现是空的
  const noID = shards.filter((s) => !s.fileID)
  if (noID.length) {
    const err = new Error(`清单里 ${noID.length}/${shards.length} 个分片还没有云存储 fileID（同步未完成）`)
    err.code = 'SYNCING'
    err.missing = noID.length
    throw err
  }

  const todo = shards.filter((s) => !hasLocal(s.path))
  const totalBytes = shards.reduce((n, s) => n + (s.size || 0), 0)
  let doneBytes = totalBytes - todo.reduce((n, s) => n + (s.size || 0), 0)
  let doneCount = shards.length - todo.length

  report()

  function report() {
    if (typeof onProgress === 'function') {
      onProgress({
        done: doneCount,
        total: shards.length,
        bytes: doneBytes,
        totalBytes,
        percent: shards.length ? Math.round((doneCount / shards.length) * 100) : 100,
      })
    }
  }

  const paths = todo.map((s) => s.path)
  let lastReport = 0

  await fetchFromCloud(paths, (rel, shard) => {
    doneCount += 1
    doneBytes += shard.size || 0
    // 每完成 1 个就报一次会让进度条抖，按 8 个或全部完成时报
    const now = Date.now()
    if (doneCount % 8 === 0 || doneCount >= shards.length || now - lastReport > 400) {
      lastReport = now
      report()
    }
  })
  report()

  return { total: shards.length, bytes: doneBytes, totalBytes }
}

/* ---------------------------------------------------------------- 维护 */

/** 当前版本的本地占用与完成度 */
function localStats() {
  const shards = clientShards()
  const ver = version()
  let files = 0
  let bytes = 0
  for (const s of shards) {
    if (hasLocal(s.path, ver)) {
      files += 1
      bytes += s.size || 0
    }
  }
  return {
    version: ver,
    files,
    total: shards.length,
    bytes,
    totalBytes: shards.reduce((n, s) => n + (s.size || 0), 0),
    complete: shards.length > 0 && files >= shards.length,
  }
}

/** 清掉除当前版本以外的旧版本缓存 */
function pruneOld() {
  const cur = version()
  let removed = 0
  try {
    const dirs = FS.readdirSync(ROOT)
    for (const d of dirs) {
      if (d === cur) continue
      try {
        FS.rmdirSync(`${ROOT}/${d}`, true)
        removed += 1
      } catch (e) {
        /* 单个目录删不掉不影响其它 */
      }
    }
  } catch (e) {
    /* ROOT 还不存在 */
  }
  return removed
}

/** 清空全部本地内容缓存 */
function clearAll() {
  try {
    FS.rmdirSync(ROOT, true)
  } catch (e) {
    /* 本来就没有 */
  }
  Object.keys(mem).forEach((k) => delete mem[k])
}

module.exports = {
  ROOT,
  shardPath,
  clientShards,
  load,
  loadSection,
  loadDoc,
  loadVerify,
  loadRefsMap,
  refsMapEntry,
  longDocs,
  secFromSid,
  resolveItem,
  downloadAll,
  localStats,
  hasLocal,
  pruneOld,
  clearAll,
  readLocal,
  writeLocal,
}
