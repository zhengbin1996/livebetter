/**
 * syncIngest 主循环的本地自测（不需要云环境）。
 * 跑法：node build/tests/test_sync_loop.js
 *
 * 为什么要测这个
 *   真实故障：分片下载卡住（云函数出网到 GitHub 资产 CDN 不稳）时，
 *   旧实现「只在整轮循环结束后写进度 + 单个请求超时 30 秒」，
 *   会把函数一路拖到平台 60 秒硬超时 —— 平台**直接掐断进程**，
 *   于是这一轮搬完的进度一个字节都没落库，下一轮从零开始，
 *   症状是「反复超时、remaining 永远不降」。本地完全看不出来。
 *
 *   所以这里把 https 与 wx-server-sdk 都换成假的，验证三条不变量：
 *     1) 网络全通时能把 8 个分片搬完并原子翻转；
 *     2) **网络全卡死时函数仍会自己收尾返回**，用时明显小于平台硬超时
 *        （即：绝不会出现「跑满 60 秒被平台杀掉」）；
 *     3) **抓 manifest 带小重试**：瞬时抖动（连接类错）会重试并成功；404 这类
 *        不可恢复的错立刻失败、不白等；重试次数封顶，且余量不足时提前放弃
 *        —— 永不越过 deadline。
 */
const Module = require('module')
const path = require('path')
const crypto = require('crypto')

const INDEX = require.resolve(path.resolve(__dirname, '../../cloudfunctions/syncIngest/index.js'))

let failed = 0
function ok(name, cond, extra) {
  if (cond) console.log('  PASS ' + name)
  else {
    failed += 1
    console.log('  FAIL ' + name + (extra !== undefined ? '  -> ' + extra : ''))
  }
}

function sha256(s) {
  return crypto.createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex')
}

/* ------------------------------------------------ 测试用的假资产 */

const SHARDS = ['book/00.json', 'book/01.json', 'book/02.json', 'book/03.json',
  'book/04.json', 'book/05.json', 'book/06.json', 'book/07.json']

const shardBody = (p) => JSON.stringify({ p })
const MANIFEST = {
  version: 'v-test-1',
  commit: 'deadbeefdeadbeef',
  shards: SHARDS.map((p) => ({ path: p, sha256: sha256(shardBody(p)) })),
}

