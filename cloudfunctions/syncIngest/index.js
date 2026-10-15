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
 * 体检
 *   传 `{"action":"ping"}` 会立刻回 `{"ok":true,"pong":true,...}`，不碰网络也不碰数据库。
 *   部署完 / 排错时先跑这个：能回 pong 就说明「函数被调起」这一层是通的。
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
 *   * **分片断点续传 + 并发**。180+ 个分片一次跑不完 60 秒，所以每次调用只干到
 *     时间预算用完，把进度写进 `sync-<version>` 文档（**每 5 片落一次库**），
 *     返回 remaining，由调用方（Actions 或定时器）反复调到 remaining === 0。
 *     并发 4 路，否则一轮只能搬 40 多个、要 5 轮以上才追平。
 *   * **先写暂存、后翻指针**。只有全部就位才更新 `manifest/current`，
 *     中途失败时线上版本完全不受影响。
 *   * **抓 manifest 带小重试**。云出口到资产 CDN 的连通性是**间歇性**的，而抓 manifest
 *     是整轮的**第一步** —— 一次抖动不该白费整轮（对定时器 = 白等一个 10 分钟周期）。
 *     故单次上限收紧到 6 秒、最多试 3 次，**余量不足则提前放弃**（绝不越过 deadline）。
 *     只重试**瞬时**错（超时 / 连接类 / 5xx / 429），404 这类立刻失败、不白等。
 *   * **partial 会被重试**。若有个别分片始终失败，仍然翻转（避免永远同步不上），
 *     但把 syncStatus 标成 partial；下一次调用会重新尝试这些分片，
 *     因为「跳过」的条件是 syncStatus === 'ok'。
 *
 * 环境变量（云函数配置里设）
 *   SOURCE_REPO        构建产物所在仓库（Release 的宿主），形如 `yourname/htb-app`
 *   RELEASE_TAG        Release 标签，默认 content-latest
 *   BUDGET_MS          单次执行的时间预算，默认 40000。**不要设得比 45000 更大** ——
 *                      平台硬超时是 60 秒，留 6 秒给写进度；设大了也会被自动压回去
 *   FUNCTION_TIMEOUT_MS 平台给这个函数的硬超时（默认 60000）。只有改了云函数超时时间才需要动它
 *   SYNC_TOKEN         可选。设了之后，**公网 HTTP 调用**必须带 token 才能触发（防滥用）
 *
 * ⚠️ 部署时必须把云函数超时时间从默认的 3 秒改成 60 秒，
 *    否则单次调用连一个分片都搬不完就会被平台掐断（表现为 500 / 超时，无日志）。
 * ⚠️ 反过来，**干活时间必须留白**：被平台硬杀（`Invoking task timed out after 60 seconds`，
 *    statusCode 433）时这一轮的进度**一点都没写进库**，下一轮从零开始 —— 症状就是
 *    「反复超时、remaining 永远不降」。所以：并发搬 + 每 5 片落一次库 + 动态收紧请求超时。
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

// 平台给这个函数的硬超时（云函数配置里那个「超时时间」，本项目要求设成 60 秒）。
// 干活的截止时刻绝不能靠近它 —— 必须留出 RESERVE_MS 给「写进度 + 返回」，
// 因为**被平台硬杀时这一轮的进度就白干了**（进度是断点续传的唯一依据）。
const HARD_TIMEOUT_MS = Number(process.env.FUNCTION_TIMEOUT_MS || 60000)
const RESERVE_MS = 6000
// 单个 HTTP 请求最长等多久。原来写死 30 秒 —— 比整个预算的一半还长，
// 一个卡住的分片就能把预算吃穿，把函数直接拖到硬超时
// （症状就是 `Invoking task timed out after 60 seconds` / statusCode 433）。
const PER_REQUEST_MS = 12000
const CONCURRENCY = 4 // 单线程搬 183 个分片要 5 轮以上，并发 4 路大约 2 轮就能追平
const CHECKPOINT_EVERY = 5 // 每搬完几个分片就把进度落库，被硬杀时最多丢这几片

