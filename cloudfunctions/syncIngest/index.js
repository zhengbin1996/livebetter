/**
 * 内容入云：把 GitHub Release 上的版本化分片搬进云存储，并原子翻转 manifest。
 *
 * 为什么要有这个中继层
 *   正式版小程序的 wx.request 合法域名必须是**已 ICP 备案**的域名，
 *   raw.githubusercontent.com / github.com 都配不进白名单，所以小程序不能直连 GitHub。
 *   云函数出站不受这个限制，是唯一既省事又不用自购备案域名的路径。
 *
 * 触发方式
 *   1) 定时触发器（**默认就有**，config.json 里声明，每 10 分钟一次）。
 *      已同步过同一 commit 就直接返回 skipped —— 绝大多数轮次只是查一下，
 *      有新版本时才按时间预算分轮搬，几轮内追平。
 *      ⇒ 所以**不配 HTTP 访问服务也能全自动同步**，最多晚 10 分钟发现新版本。
 *   2) HTTP 访问服务（**可选**）：GitHub Actions 构建完立即调一次，分钟级入云。
 *      配了的话单次跑不完就反复调，直到 remaining 为 0。
 *   两种触发方式传进来的 event 结构**完全不同**，入口处做归一化（见「入口适配」）。
 *
 * ⚠️ 定时触发器的 cron 时区是 **UTC+8（北京时间）**，而函数运行时的 new Date()
 *    是 UTC —— 两者相反，很容易搞混（见官方文档「触发器规则的时区为 UTC+8」）。
 * ⚠️ cron 必须是 **7 段**（秒 分 时 日 月 周 年），少一段不会在本地报错，
 *    但部署后触发器配置不合法、函数会卡在中间态，所有调用返回 `ret:-3 system error`。
 *    `build/check_miniprogram.py` 的第 7 项会挡住这种写法。
 *
 * 关键设计
 *   * 解析逻辑**不在这里** —— markdown → JSON 由 Actions 端的 build/parse.py 负责，
 *     那边有单测、可回滚、不受 60 秒超时限制。这里只做「下载 → 校验 → 上传 → 翻转」。
 *   * **分片逐个断点续传**。180+ 个分片一次跑不完 60 秒，所以每次调用只干到
 *     时间预算用完，把进度写进 `sync-<version>` 文档，返回 remaining，
 *     由调用方（Actions 或定时器）反复调到 remaining === 0。
 *   * **先写暂存、后翻指针**。只有全部就位才更新 `manifest/current`，
 *     中途失败时线上版本完全不受影响。
 *   * **partial 会被重试**。若有个别分片始终失败，仍然翻转（避免永远同步不上），
 *     但把 syncStatus 标成 partial；下一次调用会重新尝试这些分片，
 *     因为「跳过」的条件是 syncStatus === 'ok'。
 *
 * 环境变量（云函数配置里设）
 *   SOURCE_REPO  构建产物所在仓库（Release 的宿主），形如 `yourname/htb-app`
 *   RELEASE_TAG  Release 标签，默认 content-latest
 *   BUDGET_MS    单次执行时间预算，默认 40000（**必须小于云函数超时**，见下）
 *   SYNC_TOKEN   可选。设了之后，**公网 HTTP 调用**必须带 token 才能触发（防滥用）
 *
 * ⚠️ 部署时必须把云函数超时时间从默认的 3 秒改成 60 秒，
 *    否则单次调用连一个分片都搬不完就会被平台掐断（表现为 500 / 超时，无日志）。
 */
const cloud = require('wx-server-sdk')
const crypto = require('crypto')
const https = require('https')
const http = require('http')
const adapt = require('./adapt')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const SOURCE_REPO = process.env.SOURCE_REPO || ''
const RELEASE_TAG = process.env.RELEASE_TAG || 'content-latest'
const BUDGET_MS = Number(process.env.BUDGET_MS || 40000)
const SYNC_TOKEN = process.env.SYNC_TOKEN || ''
const MAX_REDIRECT = 5
const MAX_ATTEMPTS = 5 // 单个分片最多重试几次，免得坏资产把人拖死

/* ---------------------------------------------------------------- HTTP */

function fetchBuffer(url, redirects) {
  const hop = redirects || 0
  return new Promise((resolve, reject) => {
    if (hop > MAX_REDIRECT) {
      reject(new Error('TOO_MANY_REDIRECTS'))
      return
    }
    const mod = url.indexOf('https:') === 0 ? https : http
    const req = mod.get(
      url,
      { headers: { 'User-Agent': 'htb-sync-ingest', Accept: '*/*' } },
      (res) => {
        if ([301, 302, 303, 307, 308].indexOf(res.statusCode) >= 0 && res.headers.location) {
          res.resume()
          resolve(fetchBuffer(new URL(res.headers.location, url).toString(), hop + 1))
          return
        }
        if (res.statusCode !== 200) {
          res.resume()
          reject(new Error('HTTP_' + res.statusCode + ' ' + url))
          return
        }
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => resolve(Buffer.concat(chunks)))
      }
    )
    req.on('error', reject)
    req.setTimeout(30000, () => req.destroy(new Error('HTTP_TIMEOUT')))
  })
}