function bodyForUrl(url) {
  if (url.indexOf('manifest.json') >= 0) return JSON.stringify(MANIFEST)
  for (const p of SHARDS) {
    if (url.indexOf(p.replace(/\//g, '__')) >= 0) return shardBody(p)
  }
  return '{}'
}

/* ------------------------------------------------ 假的 https */

let MODE = 'fast' // fast | hang | hangShards | manifestFlaky | manifest404
let fetchCount = 0
/** manifestFlaky 模式下，还要让 manifest 失败几次（模拟瞬时抖动） */
let flakyLeft = 0
/** manifest 被请求了几次（用来断言「有没有重试」/「重试了几次」） */
let manifestFetches = 0

const fakeHttps = {
  get(url, opts, cb) {
    fetchCount += 1
    const handlers = {}
    const req = {
      on(ev, fn) {
        handlers[ev] = fn
        return req
      },
      setTimeout(ms, cb) {
        setTimeout(() => cb && cb(), ms)
        return req
      },
      // 真实现里 req.setTimeout 与我们的硬定时器最终都走 destroy
      destroy(err) {
        setImmediate(() => handlers.error && handlers.error(err))
      },
    }
    // hang         = 连 manifest 都拉不到（域名级不通）
    // hangShards   = manifest 正常、分片拉不到（最真实：清单在 github.com，
    //                资产走 objects.githubusercontent.com 这类 CDN，后者常出问题）
    // manifestFlaky= manifest 前几次瞬时失败（连接类错），之后正常
    //                —— 实测该云出口到 CDN 的连通性是间歇性的
    // manifest404  = manifest 返回 404（**不可重试**的错，重试纯属白等）
    const isManifest = String(url).indexOf('manifest.json') >= 0
    if (isManifest) manifestFetches += 1

    if (MODE === 'manifest404' && isManifest) {
      setImmediate(() => {
        const res = {
          statusCode: 404,
          headers: {},
          resume() {},
          on() {
            return res
          },
        }
        cb(res)
      })
      return req
    }
    if (MODE === 'manifestFlaky' && isManifest && flakyLeft > 0) {
      flakyLeft -= 1
      // 用「连接被重置」这种**瞬时**错误，而不是干等超时 —— 测试要快
      const err = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })
      setImmediate(() => req.destroy(err))
      return req
    }
    if (MODE === 'hang' || (MODE === 'hangShards' && !isManifest)) return req
    const body = bodyForUrl(String(url))
    setImmediate(() => {
      const res = {
        statusCode: 200,
        headers: {},
        resume() {},
        on(ev, fn) {
          if (ev === 'data') fn(Buffer.from(body, 'utf8'))
          if (ev === 'end') fn()
          return res
        },
      }
      cb(res)
    })
    return req
  },
}

/* ------------------------------------------------ 假的 wx-server-sdk */

function makeEnv() {
  const store = {}
  const stats = { set: 0, upload: 0 }
  const fakeCloud = {
    DYNAMIC_CURRENT_ENV: 'dyn-current',
    init() {},
    database() {
      return {
        collection(name) {
          return {
            doc(id) {
              const key = name + '/' + id
              return {
                async get() {
                  if (!store[key]) throw new Error('DOC_NOT_FOUND')
                  return { data: store[key] }
                },
                async set({ data }) {
                  store[key] = JSON.parse(JSON.stringify(data))
                  stats.set += 1
                },
                async remove() {
                  delete store[key]
                },
              }
            },
          }
        },
      }
    },
    async uploadFile({ cloudPath }) {
      stats.upload += 1
      return { fileID: 'cloud://' + cloudPath }
    },
  }
  return { store, stats, fakeCloud }
}

const origLoad = Module._load

function load(env, envVars) {
  for (const k of ['SOURCE_REPO', 'BUDGET_MS', 'FUNCTION_TIMEOUT_MS', 'SYNC_TOKEN', 'RELEASE_TAG',
    'MANIFEST_ATTEMPTS', 'MANIFEST_ATTEMPT_MS']) {
    delete process.env[k]
  }
  Object.assign(process.env, envVars)
  Module._load = function (request) {
    if (request === 'wx-server-sdk') return env.fakeCloud
    if (request === 'https') return fakeHttps
    return origLoad.apply(this, arguments)
  }
  delete require.cache[INDEX]
  return require(INDEX)
}

/* ------------------------------------------------ 跑 */

;(async () => {
  /* 场景 1：网络正常 —— 应搬完并翻转 */
  {
    const env = makeEnv()
    MODE = 'fast'
    const mod = load(env, { SOURCE_REPO: 'me/repo', BUDGET_MS: '40000', FUNCTION_TIMEOUT_MS: '60000' })
    const t0 = Date.now()
    const r = await mod.main({})
    const dt = Date.now() - t0
    ok('快网：8 个分片全部搬完并原子翻转', r && r.ok === true && r.done === true && r.shards === 8, JSON.stringify(r))
    ok('快网：manifest/current 已写入且 syncStatus=ok',
      !!(env.store['manifest/current'] && env.store['manifest/current'].syncStatus === 'ok'))
    ok('快网：上传次数 = 分片数', env.stats.upload === 8, env.stats.upload)
    ok('快网：进度确实落库了', env.stats.set >= 1, env.stats.set)
    ok('快网：用时很短（< 5 秒）', dt < 5000, dt + 'ms')
  }

  /* 场景 2：分片全拉不到（最真实：manifest 能拿、资产 CDN 不通）——
     必须自己收尾，绝不能被拖到平台硬超时 */
  {
    const env = makeEnv()
    MODE = 'hangShards'
    const HARD = 9000
    const BUDGET = 5000
    const mod = load(env, { SOURCE_REPO: 'me/repo', BUDGET_MS: String(BUDGET), FUNCTION_TIMEOUT_MS: String(HARD) })
    const t0 = Date.now()
    const r = await mod.main({})
    const dt = Date.now() - t0
    ok('分片卡死：函数仍然返回了结果（没被挂死）', !!r, String(r))
    ok('分片卡死：绝不翻转（线上保持旧版本）', !env.store['manifest/current'])
    ok('分片卡死：报的是 HTTP_TIMEOUT，而不是静默超时',
      String(r.lastError || '').indexOf('HTTP_TIMEOUT') >= 0, JSON.stringify(r))
    ok('分片卡死：用时 < 平台硬超时（说明能自己收尾）', dt < HARD, dt + 'ms vs ' + HARD + 'ms')
    ok('分片卡死：用时 ≈ 时间预算，不会拖满', dt <= BUDGET + 2000, dt + 'ms vs ' + BUDGET + 'ms')
    ok('分片卡死：进度文档有落库（下一轮可从断点继续）',
      Object.keys(env.store).some((k) => k.indexOf('manifest/sync-') === 0), Object.keys(env.store).join(','))
  }

  /* 场景 3：连 manifest 都拉不到 —— 也得自己收尾 */
  {
    const env = makeEnv()
    MODE = 'hang'
    const HARD = 9000
    const mod = load(env, { SOURCE_REPO: 'me/repo', BUDGET_MS: '5000', FUNCTION_TIMEOUT_MS: String(HARD) })
    const t0 = Date.now()
    const r = await mod.main({})
    const dt = Date.now() - t0
    ok('清单卡死：报 FETCH_MANIFEST 且带 HTTP_TIMEOUT',
      r && r.error === 'FETCH_MANIFEST' && String(r.message).indexOf('HTTP_TIMEOUT') >= 0, JSON.stringify(r))
    ok('清单卡死：用时 < 平台硬超时', dt < HARD, dt + 'ms vs ' + HARD + 'ms')
  }

  /* 场景 4：预算被误设成很大 —— 必须被夹回「硬超时 - 留白」 */
  {
    const env = makeEnv()
    MODE = 'hangShards'
    const HARD = 9000
    const mod = load(env, { SOURCE_REPO: 'me/repo', BUDGET_MS: '600000', FUNCTION_TIMEOUT_MS: String(HARD) })
    const t0 = Date.now()
    await mod.main({})
    const dt = Date.now() - t0
    ok('预算写超大：仍然不会撞上平台硬超时', dt < HARD, dt + 'ms vs ' + HARD + 'ms')
  }

  /* 场景 5：netcheck —— 网络体检分支的判定口径。这个分支存在的意义就是回答
     「日志说 FETCH_MANIFEST / HTTP_TIMEOUT，到底是云函数出不去，还是别的」。 */
  {
    const env = makeEnv()
    MODE = 'fast'
    const mod = load(env, { SOURCE_REPO: 'me/repo' })
    const r = await mod.main({ action: 'netcheck' })
    ok('netcheck：网络正常时 4 个探测点都 reachable',
      !!r && r.netcheck === true && r.results.length === 4 &&
      r.results.every((x) => x.reachable === true), JSON.stringify(r && r.results))
    ok('netcheck：github 探测点打的是真实资产 URL（走完整重定向链）',
      !!(r && r.results) && r.results.some((x) => x.name === 'github' && x.url.indexOf('/releases/download/') >= 0),
      JSON.stringify(r && r.results && r.results.map((x) => x.url)))
  }

  /* 场景 6：出站全断时，netcheck 必须如实报「不可达」且不能挂死 */
  {
    const env = makeEnv()
    MODE = 'hang'
    const mod = load(env, { SOURCE_REPO: 'me/repo' })
    const t0 = Date.now()
    const r = await mod.main({ action: 'netcheck', perProbeMs: 1500 })
    const dt = Date.now() - t0
    ok('netcheck：出站断时全部 reachable:false 且带 HTTP_TIMEOUT',
      !!(r && r.results) && r.results.every((x) => x.reachable === false && String(x.error).indexOf('HTTP_TIMEOUT') >= 0),
      JSON.stringify(r && r.results))
    ok('netcheck：4 个探测点总用时受 perProbeMs 约束（< 10 秒）', dt < 10000, dt + 'ms')
  }

  /* 场景 7：manifest 前两次瞬时失败、第三次成功 —— 必须重试成功并把整轮跑完。
     现实依据：该云出口到 GitHub 资产 CDN 的连通性是**间歇性**的，而抓 manifest
     是整轮的**第一步**；不重试的话一次抖动就白费整轮（对定时器 = 白等 10 分钟）。 */
  {
    const env = makeEnv()
    MODE = 'manifestFlaky'
    flakyLeft = 2
    manifestFetches = 0
    const mod = load(env, { SOURCE_REPO: 'me/repo', BUDGET_MS: '40000', FUNCTION_TIMEOUT_MS: '60000' })
    const r = await mod.main({})
    ok('manifest 抖动：重试后照常搬完并原子翻转',
      r && r.ok === true && r.done === true && r.shards === 8, JSON.stringify(r))
    ok('manifest 抖动：确实重试了（共请求 3 次）', manifestFetches === 3, manifestFetches)
  }

  /* 场景 8：manifest 返回 404（**不可重试**）—— 必须立刻失败，不许白等重试 */
  {
    const env = makeEnv()
    MODE = 'manifest404'
    manifestFetches = 0
    const mod = load(env, { SOURCE_REPO: 'me/repo', BUDGET_MS: '40000', FUNCTION_TIMEOUT_MS: '60000' })
    const t0 = Date.now()
    const r = await mod.main({})
    const dt = Date.now() - t0
    ok('manifest 404：报 FETCH_MANIFEST 且带 HTTP_404（返回形态不变）',
      r && r.error === 'FETCH_MANIFEST' && String(r.message).indexOf('HTTP_404') >= 0, JSON.stringify(r))
    ok('manifest 404：只请求 1 次（不可恢复的错不重试）', manifestFetches === 1, manifestFetches)
    ok('manifest 404：立刻返回，没有白等', dt < 3000, dt + 'ms')
  }

  /* 场景 9：manifest 一直瞬时失败 —— 重试次数必须有上限，且绝不把预算耗光。
     MANIFEST_ATTEMPT_MS 压到下限 1500，让每次尝试「卡住 1.5 秒」，测试才跑得快。 */
  {
    const env = makeEnv()
    MODE = 'hang'
    manifestFetches = 0
    const BUDGET = 40000
    const mod = load(env, {
      SOURCE_REPO: 'me/repo', BUDGET_MS: String(BUDGET), FUNCTION_TIMEOUT_MS: '60000',
      MANIFEST_ATTEMPT_MS: '1500',
    })
    const t0 = Date.now()
    const r = await mod.main({})
    const dt = Date.now() - t0
    ok('manifest 持续抖动：仍报 FETCH_MANIFEST + HTTP_TIMEOUT（返回形态不变）',
      r && r.error === 'FETCH_MANIFEST' && String(r.message).indexOf('HTTP_TIMEOUT') >= 0, JSON.stringify(r))
    ok('manifest 持续抖动：重试次数封顶在 3 次', manifestFetches === 3, manifestFetches)
    ok('manifest 持续抖动：用时远小于时间预算（没把预算耗在重试上）',
      dt < 10000 && dt < BUDGET, dt + 'ms vs 预算 ' + BUDGET + 'ms')
  }

  /* 场景 10：预算太小、余量不够再试一次 —— 必须**提前放弃**（只试 1 次），
     绝不能因为「想重试」而把预算吃穿。 */
  {
    const env = makeEnv()
    MODE = 'hang'
    manifestFetches = 0
    const BUDGET = 2000
    const mod = load(env, {
      SOURCE_REPO: 'me/repo', BUDGET_MS: String(BUDGET), FUNCTION_TIMEOUT_MS: '60000',
      MANIFEST_ATTEMPT_MS: '1500',
    })
    const t0 = Date.now()
    const r = await mod.main({})
    const dt = Date.now() - t0
    ok('余量不足：报 FETCH_MANIFEST + HTTP_TIMEOUT',
      r && r.error === 'FETCH_MANIFEST' && String(r.message).indexOf('HTTP_TIMEOUT') >= 0, JSON.stringify(r))
    ok('余量不足：只试 1 次就放弃（不硬撑）', manifestFetches === 1, manifestFetches)
    ok('余量不足：不越过时间预算', dt < BUDGET + 2000, dt + 'ms vs ' + BUDGET + 'ms')
  }

  console.log(failed ? `\n${failed} 项失败` : '\n全部通过')
  process.exit(failed ? 1 : 0)
})()