// 抓 manifest 的小重试。
// 为什么要有：该云出口到 GitHub 资产 CDN 的连通性是**间歇性**的 —— 实测同一环境同
// 一晚「通 / 断交替」（14:04 超时 → 22:41 四点全通 → 23:11 成功 → 23:14 又超时）。
// 而抓 manifest 是整轮的**第一步**：不重试的话，一次抖动就白费整轮；对定时触发器
// 尤其贵 —— 等于白等一个 10 分钟周期。重试成本极低（就多一次 ~28KB 的 GET）。
// 单次上限（6000）比分片（12000）小得多：健康时 manifest 只要 ~1.4 秒，
// 6 秒还没完基本就是连接卡死了，早放弃早重试，别把上限耗在一次垂死连接上。
const MANIFEST_ATTEMPT_MS = Number(process.env.MANIFEST_ATTEMPT_MS || 6000)
const MANIFEST_ATTEMPTS = Math.max(1, Number(process.env.MANIFEST_ATTEMPTS || 3))
const MANIFEST_RETRY_GAP_MS = 300
// fetchBuffer 里给单次请求留的最小值，重试前用它判断「还有没有余量再试一次」
const MIN_REQUEST_MS = 1500

/* ---------------------------------------------------------------- HTTP */

/**
 * 下载一个 URL。
 * deadlineTs 是「干活的截止时刻」，每次请求的超时都按**离截止时刻还剩多少**动态收紧：
 * 快用完了就只能等 1.5 秒，离得远最多等 PER_REQUEST_MS。
 * 这样任何一个卡住的请求都不可能把函数拖过 deadline。
 * 另外加了硬定时器 —— `req.setTimeout` 只在**空闲**时触发，
 * 一个慢慢滴数据、始终不空闲的连接照样能耗死预算，所以必须再加一层总时长兜底。
 * perReqMs 可选：覆盖单次上限（默认 PER_REQUEST_MS）。抓 manifest 时传更小的值，
 * 因为它小（~28KB）且健康时只要 1.4 秒，卡住就该早点放弃、好让重试有机会。
 */
function fetchBuffer(url, deadlineTs, redirects, perReqMs) {
  const hop = redirects || 0
  const cap = Number(perReqMs) > 0 ? Number(perReqMs) : PER_REQUEST_MS
  return new Promise((resolve, reject) => {
    if (hop > MAX_REDIRECT) {
      reject(new Error('TOO_MANY_REDIRECTS'))
      return
    }
    const left = Math.max(MIN_REQUEST_MS, Math.min(cap, (deadlineTs || Date.now() + cap) - Date.now()))
    const mod = url.indexOf('https:') === 0 ? https : http
    const req = mod.get(
      url,
      { headers: { 'User-Agent': 'htb-sync-ingest', Accept: '*/*' } },
      (res) => {
        if ([301, 302, 303, 307, 308].indexOf(res.statusCode) >= 0 && res.headers.location) {
          res.resume()
          clearTimeout(hardTimer)
          resolve(fetchBuffer(new URL(res.headers.location, url).toString(), deadlineTs, hop + 1, cap))
          return
        }
        if (res.statusCode !== 200) {
          res.resume()
          clearTimeout(hardTimer)
          reject(new Error('HTTP_' + res.statusCode + ' ' + url))
          return
        }
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          clearTimeout(hardTimer)
          resolve(Buffer.concat(chunks))
        })
      }
    )
    const hardTimer = setTimeout(() => req.destroy(new Error('HTTP_TIMEOUT')), left)
    req.on('error', (e) => {
      clearTimeout(hardTimer)
      reject(e)
    })
    req.setTimeout(left, () => req.destroy(new Error('HTTP_TIMEOUT')))
  })
}

/** 给一个已经发出去的 Promise 套一层超时。超时后原 Promise 继续跑完会被忽略，但要挂个 catch 免得变成未处理的 rejection。 */
function withTimeout(promise, ms, code) {
  const p = Promise.resolve(promise)
  p.catch(() => {})
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(code || 'TIMEOUT')), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      }
    )
  })
}

/** 等待 ms 毫秒（重试用） */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, Math.max(0, ms)))
}

/**
 * 这个下载错误值得重试吗？
 * 只重试**瞬时**故障：超时 / 连接类错误 / 5xx / 429。
 * 明确重试也没用的（404 这类 4xx、重定向过多、结构不对）直接放行，免得白等一轮。
 */