/** Release 资产名：把路径里的斜杠换成双下划线，book/01.json → book__01.json */
function assetName(relPath) {
  return relPath.replace(/\//g, '__')
}

function assetUrl(name) {
  return `https://github.com/${SOURCE_REPO}/releases/download/${RELEASE_TAG}/${name}`
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex')
}

/* ---------------------------------------------------------------- 入口 */

exports.main = async (event) => {
  const raw = event || {}
  const viaHttp = adapt.isHttpEvent(raw)
  const result = await run(adapt.unwrapEvent(raw), viaHttp)
  return viaHttp ? adapt.httpReply(result) : result
}

async function run(ev, viaHttp) {
  if (!SOURCE_REPO) {
    return { ok: false, error: 'NO_SOURCE_REPO', message: '请在云函数环境变量里设置 SOURCE_REPO' }
  }
  // 令牌**只拦公网 HTTP 调用**。定时触发器由平台内部调起，event 里根本没有 token，
  // 一并拦的话每日兜底会直接 BAD_TOKEN 失效。
  if (viaHttp && SYNC_TOKEN && ev.token !== SYNC_TOKEN) {
    return { ok: false, error: 'BAD_TOKEN' }
  }

  const started = Date.now()
  const budget = adapt.clampBudget(ev.budgetMs, BUDGET_MS)

  // 1) 拉远端 manifest（发布在上游 Release 里的公开资产，不需要任何密钥）
  let remote
  try {
    const buf = await fetchBuffer(assetUrl('manifest.json'))
    remote = JSON.parse(buf.toString('utf8'))
  } catch (e) {
    return { ok: false, error: 'FETCH_MANIFEST', message: String(e.message || e) }
  }
  if (!remote || !remote.version || !Array.isArray(remote.shards)) {
    return { ok: false, error: 'BAD_MANIFEST' }
  }

  // 2) 与线上比对。版本权威键是完整 commit sha，不是日期 —— 上游一天提交多次。
  //    只有线上既同 commit 且同步完整时才跳过；partial 的要在下次重试。
  const cur = await readCurrent()
  if (!ev.force && !ev.continue && cur && cur.commit === remote.commit && cur.syncStatus !== 'partial') {
    return { ok: true, skipped: true, version: remote.version, reason: '已是同一 commit' }
  }

  // 3) 取或建进度文档
  const stateId = 'sync-' + remote.version
  let state = await readState(stateId)
  if (!state || ev.restart || state.commit !== remote.commit) {
    state = {
      _id: stateId,
      version: remote.version,
      commit: remote.commit,
      done: [],
      fileIDs: {},
      failed: [],
      attempts: {},
      startedAt: new Date().toISOString(),
    }
    await putState(state)
  }
  state.attempts = state.attempts || {}
  state.failed = state.failed || []

  // 上一轮失败的在这一轮重新排队；超过 MAX_ATTEMPTS 的判定放弃，不再拖时间
  state.failed = state.failed.filter((p) => (state.attempts[p] || 0) >= MAX_ATTEMPTS)

  const pending = remote.shards.filter(
    (s) => state.done.indexOf(s.path) < 0 && state.failed.indexOf(s.path) < 0
  )
  let uploaded = 0

  // 4) 在时间预算内逐个搬
  for (const shard of pending) {
    if (Date.now() - started > budget) break

    try {
      const buf = await fetchBuffer(assetUrl(assetName(shard.path)))
      if (shard.sha256 && sha256(buf) !== shard.sha256) throw new Error('SHA256_MISMATCH')
      const up = await cloud.uploadFile({
        cloudPath: `content/${remote.version}/${assetName(shard.path)}`,
        fileContent: buf,
      })
      state.fileIDs[shard.path] = up.fileID
      state.done.push(shard.path)
      uploaded += 1
    } catch (e) {
      state.attempts[shard.path] = (state.attempts[shard.path] || 0) + 1
      if (!state.failed.includes(shard.path)) state.failed.push(shard.path)
      state.lastError = `${shard.path}: ${String(e.message || e)}`
    }
  }

  await putState(state)

  const accounted = state.done.length + state.failed.length
  const remaining = remote.shards.length - accounted
  if (remaining > 0) {
    return {
      ok: true,
      done: false,
      version: remote.version,
      uploaded,
      uploadedTotal: state.done.length,
      failed: state.failed.length,
      remaining,
      hint: '重复调用本函数直到 remaining 为 0',
    }
  }

  // 5) 全部有着落 → 原子翻转
  const prevManifest = cur || {}
  const shards = remote.shards
    .filter((s) => state.fileIDs[s.path])
    .map((s) => Object.assign({}, s, { fileID: state.fileIDs[s.path] }))

  const next = Object.assign({}, remote, {
    shards,
    prevVersion: prevManifest.version || null,
    // 走到这里说明所有分片都已尝试并落到云存储（或已判定放弃）
    syncStatus: state.failed.length ? 'partial' : 'ok',
    failedShards: state.failed,
    lastError: state.lastError || '',
    syncedAt: new Date().toISOString(),
  })

  await db.collection('manifest').doc('current').set({ data: stripId(next) })
  // 完整同步才清进度文档；partial 留着，下一次接着补
  if (!state.failed.length) {
    await db.collection('manifest').doc(stateId).remove().catch(() => {})
  }

  return {
    ok: true,
    done: true,
    version: remote.version,
    commit: remote.commit,
    shards: shards.length,
    failed: state.failed.length,
    prevVersion: next.prevVersion,
    syncStatus: next.syncStatus,
  }
}

/* ---------------------------------------------------------------- 存储 */

async function readCurrent() {
  try {
    const r = await db.collection('manifest').doc('current').get()
    return r.data || null
  } catch (e) {
    return null
  }
}

async function readState(id) {
  try {
    const r = await db.collection('manifest').doc(id).get()
    return r.data || null
  } catch (e) {
    return null
  }
}

async function putState(state) {
  await db.collection('manifest').doc(state._id).set({ data: stripId(state) })
}

function stripId(o) {
  const c = Object.assign({}, o)
  delete c._id
  delete c._openid
  return c
}