function isTransient(err) {
  const code = String((err && err.code) || '')
  if (/^(ETIMEDOUT|ESOCKETTIMEDOUT|ECONNRESET|ECONNREFUSED|EPIPE|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH)$/.test(code)) {
    return true
  }
  const msg = String((err && err.message) || err || '')
  if (/HTTP_TIMEOUT|socket hang up|ETIMEDOUT|ECONNRESET|ENOTFOUND|EAI_AGAIN/i.test(msg)) return true
  const m = /^HTTP_(\d{3})\b/.exec(msg)
  if (m) {
    const status = Number(m[1])
    return status === 408 || status === 429 || status >= 500
  }
  return false
}

/**
 * 抓远端 manifest，带小重试（为什么要有：见 MANIFEST_* 常量处的说明）。
 * 只重试瞬时错；并且**永不越过 deadline** —— 余量不够就直接放弃，宁可这一轮报
 * FETCH_MANIFEST，也别把整个预算耗在重试上（下一轮会从头再来，没有副作用）。
 * 失败时抛**最后一次的原始错误**，保持既有的 `FETCH_MANIFEST` + `HTTP_TIMEOUT` 返回形态不变。
 */
async function fetchManifest(deadlineTs) {
  let lastErr
  for (let attempt = 1; attempt <= MANIFEST_ATTEMPTS; attempt += 1) {
    try {
      return await fetchBuffer(assetUrl('manifest.json'), deadlineTs, 0, MANIFEST_ATTEMPT_MS)
    } catch (e) {
      lastErr = e
      const retriable = isTransient(e)
      const left = deadlineTs - Date.now()
      if (!retriable || attempt >= MANIFEST_ATTEMPTS || left < MIN_REQUEST_MS + MANIFEST_RETRY_GAP_MS) {
        if (!retriable) console.log('[sync] manifest 请求失败且不可重试：' + (e && e.message))
        break
      }
      console.log(`[sync] manifest 第 ${attempt} 次失败（${e && e.message}），余 ${left}ms，重试`)
      await sleep(Math.min(MANIFEST_RETRY_GAP_MS, Math.max(0, left - MIN_REQUEST_MS)))
    }
  }
  throw lastErr
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
  // 体检：不碰网络、不碰数据库，直接回一个 pong。
  // 用途是把两类完全不同的故障分开 ——
  //   * 连 pong 都拿不到 → 函数根本没被调起（环境 / 部署 / 控制台的问题）
  //   * 拿到 pong 但同步报错 → 函数是好的，问题在同步逻辑或配置
  // 从「云端测试」和从小程序端调用都可以用它，没有副作用。
  if (ev.action === 'ping') {
    return {
      ok: true,
      pong: true,
      // 函数**自己认为**它在哪个环境 —— 和配置里的 CLOUD_ENV 对不上就是环境串了
      envId: process.env.TCB_ENV || process.env.SCF_NAMESPACE || '',
      sourceRepo: SOURCE_REPO || null,
      budgetMs: BUDGET_MS,
      tokenRequired: Boolean(SYNC_TOKEN),
      now: new Date().toISOString(),
    }
  }

  // 网络体检：只发**小的 GET**，不下大文件、不碰数据库。**专门用来把「函数被调起」之后的
  // 下一层故障问清楚 ** —— 现象是「日志里明明有执行记录，但同步报 FETCH_MANIFEST / HTTP_TIMEOUT」：
  //   * 某个域名 `reachable:false` 且 error 是 HTTP_TIMEOUT / ENOTFOUND / ECONNRESET
  //     ⇒ 云函数**出站被挡**。国内云出口连不上 GitHub 资产 CDN
  //     （`release-assets.githubusercontent.com`）是常见诱因，不是代码问题。
  //   * 全部都 `reachable:true`（哪怕 HTTP_403/404 —— TCP+TLS+HTTP 已经走通，只是这个 URL
  //     本身不给内容）⇒ 网络没问题，同步失败另有原因（例如单请求超时太短）。
  // 和 ping 一样是只读的，随时可以从控制台或小程序端调用。
  if (ev.action === 'netcheck') {
    const per = Math.max(1500, Math.min(20000, Number(ev.perProbeMs) || 8000))
    const probes = [
      ['baidu', 'https://www.baidu.com/'], // 对照组：连它都不通说明整个出站都断了
      ['github', SOURCE_REPO ? assetUrl('manifest.json') : 'https://github.com/'],
      ['release-assets', 'https://release-assets.githubusercontent.com/'],
      ['api-github', 'https://api.github.com/'],
    ]
    const results = []
    for (let i = 0; i < probes.length; i += 1) {
      const name = probes[i][0]
      const url = probes[i][1]
      const t0 = Date.now()
      try {
        const buf = await fetchBuffer(url, Date.now() + per)
        results.push({ name, url, reachable: true, bytes: buf.length, ms: Date.now() - t0 })
      } catch (e) {
        const msg = String((e && e.message) || e)
        // HTTP_4xx/5xx 说明网络已通，只是这个 URL 本身不可直接取 —— 仍算「可达」
        const reachable = /^HTTP_\d+/.test(msg)
        results.push({ name, url, reachable, error: msg, ms: Date.now() - t0 })
      }
    }
    return { ok: true, netcheck: true, perProbeMs: per, results }
  }

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
  // 真正的截止时刻：既听调用方的预算，也绝不允许逼近平台硬超时。
  // 预算写超了（比如 BUDGET_MS=60000）也不会把函数拖死 —— 这里会被压到 60-6=54 秒。
  const deadline = adapt.planDeadline(started, budget, HARD_TIMEOUT_MS, RESERVE_MS)

  // 1) 拉远端 manifest（发布在上游 Release 里的公开资产，不需要任何密钥）
  //    走 fetchManifest 带小重试 —— 云出口到资产 CDN 的连通性是间歇性的，
  //    而这是整轮的第一步，一次抖动不该白费一整轮（对定时器 = 白等 10 分钟）。
  let remote
  try {
    const buf = await fetchManifest(deadline)
    remote = JSON.parse(buf.toString('utf8'))
  } catch (e) {
    return { ok: false, error: 'FETCH_MANIFEST', message: String(e.message || e), elapsedMs: Date.now() - started }
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
  let sinceCheckpoint = 0

  // 4) 在截止时刻前尽量多搬。
  //    * **并发 4 路**：单线程搬 183 个分片要 5 轮以上，并发后约 2 轮追平。
  //    * 每个请求/每次上传的超时都按「离截止时刻还剩多少」收紧，
  //      所以卡住的兄弟不可能把函数拖过 deadline。
  //    * **每 CHECKPOINT_EVERY 个就落一次库**：万一还是被平台硬杀，
  //      这一轮已搬完的不会白干（进度是断点续传的唯一依据，
  //      原来只在整轮结束后写一次，被杀就整轮归零 ⇒ 永远超时、永远没进度）。
  let cursor = 0
  async function worker() {
    while (cursor < pending.length && Date.now() < deadline) {
      const shard = pending[cursor]
      cursor += 1
      try {
        const buf = await fetchBuffer(assetUrl(assetName(shard.path)), deadline)
        if (shard.sha256 && sha256(buf) !== shard.sha256) throw new Error('SHA256_MISMATCH')
        const up = await withTimeout(
          cloud.uploadFile({
            cloudPath: `content/${remote.version}/${assetName(shard.path)}`,
            fileContent: buf,
          }),
          Math.max(3000, Math.min(PER_REQUEST_MS, deadline - Date.now())),
          'UPLOAD_TIMEOUT'
        )
        state.fileIDs[shard.path] = up.fileID
        state.done.push(shard.path)
        uploaded += 1
      } catch (e) {
        state.attempts[shard.path] = (state.attempts[shard.path] || 0) + 1
        if (!state.failed.includes(shard.path)) state.failed.push(shard.path)
        state.lastError = `${shard.path}: ${String(e.message || e)}`
      }
      sinceCheckpoint += 1
      if (sinceCheckpoint >= CHECKPOINT_EVERY) {
        sinceCheckpoint = 0
        await putState(state).catch(() => {})
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, worker))

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
      elapsedMs: Date.now() - started,
      lastError: state.lastError || '',
      hint: '重复调用本函数直到 remaining 为 0',
    }
  }

  // 4.5) 一片都没搬成（最典型的成因：云函数所在地域出网到 GitHub 的资产 CDN 不通，
  //      每个分片都 HTTP_TIMEOUT）。这时**绝不能翻转** ——
  //      翻了会把线上目录换成一份空壳 manifest，还不如保持旧版本可用。
  //      直接把 lastError 回给调用方，用来判断是不是网络问题。
  if (!state.done.length) {
    return {
      ok: false,
      error: 'ALL_SHARDS_FAILED',
      version: remote.version,
      tried: state.failed.length,
      elapsedMs: Date.now() - started,
      lastError: state.lastError || '',
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
    elapsedMs: Date.now() - started,
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
