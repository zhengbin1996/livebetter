(function(){const factories={"utils/store":function(module,exports,require){
const cloud = require('./cloud')

/**
 * 用户数据：收藏 + 打卡清单。
 *
 * 隔离方式：云数据库 user_data 的 _id 就是 openid，云函数从 wxContext.OPENID 取，
 * 所以**没有登录页、没有授权弹窗**。
 * 离线可用：所有写操作先落本地镜像（setStorage），再异步推云；
 * 推失败不报错，等下次联网按 updatedAt 做 Last-Write-Wins 补传。
 */

const SYNC_KEY = 'htb.sync'
const FAV_KEY = 'htb.fav'
const CHECK_KEY = 'htb.check'
const DAYS_KEY = 'htb.days'
const SYNC_HISTORY_MAX = 12
/** 完成日记只保留最近 400 天，够算连续天数又不会无限长 */
const DAYS_MAX = 400

function read(key, fallback) {
  try {
    const v = wx.getStorageSync(key)
    return v === '' || v == null ? fallback : v
  } catch (e) {
    return fallback
  }
}

function write(key, val) {
  try {
    wx.setStorageSync(key, val)
    return true
  } catch (e) {
    return false
  }
}

/* ---------------------------------------------------------------- 同步历史 */

function readSync() {
  return read(SYNC_KEY, {})
}

function recordSync(m) {
  const cur = readSync()
  const hist = Array.isArray(cur.history) ? cur.history : []
  if (hist[0] && hist[0].version === m.version) {
    cur.at = hist[0].at
    write(SYNC_KEY, cur)
    return
  }
  hist.unshift({
    version: m.version,
    commit: m.commit || '',
    at: m.generatedAt || new Date().toISOString(),
  })
  cur.at = hist[0].at
  cur.history = hist.slice(0, SYNC_HISTORY_MAX)
  write(SYNC_KEY, cur)
}

/* ---------------------------------------------------------------- 收藏 */

function getFavorites() {
  const all = read(FAV_KEY, {})
  const active = {}
  Object.keys(all).forEach((sid) => {
    if (all[sid] && !all[sid].removed) active[sid] = all[sid]
  })
  return active
}

function isFavorite(sid) {
  return !!getFavorites()[sid]
}

/** 返回收藏后的状态 */
function toggleFavorite(sid) {
  const fav = Object.assign({}, read(FAV_KEY, {}))
  const on = !isFavorite(sid)
  const previousStamp = Date.parse((fav[sid] || {}).at || '') || 0
  const at = new Date(Math.max(Date.now(), previousStamp + 1)).toISOString()
  fav[sid] = on ? { at } : { removed: true, at }
  if (!write(FAV_KEY, fav)) throw new Error('SAVE_FAILED')
  push('favorite', sid, fav[sid])
  return on
}

function removeFavorite(sid) {
  if (isFavorite(sid)) toggleFavorite(sid)
}

/* ---------------------------------------------------------------- 打卡 */

function getCheckins() {
  const all = read(CHECK_KEY, {})
  const active = {}
  Object.keys(all).forEach((sid) => {
    if (all[sid] && !all[sid].removed) active[sid] = all[sid]
  })
  return active
}

function getCheckin(sid) {
  return getCheckins()[sid] || null
}

function getCheckinRevision(sid) {
  return (read(CHECK_KEY, {})[sid] || {}).updatedAt || ''
}

/* 完成日记：{ 'YYYY-MM-DD': 当天标为做到的次数 }，只用来算「连续天数」。
   单独存一份是因为清单本身只记「当前是否做到」，没有时间轴，
   而「连续 3 天」这种反馈必须有时间轴。 */
function pad2(n) {
  return n < 10 ? `0${n}` : `${n}`
}

function dayKey(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/**
 * 连续天数：从今天往回数，遇到第一个「有做到」的日子起算、到第一个空日止。
 * 今天还没做**不算断**（一天才过了一半就判人断签不合理），
 * 所以从今天开始找第一个非零日，再往前连续数。
 */
function dayStats() {
  const days = read(DAYS_KEY, {})
  const today = days[dayKey(new Date(Date.now()))] || 0
  const d = new Date(Date.now())
  let streak = 0
  let started = false
  for (let i = 0; i < DAYS_MAX; i++) {
    const c = days[dayKey(d)] || 0
    if (c > 0) {
      streak += 1
      started = true
    } else if (started || i > 0) {
      break
    }
    d.setDate(d.getDate() - 1)
  }
  return { streak, today }
}

/** 写一条清单记录。plan: 'today'（默认，今天做）| 'later'（稍后） */
function setCheckin(sid, patch) {
  const prev = getCheckin(sid) || { done: false, plan: 'today', note: '' }
  const next = Object.assign({}, prev, patch)
  if (next.plan !== 'later') next.plan = 'today'
  return replaceCheckin(sid, next).record
}

function replaceCheckin(sid, record, inverseChanges) {
  const all = read(CHECK_KEY, {})
  const before = all[sid] && !all[sid].removed ? all[sid] : null
  const previousStamp = Date.parse((all[sid] || {}).updatedAt || '') || 0
  const timestamp = new Date(Math.max(Date.now(), previousStamp + 1)).toISOString()
  const next = record ? Object.assign({}, record, { updatedAt: timestamp }) : { removed: true, updatedAt: timestamp }
  const today = dayKey(new Date(Date.now()))
  const changes = Object.assign({}, inverseChanges || {})
  if (!inverseChanges && !!(before && before.done) !== !!(record && record.done)) {
    const day = record && record.done ? today : (before && before.doneDay) || today
    changes[day] = record && record.done ? 1 : -1
    if (record && record.done) next.doneDay = day
    else delete next.doneDay
  }
  if (record) {
    delete next.removed
    if (next.plan !== 'later') next.plan = 'today'
  }
  const days = read(DAYS_KEY, {})
  const nextDays = Object.assign({}, days)
  Object.keys(changes).forEach((day) => {
    nextDays[day] = Math.max(0, (days[day] || 0) + changes[day])
    changes[day] = nextDays[day] - (days[day] || 0)
  })
  const keys = Object.keys(nextDays).sort()
  while (keys.length > DAYS_MAX) delete nextDays[keys.shift()]
  const nextAll = Object.assign({}, all, { [sid]: next })
  if (!write(CHECK_KEY, nextAll)) throw new Error('SAVE_FAILED')
  if (Object.keys(changes).length && !write(DAYS_KEY, nextDays)) {
    write(CHECK_KEY, all)
    throw new Error('SAVE_FAILED')
  }
  push('checkin', sid, next)
  return { record: record ? next : null, updatedAt: timestamp, dayChanges: changes }
}

/** 加进清单（不改变完成状态） */
function addToList(sid, plan) {
  const cur = getCheckin(sid)
  if (cur && !cur.plan) cur.plan = 'today'
  return setCheckin(sid, { done: cur ? !!cur.done : false, plan: plan || 'today' })
}

/** 移出清单（区别于「没做到」） */
function setPlan(sid, plan) {
  return setCheckin(sid, { plan })
}

/** 已做 / 待做统计 */
function checkinStats() {
  const all = getCheckins()
  const sids = Object.keys(all)
  const done = sids.filter((k) => all[k].done).length
  return { total: sids.length, done, todo: sids.length - done }
}

/** 按「行动看板」的口径分组：今天 / 稍后 / 已完成 */
function listBuckets() {
  const all = getCheckins()
  const today = []
  const later = []
  const done = []
  Object.keys(all).forEach((sid) => {
    const r = all[sid]
    if (r.done) done.push(sid)
    else if (r.plan === 'later') later.push(sid)
    else today.push(sid)
  })
  return { today, later, done }
}

/** 把一条从清单里彻底移出（不是标成没做） */
function removeCheckin(sid) {
  if (!getCheckin(sid)) return
  replaceCheckin(sid, null)
}

/* ---------------------------------------------------------------- 云端同步 */

const pending = []
let flushing = null

function push(kind, sid, payload) {
  pending.push({ kind, sid, payload })
  flushSoon()
}

let timer = null
function flushSoon() {
  if (timer) return
  timer = setTimeout(() => {
    timer = null
    flush()
  }, 800)
}

/** 补传本地变更。失败就留在队列里，等下一次动作或前台切回时再试。 */
function flush() {
  if (flushing) return flushing
  if (!pending.length) return Promise.resolve()
  const batch = pending.splice(0, pending.length)
  const fav = {}
  const checks = {}
  for (const p of batch) {
    if (p.kind === 'favorite') fav[p.sid] = p.payload
    else checks[p.sid] = p.payload
  }
  flushing = (async () => {
    let synced = false
    try {
      const result = await cloud.call('getUserData', { op: 'merge', favorite: fav, checkin: checks }, { timeout: 10000 })
      if (!result || !result.ok) throw new Error('SYNC_FAILED')
      synced = true
    } catch (error) {
      pending.unshift(...batch)
    } finally {
      flushing = null
      if (synced && pending.length) flushSoon()
    }
  })()
  return flushing
}

/**
 * 进页面时与云核对一次：以 updatedAt 较大者为准，避免多端互相覆盖。
 */
async function pull() {
  try {
    const res = await cloud.call('getUserData', { op: 'read' }, { timeout: 10000 })
    if (!res || !res.ok) return { ok: false }
    const localFav = read(FAV_KEY, {})
    const localCheck = read(CHECK_KEY, {})
    const cloudFav = res.favorite || {}
    const cloudCheck = res.checkin || {}

    // 收藏：并集（任一端有就算收藏，除非 Cloud 明确标记了删除时间更晚）
    const fav = Object.assign({}, localFav)
    Object.keys(cloudFav).forEach((sid) => {
      const c = cloudFav[sid]
      const l = fav[sid]
      if (!l || !l.at || (c.at && c.at > l.at)) fav[sid] = c
    })
    write(FAV_KEY, fav)

    // 打卡：按 updatedAt 取新
    const check = Object.assign({}, localCheck)
    Object.keys(cloudCheck).forEach((sid) => {
      const c = cloudCheck[sid]
      const l = check[sid]
      if (!l || !l.updatedAt || (c.updatedAt && c.updatedAt > l.updatedAt)) check[sid] = c
    })
    write(CHECK_KEY, check)

    Object.keys(localFav).forEach((sid) => {
      const remote = cloudFav[sid]
      if (!remote || (localFav[sid].at || '') > (remote.at || '')) push('favorite', sid, localFav[sid])
    })
    Object.keys(localCheck).forEach((sid) => {
      const remote = cloudCheck[sid]
      if (!remote || (localCheck[sid].updatedAt || '') > (remote.updatedAt || '')) push('checkin', sid, localCheck[sid])
    })

    // 本地比云新的部分补推上去
    return { ok: true, favorite: fav, checkin: check }
  } catch (e) {
    return { ok: false }
  }
}

/* ---------------------------------------------------------------- 条目迁移 */

/**
 * 上游改标题会让 sid 变，manifest.prevIdMap 给出「旧 id → 新 id」。
 * 每次拿到新 manifest 后调一次，把收藏和打卡迁过去，避免用户数据凭空消失。
 */
function migrate(prevIdMap) {
  if (!prevIdMap || !Object.keys(prevIdMap).length) return 0
  const fav = read(FAV_KEY, {})
  const check = read(CHECK_KEY, {})
  let n = 0

  Object.keys(prevIdMap).forEach((oldSid) => {
    const newSid = prevIdMap[oldSid]
    if (!newSid) return
    if (fav[oldSid]) {
      if (!fav[newSid]) fav[newSid] = fav[oldSid]
      delete fav[oldSid]
      n += 1
    }
    if (check[oldSid]) {
      if (!check[newSid]) check[newSid] = check[oldSid]
      delete check[oldSid]
      n += 1
    }
  })

  if (n) {
    write(FAV_KEY, fav)
    write(CHECK_KEY, check)
  }
  return n
}

module.exports = {
  readSync,
  recordSync,
  getFavorites,
  isFavorite,
  toggleFavorite,
  removeFavorite,
  getCheckins,
  getCheckin,
  getCheckinRevision,
  setCheckin,
  replaceCheckin,
  addToList,
  setPlan,
  dayStats,
  listBuckets,
  removeCheckin,
  checkinStats,
  flush,
  pull,
  migrate,
}

},
"utils/cloud":function(module,exports,require){
const config = require('../config')

/**
 * 云函数调用封装：统一超时与错误形态。
 * 所有云调用都经过这里，方便以后换实现（比如换成自建后端）时只改一处。
 */
function call(name, data, opts) {
  const timeout = (opts && opts.timeout) || config.CLOUD_TIMEOUT
  return new Promise((resolve, reject) => {
    if (!wx.cloud) {
      reject(new Error('当前基础库不支持云开发'))
      return
    }
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error('云函数 ' + name + ' 超时'))
    }, timeout)

    wx.cloud.callFunction({
      name,
      data: data || {},
      success(res) {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(res.result)
      },
      fail(err) {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(err)
      },
    })
  })
}

/**
 * 下载云存储文件。用 wx.cloud.downloadFile 而不是 wx.downloadFile ——
 * 前者走云开发通道，不受 request/downloadFile 合法域名白名单限制。
 */
function download(fileID) {
  return new Promise((resolve, reject) => {
    wx.cloud.downloadFile({
      fileID,
      success: (res) => resolve(res.tempFilePath),
      fail: reject,
    })
  })
}

module.exports = { call, download }

},
"utils/favorites":function(module,exports,require){
const store = require('./store')
const advice = require('./advice')
const share = require('./share')
const listeners = []

function subscribe(listener) {
  listeners.push(listener)
  return () => {
    const index = listeners.indexOf(listener)
    if (index >= 0) listeners.splice(index, 1)
  }
}

function refresh() { listeners.slice().forEach((listener) => listener()) }

function toggle(item) {
  if (share.requireFullApp()) return null
  if (!item || !item.sid) return null
  advice.remember(item)
  try {
    const saved = store.toggleFavorite(item.sid)
    refresh()
    wx.showToast({ title: saved ? '已收藏' : '已取消收藏', icon: 'none' })
    return saved
  } catch (error) {
    wx.showToast({ title: '未保存成功，请重试', icon: 'none' })
    return null
  }
}

function show(page, listener) {
  hide(page)
  if (share.singlePage()) return
  page.favoritesActive = true
  page.favoritesSubscription = subscribe(() => {
    if (page.favoritesActive && listener) listener.call(page)
  })
  refresh()
  store.pull().then(() => { if (page.favoritesActive) refresh() })
}

function hide(page) {
  page.favoritesActive = false
  if (page.favoritesSubscription) page.favoritesSubscription()
  page.favoritesSubscription = null
}

module.exports = { subscribe, refresh, toggle, show, hide }

},
"utils/advice":function(module,exports,require){
const KEY = 'htb.advice'
const LIMIT = 700
const bundled = require('../data/pick-summaries')

function version() {
  const app = getApp()
  return (app && app.globalData && app.globalData.version) || ''
}

function textOf(value) {
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…' }
  return String(value || '')
    .replace(/<\/(?:p|div|li|h[1-6])\s*>|<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (match, name) => {
      if (name[0] === '#') {
        const number = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10)
        return number >= 0 && number <= 0x10ffff ? String.fromCodePoint(number) : match
      }
      return Object.prototype.hasOwnProperty.call(entities, name) ? entities[name] : match
    })
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g, '\n').trim()
}

function cache() {
  try {
    const value = wx.getStorageSync(KEY)
    return value && value.version === version() ? value.items || {} : {}
  } catch (error) { return {} }
}

function normalize(item) {
  const source = item || {}
  const saved = cache()[source.sid] || {}
  const fields = source.fields || {}
  const bundledSummary = bundled.version === version() ? bundled.items[source.sid] : ''
  const full = fields['说人话'] || source.plainText || (source.summaryFull ? source.summary : '') || bundledSummary
  return Object.assign({}, saved, source, {
    title: source.title || source.t || saved.title || '',
    sec: source.sec || source.s || saved.sec || 0,
    num: source.num || source.n || saved.num || 0,
    summary: textOf(full || (saved.summaryFull ? saved.summary : '')),
    summaryHtml: fields['说人话'] || saved.summaryHtml || '',
    summaryFull: !!full || !!saved.summaryFull,
    dispute: !!(source.dispute || saved.dispute),
    todo: !!(source.todo || saved.todo),
  })
}

function remember(item) {
  const normalized = normalize(item)
  if (!normalized.sid || !normalized.title) return normalized
  const items = cache()
  items[normalized.sid] = {
    sid: normalized.sid, title: normalized.title, sec: normalized.sec, num: normalized.num,
    summary: normalized.summary, summaryFull: normalized.summaryFull,
    summaryHtml: normalized.summaryHtml,
    dispute: normalized.dispute, todo: normalized.todo,
  }
  const keys = Object.keys(items)
  while (keys.length > LIMIT) delete items[keys.shift()]
  try { wx.setStorageSync(KEY, { version: version(), items }) } catch (error) {}
  return normalized
}

function placeholder(sid) {
  const saved = cache()[sid]
  const app = getApp()
  const index = (((app || {}).globalData || {}).essentials || {}).sidIndex || {}
  const position = index[sid] || []
  return Object.assign({ sid, title: '', summary: '', unavailable: true }, saved || {}, {
    sec: position[0] || (saved && saved.sec) || Number((/^s(\d+)-/.exec(sid) || [])[1]) || 0,
    num: position[1] || (saved && saved.num) || 0,
  })
}

module.exports = { textOf, normalize, remember, placeholder }

},
"utils/reader-content":function(module,exports,require){
function isReadableKind(kind) {
  return kind === 'book' || kind === 'doc'
}

function readableDocs(essentials) {
  return ((essentials && essentials.docs) || []).filter((entry) => entry.kind === 'doc')
}

function readableHits(hits, essentials) {
  const docs = readableDocs(essentials)
  const readable = (hits || []).filter((hit) => !hit.kind || hit.kind === 'item' || (hit.kind === 'doc' && (hit.docKind === 'doc' || (!hit.docKind && docs.some((entry) => entry.sid === hit.sid)))))
  return readable.filter((hit) => hit.kind !== 'doc').concat(readable.filter((hit) => hit.kind === 'doc'))
}

module.exports = { isReadableKind, readableDocs, readableHits }

},
"utils/refs":function(module,exports,require){
/**
 * 链接路由：mp-html 渲染出来的自定义协议在这里落地。
 *
 * 构建期把正文里的
 *   交叉引用   → [见第 8 节第 17 条（借条和担保）](ref://s08-xxxxxxxxxx)
 *   术语       → [RR](gloss://RR)
 * 所以渲染层不需要认识业务，只要在 linktap 里把 href 交给这里。
 */

const REF_SCHEME = 'ref://'
const GLOSS_SCHEME = 'gloss://'
const reader = require('./reader-content')
const share = require('./share')

function internalDoc(href) {
  let path
  try { path = decodeURIComponent(href).split(/[?#]/)[0] } catch (error) { return null }
  if (/^https?:/i.test(path)) {
    const match = path.match(/^https?:\/\/(?:github\.com\/eternity4719\/HowToLiveBetter\/blob|raw\.githubusercontent\.com\/eternity4719\/HowToLiveBetter)\/[^/]+\/(.+)$/i)
    if (!match) return null
    path = match[1]
  }
  path = path.replace(/^(?:\.\.\/|\.\/)+/, '').replace(/^\//, '')
  if (!/^docs\/.+\.md$/.test(path)) return null
  const name = path.slice(5, -3)
  const app = getApp()
  const entry = reader.readableDocs(app && app.globalData.essentials).find((doc) => doc.name === name)
  return entry ? { kind: 'doc', sid: entry.sid } : { kind: 'unavailable' }
}

function readableHtml(html) {
  return String(html || '').replace(/(<a\b[^>]*href=["']([^"']+)["'][^>]*>)([\s\S]*?)(<\/a>)/gi, (match, opening, href, label, closing) => {
    const info = classify(href)
    if (info.kind !== 'doc' && info.kind !== 'unavailable') return match
    const target = info.kind === 'doc' ? 'doc://' + info.sid : 'unavailable://content'
    const routed = opening.replace(/(href=["'])[^"']+(["'])/i, (_, start, end) => start + target + end)
    if (info.kind === 'doc' && /^(?:\.\.\/|\.\/)*docs\/.+\.md$/.test(label)) {
      const app = getApp()
      const entry = reader.readableDocs(app && app.globalData.essentials).find((doc) => doc.sid === info.sid)
      label = entry.title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    }
    return routed + label + closing
  })
}

function secFromSid(sid) {
  if (!sid || sid[0] !== 's') return null
  const n = parseInt(sid.slice(1, 3), 10)
  return isNaN(n) ? null : n
}

function classify(href) {
  if (!href) return { kind: 'none' }
  if (href.indexOf('doc://') === 0) {
    const sid = href.slice(6)
    const app = getApp()
    return reader.readableDocs(app && app.globalData.essentials).some((doc) => doc.sid === sid) ? { kind: 'doc', sid } : { kind: 'unavailable' }
  }
  if (href.indexOf('unavailable://') === 0) return { kind: 'unavailable' }
  if (href.indexOf(REF_SCHEME) === 0) {
    const sid = href.slice(REF_SCHEME.length)
    return { kind: 'ref', sid, sec: secFromSid(sid) }
  }
  if (href.indexOf(GLOSS_SCHEME) === 0) {
    let term = href.slice(GLOSS_SCHEME.length)
    try { term = decodeURIComponent(term) } catch (error) {}
    return { kind: 'gloss', term }
  }
  const doc = internalDoc(href)
  if (doc) return doc
  if (/^https?:\/\/(?:github\.com\/eternity4719\/HowToLiveBetter|raw\.githubusercontent\.com\/eternity4719\/HowToLiveBetter)\//i.test(href) && /\.md(?:[?#]|$)/.test(href)) return { kind: 'unavailable' }
  if (!/^https?:/i.test(href) && /\.md(?:[?#]|$)/.test(href)) return { kind: 'unavailable' }
  if (/^https?:/i.test(href)) return { kind: 'http', url: href }
  return { kind: 'other', href }
}

/** 术语释义：从内置 essentials 里查，离线可用 */
function glossaryOf(term) {
  const app = getApp()
  const list = (app && app.globalData.essentials && app.globalData.essentials.glossary) || []
  for (const g of list) {
    if (g.term === term) return g
  }
  // 容错：允许「RR 」这类带空格的写法
  const t = String(term || '').replace(/\s+/g, '')
  for (const g of list) {
    if (String(g.term).replace(/\s+/g, '') === t) return g
  }
  return null
}

/** 统一处理一次点击，返回给页面决定要不要弹东西 */
function handle(href, opts) {
  const info = classify(href)
  if (['doc', 'ref', 'http'].indexOf(info.kind) >= 0 && share.requireFullApp()) return { kind: 'none' }
  if (info.kind === 'doc') goDoc(info.sid, 'doc')
  if (info.kind === 'unavailable') wx.showToast({ title: '此内容未在小程序提供', icon: 'none' })
  if (info.kind === 'http') {
    // 不用 web-view 打开 github / DOI（业务域名备案难通过），改复制链接
    wx.setClipboardData({
      data: info.url,
      success() {
        wx.showToast({ title: '链接已复制', icon: 'none' })
      },
    })
    return info
  }
  if (info.kind === 'gloss' && !(opts && opts.silent)) return info
  return info
}

/** 跳到某条建议 */
function goItem(sid) {
  if (share.requireFullApp()) return
  if (!sid) return
  wx.navigateTo({ url: `/pages/item-detail/index?sid=${sid}` })
}

/** 跳到专题长文 */
function goDoc(sid, kind) {
  if (share.requireFullApp()) return
  if (!sid) return
  if (kind && kind !== 'doc') {
    wx.showToast({ title: '此内容未在小程序提供', icon: 'none' })
    return
  }
  wx.navigateTo({ url: `/subpackages/read/pages/doc-read/index?sid=${sid}` })
}

/** 跳到某节阅读 */
function goSection(sec) {
  if (share.requireFullApp()) return
  wx.navigateTo({ url: `/subpackages/read/pages/section-detail/index?sec=${sec}` })
}

/** 跳到某节第 N 条：先开节，再让节内滚动到那一条（避免额外一次分片加载） */
function goSectionAt(sec, num) {
  if (share.requireFullApp()) return
  wx.navigateTo({ url: `/subpackages/read/pages/section-detail/index?sec=${sec}&num=${num}` })
}

/* ---------------------------------------------------------------- 检索高亮 */

/**
 * 把一段文本按查询词切成 [{t, hit}]，供 WXML 里逐段上色。
 * 中文按字面匹配，不切词——和用户预期一致（输入什么就高亮什么）。
 */
function highlight(text, q, limit) {
  const src = String(text || '')
  const query = String(q || '').trim()
  const max = limit || src.length
  const raw = []
  if (!query) {
    raw.push({ t: src.slice(0, max), hit: false })
  } else {
    const hay = src.toLowerCase()
    const needle = query.toLowerCase()
    let i = 0
    let used = 0
    while (i < src.length && used < max) {
      const at = hay.indexOf(needle, i)
      if (at < 0) {
        raw.push({ t: src.slice(i, Math.min(src.length, i + (max - used))), hit: false })
        break
      }
      if (at > i) {
        const seg = src.slice(i, at)
        raw.push({ t: seg, hit: false })
        used += seg.length
      }
      raw.push({ t: src.substr(at, needle.length), hit: true })
      used += needle.length
      i = at + needle.length
    }
  }
  // 打上稳定的下标，WXML 的 wx:key 需要它
  return raw.map((p, i) => Object.assign({}, p, { i }))
}

module.exports = {
  REF_SCHEME,
  GLOSS_SCHEME,
  secFromSid,
  classify,
  glossaryOf,
  handle,
  goItem,
  goDoc,
  goSection,
  goSectionAt,
  highlight,
  readableHtml,
}

},
"utils/reading-help":function(module,exports,require){
module.exports = [
  { head: '搜索与目录', body: '在“检索”输入问题或关键词查找内容；也可从首页打开目录，按章节阅读。搜索结果可继续筛选，点开条目查看。' },
  { head: '摘要与原文', body: '条目页先展示“说人话”摘要，点“查看原文”阅读完整内容、适用范围和来源。摘要不能替代原文中的限制条件。' },
  { head: '收藏', body: '点条目的收藏按钮保存，之后在“收藏”页查找。收藏保存在当前设备，清理正文缓存不会删除收藏；收藏本身不代表正文已下载。' },
  { head: '术语与标注', body: '正文中带链接的术语可点开查看释义，也可在这里进入术语表搜索。证据等级、性价比档和成本标签的含义见“标注怎么读”。' },
  { head: '离线阅读与更新', body: '已打开的正文会缓存到本机。断网前可到“离线与更新”下载全书，包含章节与长文；下载中断后可继续。完整检索需要联网，离线时只能搜本机缓存，也可通过目录和收藏阅读已缓存内容。' },
]

},
"utils/section-guide":function(module,exports,require){
function overview(intro, groups) {
  const labels = (groups || []).map((group) => group.label)
  return (intro || []).filter((paragraph) => {
    const heading = String(paragraph).match(/^\s*<p>\s*<(?:b|strong)>([^<]+)<\/(?:b|strong)>\s*[：:]/)
    return !heading || labels.indexOf(heading[1].trim()) < 0
  }).join('')
}

function navigation(groups) {
  return (groups || []).map((group, index) => Object.assign({}, group, {
    order: String(index + 1).padStart(2, '0'),
    items: (group.items || []).map((item) => Object.assign({}, item, {
      label: String(item.label || '').replace(/^[\s，,、；;]+/, ''),
    })),
  }))
}

module.exports = { overview, navigation }

},
"utils/share":function(module,exports,require){
const config = require('../config')
const MENUS = ['shareAppMessage', 'shareTimeline']

function payload(title, path, params) {
  const query = Object.keys(params || {}).map((key) => encodeURIComponent(key) + '=' + encodeURIComponent(params[key])).join('&')
  return { title, path: path + (query ? '?' + query : ''), imageUrl: '/assets/share-cover.png' }
}

function home() {
  return payload('《' + config.BOOK_NAME + '》', '/pages/index/index')
}

function directory(tab) {
  return payload('《' + config.BOOK_NAME + '》· 全书目录', '/pages/section-list/index', tab === 'docs' ? { tab: 'docs' } : {})
}

function item(entry) {
  if (!entry || !/^s\d{2}-[a-z\d]+$/i.test(entry.sid || '') || !entry.title || entry.title === '正文未下载') return home()
  const params = { sid: entry.sid }
  if (Number.isInteger(entry.num) && entry.num > 0) params.num = entry.num
  return payload(entry.title, '/pages/item-detail/index', params)
}

function section(sec, title) {
  if (!Number.isInteger(sec) || sec < 1 || !title) return home()
  return payload('第 ' + sec + ' 节 · ' + title, '/subpackages/read/pages/section-detail/index', { sec })
}

function doc(entry) {
  if (!entry || !/^d-[a-z\d-]+$/i.test(entry.sid || '') || !entry.title) return home()
  return payload(entry.title, '/subpackages/read/pages/doc-read/index', { sid: entry.sid })
}

function timeline(share) {
  return { title: share.title, query: share.path.split('?')[1] || '', imageUrl: share.imageUrl }
}

function enable(available) {
  if (singlePage()) return
  const method = available ? wx.showShareMenu : wx.hideShareMenu
  if (typeof method === 'function') method.call(wx, { menus: MENUS, withShareTicket: false })
}

function singlePage() {
  return typeof wx.getLaunchOptionsSync === 'function' && wx.getLaunchOptionsSync().scene === 1154
}

function requireFullApp() {
  if (!singlePage()) return false
  wx.showToast({ title: '请点击下方“前往小程序”继续', icon: 'none' })
  return true
}

module.exports = { home, directory, item, section, doc, timeline, enable, singlePage, requireFullApp }

},
"utils/share-cover":function(module,exports,require){
const advice = require('./advice')
const config = require('../config')

function wrap(text, measure, width, limit) {
  const characters = Array.from(String(text || '').replace(/\s+/g, ' ').trim())
  const lines = []
  let line = ''
  for (let index = 0; index < characters.length; index++) {
    const character = characters[index]
    if (line && measure(line + character) > width) {
      if (lines.length === limit - 1) {
        while (line && measure(line + '…') > width) line = Array.from(line).slice(0, -1).join('')
        lines.push(line + '…')
        return lines
      }
      lines.push(line)
      line = character
    } else line += character
  }
  if (line) lines.push(line)
  return lines
}

function item(entry) {
  const fields = (entry && entry.fields) || {}
  return {
    title: entry && entry.title || config.BOOK_NAME,
    label: '一条建议',
    summary: advice.textOf(fields['说人话'] || (entry && entry.summaryFull ? entry.summary : '')),
    summaryLabel: '原文摘要 · 摘录',
  }
}

function section(sec, title, intro) {
  return { title, label: '第 ' + sec + ' 节', summary: advice.textOf((intro || [])[0]), summaryLabel: '原书导读 · 摘录' }
}

function doc(entry) {
  const paragraph = String(entry && entry.body || '').match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)
  return { title: entry && entry.title || config.BOOK_NAME, label: '专题长文', summary: advice.textOf(paragraph && paragraph[1]), summaryLabel: '原文开篇 · 摘录' }
}

function draw(context, info) {
  context.fillStyle = '#FAF9F5'
  context.fillRect(0, 0, 1000, 800)
  context.fillStyle = '#25251F'
  context.fillRect(0, 0, 1000, 12)
  context.textBaseline = 'top'
  context.fillStyle = '#55554D'
  context.font = '32px sans-serif'
  context.fillText(config.BOOK_NAME, 64, 60)
  context.fillStyle = '#FBE7D8'
  context.fillRect(730, 48, 206, 62)
  context.fillStyle = '#B3440C'
  context.font = 'bold 28px sans-serif'
  context.fillText(info.label || '原文阅读', 752, 64)
  context.fillStyle = '#25251F'
  context.font = 'bold 68px sans-serif'
  const titleLines = wrap(info.title, (text) => context.measureText(text).width, 872, 3)
  titleLines.forEach((line, index) => context.fillText(line, 64, 156 + index * 82))
  if (info.summary) {
    const summaryTop = Math.max(300, 156 + titleLines.length * 82 + 28)
    context.fillStyle = '#EDEDE7'
    context.fillRect(64, summaryTop, 872, 688 - summaryTop)
    context.fillStyle = '#B3440C'
    context.fillRect(64, summaryTop, 6, 688 - summaryTop)
    context.font = '26px sans-serif'
    context.fillText(info.summaryLabel || '原文摘要 · 摘录', 96, summaryTop + 24)
    context.fillStyle = '#55554D'
    context.font = '44px sans-serif'
    wrap(info.summary, (text) => context.measureText(text).width, 808, 3).forEach((line, index) => context.fillText(line, 96, summaryTop + 78 + index * 56))
  }
  context.fillStyle = '#6C6C61'
  context.font = '28px sans-serif'
  context.fillText('生活建议，请结合自身情况阅读原文', 64, 726)
  context.fillStyle = '#B3440C'
  context.font = 'bold 30px sans-serif'
  context.fillText('打开阅读 →', 764, 724)
}

function prepare(page, info) {
  page.shareCoverInfo = info
  page.shareCoverPath = ''
  page.shareCoverPromise = null
  const generation = (page.shareCoverGeneration || 0) + 1
  page.shareCoverGeneration = generation
  if (!info || typeof wx.createSelectorQuery !== 'function' || typeof wx.canvasToTempFilePath !== 'function') return Promise.resolve('')
  page.shareCoverPromise = new Promise((resolve) => {
    let settled = false
    const finish = (path) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (generation === page.shareCoverGeneration) page.shareCoverPath = path || ''
      resolve(path || '')
    }
    const timer = setTimeout(() => finish(''), 1500)
    try {
      wx.createSelectorQuery().in(page).select('#share-cover-canvas').fields({ node: true, size: true }).exec((result) => {
        try {
          const canvas = result && result[0] && result[0].node
          if (!canvas || settled || generation !== page.shareCoverGeneration) { finish(''); return }
          canvas.width = 1000
          canvas.height = 800
          draw(canvas.getContext('2d'), info)
          wx.canvasToTempFilePath({ canvas, width: 1000, height: 800, destWidth: 1000, destHeight: 800, fileType: 'png', success: (response) => finish(response.tempFilePath), fail: () => finish('') }, page)
        } catch (error) { finish('') }
      })
    } catch (error) { finish('') }
  })
  return page.shareCoverPromise
}

function attach(page, payload) {
  const shared = Object.assign({}, payload)
  if (page.shareCoverPath) shared.imageUrl = page.shareCoverPath
  else if (page.shareCoverPromise) shared.promise = page.shareCoverPromise.then(() => Object.assign({}, payload, { imageUrl: page.shareCoverPath || payload.imageUrl }))
  return shared
}

module.exports = { wrap, item, section, doc, draw, prepare, attach }

},
"config":function(module,exports,require){
/**
 * 全局配置。改名只需要动这里 + app.json 的 navigationBarTitleText。
 */
module.exports = {
  // ⚠️ 小程序名称待定。这里是工作名（同时也是书名，CC BY 4.0 要求署名）。
  // 若最终改成工具向的名字（如「循证清单」），改这两处即可：
  //   1) 本文件 APP_NAME
  //   2) app.json → window.navigationBarTitleText
  // 书名字段 BOOK_NAME 用于版权署名，**不要跟着改**。
  APP_NAME: '高性价比人生指南',
  BOOK_NAME: '高性价比人生指南',

  // 云开发环境 ID。留空则用默认环境（只有一个环境时可留空）。
  // ⚠️ 这里必须是**环境 ID**（形如 cloud1-xxxx），不是 AppID（wx 开头）——
  //    填错的症状是不报错，但云调用全部静默失败、syncState 永远是 offline。
  //
  // 2026-10-14：AppID 换成 `wx9db0838102248c71`（**与旧 AppID 不是同一主体**）。
  // 云开发环境归属「开放平台账号」，跨主体**无法关联**，所以旧环境
  // `cloud1-d8gc8etl2e047a62f` 对本小程序完全不可用，已换为新主体下新建的环境。
  // ⚠️ 两个 ID 只有中段几位不同（d8gc8etl2e047a62f / d8gz1sda5f63732a8），粘贴时别拿错。
  CLOUD_ENV: 'cloud1-d8gz1sda5f63732a8',

  REPO_URL: 'https://github.com/eternity4719/HowToLiveBetter',
  LICENSE_NAME: 'CC BY 4.0',
  LICENSE_URL: 'https://creativecommons.org/licenses/by/4.0/',

  // 本地缓存目录（wx.env.USER_DATA_PATH 之下），正文一律落在文件系统里，
  // 不用 setStorage（单 key 1 MB 限制）
  LOCAL_ROOT: 'htb',

  // 审核口径：健康类表述必须带免责声明，避免绝对化用语
  DISCLAIMER: '本内容为生活建议，不构成医疗建议或法律意见；就医请遵医嘱，涉诉请咨询律师。',

  // 云函数调用超时（毫秒）
  CLOUD_TIMEOUT: 20000,
}

},
"data/pick-summaries":function(module,exports,require){
module.exports = {"version":"v20261009-6e1d6fb","items":{"s01-2217227b90":"坐前排系上安全带，出车祸时被撞死的概率大约降一半。坐轻型卡车前排的降六成。美国 2022 年死在车里的人，能查到系没系带的，有一半没系。","s01-558cfe4e34":"把能要命的东西从手边拿走，这类做法的证据一直在变强：管住镇痛药以后，相关自杀降 43%；常有人跳楼的地方装上防护，降 86%。所以家里不囤安眠药和农药。想不开的时候先打 12356，全国通用，每天至少开 18 小时。","s01-cf65974741":"百草枯没有解药，喝下去的人四成多救不回来。它会让肺发炎、慢慢变硬，肾和肝也跟着受伤。煤气中毒被救回来的人，六周后将近一半脑子不如从前，做了高压氧的也还有四分之一。","s01-48cd893e44":"从高处摔下来进了创伤 ICU 的人，死亡的只有 5.5%，但伤得重、治得久。将近一半同时伤到三个以上部位，三分之一多上了呼吸机，最长的在 ICU 住了 132 天。一半人摔下来的高度不超过 3 米。伤得重的人，后来能回去上班的不到六成。","s01-57d62bb5f4":"辐射没有气味、颜色和温度，多数放射源就是一截普通金属，所以「看着没事」不能当判断。普通人撞上的概率极低，每年每万枚放射源出事不到 1 起。可一旦撞上就无法挽回，1987 年巴西有人把废弃诊所的放疗机当废铁拆开，最后 4 人死亡。","s03-8af5057ca4":"一次平均 2.8 秒的打断，就让接下来的操作出错概率翻倍。4.4 秒的打断翻三倍。现场跟踪还发现，被打断的那件事平均要 25 分钟才回得来，中间还插进两件别的事。被打断的人干得更快，但压力、挫败感和费劲程度全都更高。","s04-2198ae5435":"把「我要做这件事」改写成「周二早 8 点坐到书桌前就先写引言」。94 项检验合起来算，这么写的人把目标做成的比例明显更高，属于中到大的效果。改的只是一句话的写法，不花钱，也不费力气。","s04-ed6d0d7c43":"学生估自己 33.9 天写完论文，实际用了 55.5 天，只有 29.7% 的人按自己估的时间做完。另一组被要求先回想上次同类的事花了多久再估，按时完成的比例从 29.3% 升到 60.0%。","s05-9d2a40cb5a":"监管部门自己的说法是：收益率超过 6% 就要打问号，超过 8% 很危险，10% 以上就要准备赔光本金。正规理财已经不许承诺保本保收益了。参加非法集资亏掉的钱，按规定由你自己承担，出事没人替你兜底。","s05-93217d770b":"一年的费率每高 1 个百分点，20 年后到手的钱少约 18%，30 年后少约 26%。在同一类基金里挑费率低的，是这件事上唯一一个你能提前确定的东西。","s05-54028f4c53":"提前还房贷，等于稳稳赚到你的房贷利率。所以只问一件事：你能长期稳定拿到的税后收益，比房贷利率高吗？高就别急着还，不高或说不准就还。等额本息前几年利息占得多，越早还省得越多。银行 App 的「提前还款试算」能直接算出数字。","s05-40704fd6d9":"没写受益人，或者受益人先走了，保险金就算遗产，要先拿去还去世的人欠的债。受益人写了「妻子某某」，后来离婚了，出事时算没写。家里人要知道有这张保单：寿险从知道出事起 5 年内要去主张，其他保险是 2 年。","s05-ffc51a7ffb":"国内不承认虚拟货币是钱，个人买币的交易可以被判无效，亏了算自己的。有人跟人买泰达币，付了约 44.8 万元，后来平台提不了现，起诉要钱被法院驳回。被人偷走的是另一回事，偷的人照样按盗窃罪判。","s06-2bc771a7df":"多维、鱼油、维 D 这些常见成分，本节前六条已经一样样查过，都没看出管用。包装上那句「保健食品不是药物，不能代替药物治疗疾病」，是管保健食品的部门规定必须印的。这笔钱多半是买给父母、提着上门的，那份心意没有问题，只是东西选错了。","s07-c235f2bab4":"单位和你自己交满 1 年、又不是你主动提的辞职，办完失业登记就能领钱。交满 1 年不到 5 年，最多领 12 个月。满 5 年不到 10 年，最多 18 个月。10 年以上，最多 24 个月。领钱这段时间，职工医保有失业保险替你交。","s07-515c1ebaee":"讨薪、要赡养费、要社保或低保待遇、见义勇为受了损失，都能申请免费法律援助。打 12348，或者去当地的法律援助中心。现在不用回原籍开经济困难证明，本人如实说明就行。可能判死刑的，还有盲、聋、哑和未成年的被告人，一律指派律师。","s07-a1cfd3fb6d":"养老金按累计年限算，不按连续年限算，断了不清零，到退休年龄累计满 15 年就能按月领。职工医保交够年限的，退休后不用再交，各地的年限不一样，打 12393 问参保地。真正受影响的是买房、落户、积分这些要求连续缴费的资格。","s08-b0509eec4e":"跑了，这起事故就默认算你全责。驾照吊销，这辈子都不能再考。还有更现实的一层：车损险和三者险对逃逸一律不赔，几十万的赔偿全要自己掏。留在现场救人、报警，最多耗掉一两个小时。","s08-0766fb4c5f":"钱刚转出去的那一小段时间，是唯一的窗口。这段时间警方可以紧急止付、快速冻结，银行必须配合。等钱被层层转走、分散开，就基本追不回来了。所以先打 110 或者 96110，别自己先去查、先去问。96110 打进来的是警察在劝阻你，要接。","s08-7b61753d89":"把银行卡、手机卡、支付账号租给、借给、卖给别人，这件事本身就违法。罚违法所得的 1 到 10 倍，没有所得的最高罚 20 万元，情节严重的拘留 15 日，还会被记入信用记录、限制账户功能。要是明知对方拿去犯罪还帮着收钱转钱，就是帮信罪，判 3 年以下。","s08-140f94d4d0":"借条要写全：出借人、借款人、金额、利率、期限、还款方式，双方签名。钱走转账，不给现金，写全了才好起诉。替人担保时看清有没有「连带」两个字。一般保证是等债权人先告了借款人、执行不到钱，才轮到你。写了连带责任保证，债权人可以直接找你要。","s08-4c82d4ebc9":"民事诉讼时效 3 年，从你知道权利受损那天算起。过了期，法院不会主动管，可对方在法庭上说一句「超过时效」就够了，钱还在，只是要不回来。而一条留了痕迹的催款消息，就能让这 3 年从头重算。劳动争议是另一套，仲裁时效 1 年。","s08-c31079ff0e":"借婚姻索取财物是法律禁止的，法院支持返还。没登记的、登记了但确实没共同生活的、婚前给了彩礼导致给钱一方生活困难的，可以要求返还。已登记又共同生活的一般不返还。所以彩礼、三金、改口费都走转账并备注用途，谁给的钱谁留证据，男女一样。","s08-9ad9ade18f":"重婚的婚姻无效。有配偶还去结婚，或者明知对方有配偶还跟他结婚的，判 2 年以下。以结婚为幌子骗钱的，按诈骗罪追究：数额较大判 3 年以下，巨大判 3 到 10 年，特别巨大判 10 年以上或者无期。登记前看一眼对方身份证和户口簿上的婚姻状况。","s08-fb26c2433e":"法律预设法定代表人就是那个管事的人，「我只是挂个名、什么都不知道」不是免责的理由。法定代表人执行职务给别人造成损害，公司先赔，赔完可以回头找有过错的你追偿。已经挂了名的，公司法允许你辞掉，公司要在 30 日内定出新的法定代表人。","s08-2019f9e94d":"外交部领事司给出国公民的建议是：不要替别人携带行李物品，特别是违禁品，或者你并不了解的东西。行李里真查出毒品或者走私品，「我不知道里面装的什么」要你自己举证。国内代收快递也一样，尤其是让你先垫钱、事后退款的。","s08-66aace171f":"被拘留、逮捕后又撤案、不起诉或判无罪的，能申请国家赔偿。被关的日子按天赔，2026 年 5 月 18 日起每天 495.94 元，一年约 18 万元。后果严重的另给精神损害抚慰金。犯了事只因情节轻微不起诉的，不赔。过了追诉期、没到年龄、自己作假口供的也不赔。","s08-38b39acd2b":"四道门都是关着的。背着家人给他买以死亡为条件的保险，合同无效。投保人故意造成被保险人死亡的，保险公司不赔。故意杀害被继承人的，丧失继承权。刑法还把这种骗保单列一项，和故意杀人罪数罪并罚，最高死刑。钱一分拿不到。","s08-0dcedcafcb":"「花点钱把事摆平」在刑法里是独立的罪，被抓的不只是收钱那个人。行贿判 3 年以下。情节严重的判 3 到 10 年，特别严重的判 10 年以上或者无期。对监察、行政执法、司法人员行贿，还是明文从重的那一档。被勒索给了钱、又没拿到不正当利益的，不算行贿。","s09-f8e607b1c4":"自己看不在处罚条款里。往群里发一次就算向全群传播，拘留 10 到 15 日，再罚 5000 元以下，情节严重的判 2 年以下。卖「资源」挣钱的判 3 年以下，最重到无期。建 30 人以上的传播群，建群的、当管理员的、主要往里发的，都按犯罪算。","s09-40fbc68d03":"这类兼职挣的是几百块，代价是留一份案底。有人带着身份证和 1 张银行卡去指定地点，配合转账取款，挣了 500 多元。检察院没起诉他，公安还是拘留 10 日、罚 1000 元。另一人把自己和别人的银行卡、手机卡交给团伙收款取现，判 2 年 3 个月，罚 2.2 万元。","s09-202f9c5c62":"帮人「包装材料」去贷款、拿分成，按诈骗办。有个 126 人的团伙，把没工作的人包装成「优质客户」，在 80 多家银行骗贷 3000 多万元。出面签字的按贷款额拿三成好处费，已判的 80 人里 76 人判了 1 年 4 个月到 6 年 6 个月。钱贷在谁名下，债就是谁的。","s09-125ca634ab":"捡到东西留着自己用，金额到了「数额较大」又不肯交出来，判 2 年以下，数额巨大的判 2 到 5 年。拿捡来的银行卡去 ATM 取钱更重，算冒用别人的信用卡，数额较大就判 5 年以下，还要罚 2 万到 20 万元。取钱这一种警察直接立案，不用失主自己去告。","s09-f891d392ac":"往楼下扔东西，没砸到人也能拘留 5 日、罚 1000 元，情节严重的拘留 10 到 15 日。砸到人就换罪名了：有人在 21 楼酒后把空酒瓶、玻璃杯扔到楼下操场，砸中 13 岁学生致重伤，判 10 年。还有人从 32 楼扔 8 块砖头砸死 1 人，2024 年被核准死刑。","s09-aed51a26bd":"网上买的钢珠枪、气枪，枪口比动能到了 1.8 焦耳/平方厘米，就按枪支认定。没有许可拿在手里，判 3 年以下，情节严重的判 3 到 7 年。有对夫妇卖「玩具枪」，43 支里有 18 支被鉴定为枪，只因证明不了他们知情才没被起诉。","s09-68725fcd49":"偷拍、偷窥、散布别人的隐私，拘留 5 日以下或者罚 1000 元以下，情节较重的拘留 5 到 10 日。用专门的偷拍设备、造成严重后果的，判 2 年以下。有两人在三家酒店的房间装器材远程偷拍，分别判了 1 年 3 个月和 1 年。家里装监控不算，装在别人住的房间就算。","s09-1004e103cb":"吃国家重点保护动物，东西没收，再按价值罚 2 到 20 倍。收购、运输、出售珍贵濒危动物，判 5 年以下，情节严重的判 5 到 10 年。人工繁育、当宠物买卖的一般不算犯罪，有人卖了 40 多只人工繁育的鹦鹉，没被起诉。野外抓的、来路不明的不在此列。","s09-e8b67a701b":"把身份证借给、租给、转给别人，警告并罚 200 元以下。冒用别人的身份证，或者用骗领来的，罚 200 到 1000 元，或者拘留 10 日以内。买火车票、住店这类必须实名的场合用假证件或者别人的证件，情节严重的判拘役或者管制。","s09-bdee64583a":"对方不满 14 岁，不管她同不同意，都按强奸罪从重处理，基本刑期是 3 到 10 年。对方不满 12 岁的，一律认定你「应当知道」。12 到 14 岁的，从发育、举止、穿着能看出可能是幼女，你还下手，就认定你「明知」。说自己确实不知道，法院把关很严。","s09-bcda6af708":"编造事故、夸大损失去骗理赔，是保险诈骗罪，数额较大的判 5 年以下，再罚 1 万到 10 万元。帮你作证、鉴定、评估财产的人故意出假证明，和你一起按共犯定罪。安徽宣城一起案子里，8 个人被判 2 到 4 年，各罚 1 万元。","s09-a29e3d6f55":"活体器官只能捐给配偶、直系血亲或者三代以内的旁系血亲，买卖都违法。北京一起案子里，卖肾的人只拿到 2 万多，同一枚肾卖给病人要 18 万到 22 万。卖得的钱会被没收，再按交易额罚 10 到 20 倍。摘肾后身体的代价见第 1 节第 35 条（剩下那个肾替两个干活）。","s09-f845cecf77":"匕首、弹簧刀、警棍、电击器这类东西，带出门被查到，可以拘留 5 日以下。带进车站、商场、公交车，拘留 5 到 10 日。真拿出来用也容易吃亏：有人被空手打了一拳，就拿事先藏好的刀捅人，按防卫过当判了 4 年。","s10-06932c3d14":"婚前父母出钱买房，默认只给自己孩子。婚后出的钱没约定，按夫妻共同财产算。2025 年 2 月起，婚后一方父母全额出资、又没写明只给自己孩子的，离婚时法院可以把房判给出资方的孩子，再定补不补偿另一方。要算借款，就当天写清楚、双方签字。","s11-53b30cc098":"脚本不改内存、不破解，只是发请求比人快，一样会被定罪，挣到 5000 元或让对方损失 1 万元就够。有人用买来的 12306 账号代抢 200 多张票、挣了 2 万多，判 1 年 6 个月缓 1 年 6 个月、罚 5000 元。在网店卖抢票软件的，按不正当竞争赔了 2 万元。","s11-a5d5518057":"没经允许控制别人的电脑、服务器、摄像头，到 20 台就判 3 年以下，特别严重的判 3 到 7 年。够不上犯罪的，也要拘留 5 日以下，还可能罚 5 万到 50 万元。受过刑事处罚的人，终身不能干网络安全管理和网络运营的关键岗位。","s11-ef0b32f1d8":"自己搭线路出境，或者用国家公用信道以外的国际信道，公安可以责令停止联网、给予警告，罚 1.5 万元以下并没收违法所得。靠这个做生意的，办案机关可以按非法经营罪办，情节严重的判 5 年以下。这条讲的是卖和搭节点。个人自己用的，处罚以警告加罚款为上限。","s12-87d2394dfb":"名字登记在册，你在法律上就是股东。注册时答应出的钱要按期交齐，交不上除了补交还要赔公司的损失。公司开办时别的股东没真把钱交进来，缺多少你也跟着还多少。生意是别人做的，债记在你名下。","s12-9469e7c9e7":"前面几条罚的是钱，这条抓的是人。卖病死肉、检验不合格的肉，或者农残兽残重金属严重超标的东西，只要「足以」让人吃出严重中毒就够罪，不用真有人吃坏，判 3 年以下。往食品里掺有毒有害的非食品原料，起步就是 5 年以下，不看你卖了多少钱。","s12-9b64341686":"你要是按简易办法交税的小规模纳税人，一个月卖不到 10 万、一个季度卖不到 30 万，增值税就免了。本来按 3% 交的，同期也减到按 1% 交。反过来，「找人开票抵成本」就是虚开，起步判 3 年以下，还要罚 2 万到 20 万。","s12-dd52440bb8":"写「定金」这两个字才有双倍规则：你毁约，这笔钱要不回来；对方毁约，要退你双倍。超过合同金额 20% 的那部分不算。写成「订金」，法律上没有这套规则。给账期等于把自己的钱白借给对方，对方倒了就是坏账。","s13-ba9afbf7a8":"嘴歪、一侧胳膊抬不起、说话说不清，立刻打 120。发病 3 小时内打药通开血管，恢复到生活基本能自理的可能性大约是不打药的 1.75 倍。拖到 3 到 4.5 小时只剩 1.26 倍。超过 4.5 小时就看不出差别了。记下症状开始的准确时间。别喂水喂药，别自己开车。","s13-6f3a60744b":"只看「脸歪、抬手、说话」三条，一成多的卒中会被漏掉，因为有的卒中一开始既不歪嘴也不瘫手。把站不稳、看东西重影或缺一块也算进去，漏掉的降到 4.4%。突然天旋地转站不住、看东西成双、手指点不到自己鼻尖，一样打 120，一样记下时间。","s13-8c1b65597a":"胸口压着疼、闷、发紧，超过 15 分钟不缓解，打 120。到医院后 55 分钟内把血管撑开的，30 天内死亡 2.8%。超过 55 分钟的 9.7%。耽误的每一段，都在多坏死一块心肌。别自己开车，路上失去意识就是第二场事故。","s13-88eae1ef36":"撕裂一样的剧痛从胸口往后背、往腰一路挪，打 120 时直接说「像撕开一样，疼在往下走」。这病不手术、光吃药的死亡率 58%。它的处理和心梗正相反：医生想到它，才会去做增强 CT，而不是给你抗凝溶栓。两条胳膊血压差很多、一侧摸不到脉，也一起说出来。","s13-9d6e72e6e4":"受伤 3 小时内用凉的流动水冲够 20 分钟，后来需要植皮的可能性大约只有没冲的六成。是凉水不是冰水，冰敷会加重损伤。衣服粘在伤口上别硬撕，冲完拿干净布盖住去医院。牙膏、酱油、香油、面粉都不要抹。隔了一会儿才想起来，三小时内补冲仍然有用。","s13-369fd318cd":"突然全身起疹，再加上喘不上气或者发晕，就按过敏性休克办。立刻打 120，直接说「怀疑过敏性休克」，让急救带着肾上腺素来。抗过敏药和激素起效慢，替不了肾上腺素。有过一次的人找医生开自动注射笔，打大腿中外侧，隔着裤子也能打。","s13-78475ec93f":"先吃 15 克糖，方糖、一小盒果汁都行。15 分钟后再测一次，还低就再来一次。血糖低于 3.0 mmol/L 就是医学上要当回事的低血糖。到了要别人帮忙才能处理的程度，可以致命。意识不清的人一口都别喂，会呛进气管，直接打 120。","s13-41931b2317":"先断电，或者用干燥的木棍之类把电源挑开，再碰人。直接上手拉，一个伤者就变成两个。脱离电源后没有呼吸的，立刻按第 1 条（用力按压胸口）按压，别因为是电伤就不敢碰。高压线落地、变电设备附近不自己处置，退远等电力部门断电。","s13-e84db21bb2":"报警器响了，或者一屋子人同时头痛、恶心、发晕，先把人都带到室外，再打电话。别留在屋里找原因，也别回去关阀门。症状像感冒，「出门就好转」是最强的提示。中国 2018 年报告了 11523 人死于一氧化碳中毒，冬天最多，大多死在家里。","s13-c5091d2492":"误服清洁剂、农药、药物不要催吐，腐蚀性液体吐出来会把食管再烧一遍。先喝适量牛奶或者蛋清，带上瓶子和说明书立刻去医院。溅到皮肤或者眼睛，用大量清水至少冲 15 分钟，眼睛要撑开眼皮冲、不要揉。消毒液和洁厕剂混着用会产生氯气。","s13-49431ea2e8":"三步。第一步，立刻脱掉沾上的衣服鞋袜，衣服兜住的地方伤得最重。第二步，用大量流动清水冲，皮肤和眼睛都至少 15 分钟，湖南省应急管理厅给到 20 到 30 分钟，按长的那个来。第三步，眼睛撑开眼皮冲，冲完直接去眼科。用常温水，不用热水。","s13-0b135c8272":"皮肤烫红、说话含糊、意识混乱是热射病。从头晕到昏迷可以只有几十分钟，病死率极高。立刻挪到阴凉通风处、脱掉衣服、用凉水和湿毛巾降温，同时打 120。意识不清的一口水都不要喂，会呛。","s13-5f368421d7":"先问「你噎住了吗，能说话吗」。还能用力咳、能出声的不要动手，让他咳。说不出话就站到背后，5 次拍背接 5 次腹部冲击，反复做到东西出来或者人倒下。倒下就做心肺复苏，同时叫人打急救电话。孕妇和很胖的人改冲胸口。别伸手去嘴里掏看不见的东西。","s13-fc1b6b8dd0":"孩子还能咳、能哭出声，就让他自己咳，你在旁边盯着。哭不出声、脸发紫，就让人打 120，你把孩子脸朝下趴在前臂上，用掌根在两块肩胛骨中间拍 5 下。没出来就翻过来，在胸口正中快速按 5 下，两样轮着做，别按肚子。孩子没反应了就改做心肺复苏。","s14-97c93a35ce":"二次验证是指登录时除了密码，还要再确认一次是不是本人。用手机上弹个窗、你点一下确认的办法，九成以上的钓鱼盗号都被拦住了。靠回答「上次在哪登的」「备用邮箱是什么」这种老办法，钓鱼盗号只能拦下一成左右。","s14-f2d22d7fd1":"SIM 卡就是手机里那张小卡片，短信验证码靠它来收。手机丢了，捡到的人会把这张卡拔下来，插进别的手机收验证码，再挨个重置你的账号。给卡设一个 PIN 码，卡换到别的手机上，一开机就要先输这个码，这条路就断了。","s14-4d56bcb37e":"顺序比手快更重要。第一步挂失 SIM 卡，验证码这条命脉就断了。接着远程锁住手机，再用电脑改邮箱和支付密码，然后报警拿回执，最后看情况冻结银行卡。手机不在身上，借别人的手机打运营商客服也能挂失。","s16-7805e295b3":"高血压、糖尿病、恶性肿瘤门诊放化疗、尿毒症透析、器官移植后抗排异，这五种在外地看门诊也能直接刷医保。不用先自己垫钱，再回参保地报销。但要先在参保地办门诊慢特病认定，再办异地就医备案。两件事都办了才管用。","s18-0d503da3d4":"孩子在 2025 年 1 月 1 日以后出生、还不满 3 周岁，就能领这笔钱。父母中的一个人去孩子户口所在地申请。每个孩子每年 3600 元，一直领到 3 岁。这笔钱不用交个人所得税。申请低保这类救助时，也不算进你家的收入。","s18-ab62afc77b":"生孩子至少能休 98 天产假，其中产前可以先休 15 天。难产再加 15 天。每多生一个孩子，也再加 15 天。这段时间发的钱叫生育津贴，由生育保险基金出。单位没给你上生育保险的，就由单位自己发。","s18-269140fa29":"怀孕、生孩子、喂奶这几段时间里，单位给你降工资或者把你辞了，都是违法的，要按每人 1000 到 5000 元罚款。孩子不满一周岁的，你每天有 1 小时喂奶时间，单位也不能安排你加班和上夜班。索赔怎么走见第 19 节。","s19-b5939ba6a9":"被裁时公司要给的经济补偿这样算：干满一年给一个月工资，满半年不满一年按一年算，不满半年给半个月。这里的月工资是走人前 12 个月的平均数，奖金、津贴、补贴都要算进去。工资高过当地上年度月平均工资 3 倍的按 3 倍封顶，年限最多算 12 年。","s19-ec448c4447":"突发不适往公司赶，不会让你多拿一笔钱。视同工伤要求人在工作时间、又在工作岗位上发病，路上发病没到岗的本来就不算。抢救超过 48 小时的反而也不算。为了凑条件耽误的那几十分钟，换掉的是自己的存活率。","s19-fae04a2999":"因为解除劳动合同拿到的一次性补偿，在当地上年职工平均工资 3 倍以内的部分不交个税。超出的部分单独算税，不和当年工资加在一起。单位要是把整笔并进当月工资扣了税，先找单位问清楚，再打 12366 问税务局。","s19-ac34a8b938":"换城市工作，养老和医保关系都能跟着你走，以前交的年限接着往上加。没到领养老金的年龄，不能办退保把钱取出来。医保断交超过 3 个月，到新地方可能要等最多 6 个月才能报销，所以中间别空太久。","s20-27d79b033a":"孩子出生后 24 小时之内要打上第一针乙肝疫苗。在婴儿期和幼儿期感染乙肝的人里，约有 95% 会转成慢性肝炎。成年以后才感染的，绝大多数能自己好。所以这一针越早打越有用。妈妈乙肝表面抗原是阳性的，孩子还要同时打乙肝免疫球蛋白。","s20-9290c96807":"新生儿身体里存的维生素 K 很少，不补可能出血，晚出现的那种常常是脑子里出血。在没普遍打这一针的地方，每 10 万个新生儿有 478 个出这种血。打了这一针，估计能少掉七成八以上。国内正规医院会常规打，在家生或在不正规机构生的，要主动问一句打了没有。","s21-9da0b03a69":"外交部把国外的安全风险分成四档，最高的一档叫「暂勿前往」。2026 年 9 月 15 日起，避开高风险的国家和地区写进了行政法规。办证件和出境过关的时候，工作人员还会提醒你，必要时会劝你别去。出发前翻一遍那一页，几分钟的事。","s21-739aecda2e":"网上代办的「国际驾照」在中国内地不成立。那本证是 1949 年日内瓦公约缔约方之间互认的翻译件，103 个缔约方里没有中国内地。所以国内不管谁给你办，都没有法律效力。能不能用中国驾照开车，看目的地自己的规定，没确认清楚就别开。","s22-277e349096":"按规定，娱乐场所营业时，疏散通道和安全出口必须畅通。不许封堵，不许上锁，不许摆东西挡路，也不许遮住指示标志。网吧同样不许封门锁窗。做不到就是违法，你可以举报。包厢在地下、只有一个出口、走道堆满杂物的，换一家。","s22-8662c641e3":"现在的毒品不长毒品的样子。掺了合成大麻素的「上头」电子烟，看着和普通电子烟差不多，有人专在酒吧、KTV、宾馆里递给人试。骗人吸的拘留 10 到 15 日、罚 1000 到 5000 元，被骗吸了的人也要拘留 10 到 15 日。饮料离开过视线就换一杯。","s23-5e550572ab":"初中毕业一般 15 到 16 岁，正好卡在这条线上。不满 16 岁，单位招你就是违法，每用一名童工每月罚 5000 元。所以肯要你的，都是明知违法还敢用的单位。真出了事，医药费和赔偿只能找这家单位要，它赖账或者跑了，就没人替它兜底。","s23-140b427518":"公办中职里，农村学生、城市涉农专业学生和家庭困难学生已经免学费。中职和普通高中的助学金，2025 年春季起每年 2300 元。上了大学，助学金每年 3700 元，助学贷款每年最多能借 2 万。钱不够可以推迟、可以换个办法，很少到必须现在退学去打工的地步。","s23-906deaedd5":"按全世界平均算，多读一年书，个人收入每年高约 9%，女性的回报一直高于男性。这个数说的是正规上学，报一个班不能直接套。拿它当尺子：一个课程要你花 3 万元和半年，就问它带来的收入变化抵不抵多读一年书。","s27-5dc1a00290":"第一次产检就把艾滋病、梅毒、乙肝这三样查掉，检测不用自己掏钱。真查出来也不是绝路。国家免费给药、给方案，挡住病从母亲传给孩子的那条路，这叫母婴阻断。","s27-4f1436397e":"任何一条出现，当天就去医院，别在家等一晚。头痛不好或越来越重、看东西变样、发烧到 38 ℃。手或脸肿得厉害、喘不上气、胸痛或心跳快。肚子剧痛不缓解、胎动停了或明显变少、阴道出血或流液。一条胳膊或腿又肿又痛、想伤害自己或孩子。产后一年内也算。","s27-ed12b30478":"破水了不是慢慢收拾东西再出发。正确做法是就地躺下、把屁股垫高、打 120。站着走动，羊水流得更快，脐带可能跟着被冲下来。那是能要孩子命的急症。","s28-c0c0bf6ade":"神经性厌食的人，死亡概率大约是同龄人的 5.9 倍。每 1000 个人跟一年，死 5.1 个。死的人里每五个有一个是自杀。而它的入口就是节食：跟踪 44 所中学的学生三年，严重节食的女生出现进食障碍的概率是不节食的 18 倍。想控制体重就多运动，别少吃到饿。","s28-7818a672c4":"动针、动刀、用医疗器械，会破皮或进到身体里的，就算看病。只能在许可证上写了「医疗美容」的机构做，动手的必须是注册过的执业医师。在美容院、工作室、酒店房间里做属于非法行医。动手的人情节严重判 3 年以下，伤了人判 3 到 10 年，致人死亡判 10 年以上。","s28-2534bd3994":"打填充针后失明的人里，一半多打的是鼻部，其次是眉间、额头和法令纹，八成多用的是玻尿酸。失明的人只有两成视力完全恢复，一成多部分恢复，将近两成还伤到了脑。目前没有一种抢救办法稳定管用，只能事先避开这些部位。","s29-64aef6e310":"亲人去世后头一天，心梗发作的概率是平时的 21.1 倍，之后一天比一天低。60 到 89 岁的人在伴侣去世后 30 天内，心梗或中风的比例大约翻倍，一个月后回落。本来就有心血管病的人，这几天别停药。胸口压着疼、喘不上气、一侧手脚没力，立刻打 120。","s29-7916e443ae":"拿到癌症诊断的第一周，自杀的概率是没确诊的人的 12.6 倍，死于心血管病的概率是 5.6 倍。到第一年，自杀风险降到 3.1 倍，越难治的癌越明显。所以拿报告那天带个人去，回家别一个人待着。辞职、卖房这类事，留到下次门诊再说。","s29-928ae6e5b5":"寿险合同两年内自杀的不赔，只退保单里能退的那点钱。工伤也不认，工亡的三笔钱一分没有。欠的债先从你留下的遗产里扣，家里人只拿剩下的。他们还要承受本节第 4 条（因自杀或暴力死亡丧亲）说的那份健康代价。","s30-5a36e625e8":"有些病是按小时算的。男孩突然一侧阴囊剧痛，是睾丸扭转，也就是睾丸连着的那根血管拧住了，血供断了。6 小时内处理，睾丸保住的比例 97.2%。拖到 19 至 24 小时，只剩 42.5%。这种痛等不到放学，也等不到考完。","s30-3c45220b5b":"近视不会自己好，度数也降不回去。它也不只是「戴个眼镜」的事。和不近视的人比，得近视性黄斑病变的可能，轻度近视高十几倍，600 度以上高几百倍。视网膜脱离，轻度高约 3 倍，600 度以上高约 13 倍。所以孩子近视得越早、涨得越快，将来要担的风险越大。","s31-e140615f58":"报了名又拒绝去当兵，后果是一串。公务员不能录用你，国有企业和事业单位也不能招你。两年内不准出境，不准升学，不准回学校复学。还会被列进履行国防义务严重失信主体名单。所以「先报上再说，不行就退回来」是个很贵的想法。","s31-c5a267c5f0":"在校生、应届毕业生和新生去当兵，国家替你出读书那几年的学费，按实际交的补，本专科生每年最高 20000 元，研究生最高 25000 元。学费本来就低的，只补到实际交的那么多。学籍给你留两年。考研另有一条只招退役大学生士兵的专项计划。","s31-9b29666d89":"「当兵包分配」早就不是普遍情况。现在只有六种情况由政府安排工作，义务兵服两年退役，绝大多数不在这六种里面。不由政府安排工作的那一档叫自主就业，它有个硬期限：退出现役之后 30 日内必须去报到。没有正当理由超过 30 日，就算你放弃安置待遇。","s31-2fd543aca9":"出国打工这件事，法律管的不是你，是组织你出去的那家公司。只有拿到对外劳务合作经营资格证书、又办了登记的企业才能干这个。听到「先办旅游签过去再转工签」，这句话本身就说明对方在违法。公司也不得以任何名目向你收押金，或者要你拿财产做担保。","s32-3cfea0a1c8":"回国以后，这张文凭要用来考公、进国企、落户、评职称，就得先过一道认证。认证由教育部留学服务中心做。学校不在能认证的名单里，学费和时间就白花了，文凭在国内用不上。查名单不花钱，查完再交学费。","s32-332f796d93":"美国原本要把 F-1 改成最长四年、读完 30 天内走。生效前一天，联邦法院把它暂停了。所以眼下还是老规矩：读多久算多久，读完有 60 天准备走人。暂停不是废除，政府还能上诉，规矩随时可能再变。","s32-3e5f90e93e":"能不能打工，看你是不是正在全日制上学。一旦休学、退学、被开除，或者转学期间没在上课，打工资格当场就没了。这时候接着干，就是非法打工。很多人以为签证没到期就没事，其实身份早断了。","s33-9aaaba66ee":"脊髓损伤的人，身体的报警线路断了一截。膀胱憋着、衣服勒着，本人可能没感觉，血压却会猛往上冲。信号是突然剧烈头痛和出汗。这时先把人扶坐直、松开勒紧的衣物、看是不是憋着尿，同时叫 120。","s33-34373af9df":"家属或单位一句话，不能把一个人留在精神病院住院。法律只认两种情况：已经伤害自己或有这个危险，已经危害别人或有这个危险。第一种要监护人同意才能收。对诊断有异议的，三天内可以要求再次诊断，之后还能自己委托鉴定。","s34-17748e92c3":"很多感冒药里都掺了对乙酰氨基酚，两盒一起吃就是吃了双份，过量会伤肝。在美国，它造成的急性肝衰竭病人里，近三成没等到换肝就死了。国内说明书建议一天最多吃 2 克，吃药期间也别喝酒。","s34-31a7010e0f":"孩子退烧，这三种药都别用。阿司匹林和瑞氏综合征有关，这种病伤脑伤肝，美国统计里约三成病孩死亡，警告发出后病例少了九成多。尼美舒利 12 岁以下禁用，安乃近 18 岁以下禁用。","s34-abc3013edb":"布洛芬、萘普生、阿司匹林这类止痛药会伤胃。在大剂量的试验里，吃布洛芬的人胃出血、穿孔的风险是不吃的约 4 倍。年纪大、胃出过血、同时吃抗凝药或激素、每天喝酒的人，风险更高。"}}

},
"data/reading-pack":function(module,exports,require){
module.exports = {"title":"便携阅读包","priceFen":100,"paymentEnabled":false,"contentDate":"2026-10-09","version":"v20261009-6e1d6fb","sections":34,"items":676,"docs":9,"themeNames":["家庭安全","钱与保障","求职与工作","租房生活","看病就医","账号安全"],"samples":[{"num":1,"title":"系安全带，前排后排都系","fields":{"成本":"<p>不花钱。每次上车多花 2 秒。</p>","说人话":"<p>坐前排系上安全带，出车祸时被撞死的概率大约降一半。坐轻型卡车前排的降六成。美国 2022 年死在车里的人，能查到系没系带的，有一半没系。</p>","收益":"<p>美国交通安全主管部门（NHTSA）估计，系安全带能让轿车前排乘员受致命伤的风险下降 45%。轻型卡车前排下降 60%。2022 年美国死在乘用车（载人的小汽车）里的人当中，能查到系没系带的，有 50% 没系。世界卫生组织（WHO）的口径是，安全带让车内人员的死亡风险最多降低 50%。WHO 估计中国 2021 年死于道路交通事故的有 248,099 人，相当于每 10 万人里死 17.4 人</p>","证据等级":"<p>A</p>","来源":"<p>NHTSA (2024). Occupant Protection in Passenger Vehicles: 2022 Data (DOT HS 813 573). <a class=\"ext\" href=\"https://crashstats.nhtsa.dot.gov/Api/Public/ViewPublication/813573\">https://crashstats.nhtsa.dot.gov/Api/Public/ViewPublication/813573</a> ; WHO (2025). Road traffic injuries fact sheet. <a class=\"ext\" href=\"https://www.who.int/news-room/fact-sheets/detail/road-traffic-injuries\">https://www.who.int/news-room/fact-sheets/detail/road-traffic-injuries</a> ; WHO GHO RS_196/RS_198 (China, 2021). <a class=\"ext\" href=\"https://ghoapi.azureedge.net/api/RS_196?$filter=SpatialDim%20eq%20%27CHN%27\">https://ghoapi.azureedge.net/api/RS_196?$filter=SpatialDim%20eq%20%27CHN%27</a></p>","备注":"<p>后排也要系。同一份报告里，第二排被撞死的人有 60% 没系带。45%、60% 这两个数，是美国交通安全主管部门（NHTSA）拿事故数据库算出来的估计（引 Kahane 2015），不是随机分组的试验。WHO 那个中国死亡人数是推算出来的，比公安交管登记的数字高好几倍。两边统计的范围不一样，这里只用 WHO 的口径。</p>"},"dispute":false,"todo":false},{"num":2,"title":"骑摩托车、电动自行车戴头盔并扣好","fields":{"成本":"<p>买一顶 100 到 300 元。每次戴上花 5 秒。</p>","说人话":"<p>戴头盔并且把扣带扣好，摩托车骑手出事时死亡的概率低约四成。头部受伤低约七成。扣带要系紧，松松垮垮挂在头上不算戴。</p>","收益":"<p>Cochrane 把多项研究合起来一起算。摩托车骑行者戴头盔，死亡风险下降 42%。原值 <a class=\"gl\" href=\"gloss://OR\">OR</a> 0.58，可信范围 <a class=\"gl\" href=\"gloss://95% CI\">95% CI</a> 0.50 到 0.68。头部损伤下降 69%（OR 0.31，95% CI 0.25 到 0.38）</p>","证据等级":"<p>A</p>","来源":"<p>Liu BC 等 (2008). Helmets for preventing injury in motorcycle riders. Cochrane Database of Systematic Reviews. <a class=\"ext\" href=\"https://doi.org/10.1002/14651858.CD004333.pub3\">https://doi.org/10.1002/14651858.CD004333.pub3</a></p>","备注":"<p>头盔要把扣带扣好，挂在车把上不算戴。上面的数据来自摩托车。电动自行车没有直接研究，是照着推过来的，因为撞上以后头部受伤的方式相同。</p>"},"dispute":false,"todo":false},{"num":3,"title":"装烟雾报警器；冬天在室内烧煤、用燃气取暖的再装一氧化碳报警器","fields":{"成本":"<p>烟雾报警器一个 30 到 100 元。一氧化碳报警器一个 50 到 150 元。装好以后每年换一次电池。</p>","说人话":"<p>一个能正常工作的烟雾报警器，能把住宅火灾里死亡的概率降约六成。起火时有四成人在睡觉，光靠鼻子是醒不过来的。冬天在屋里烧煤或用燃气的，再加一个一氧化碳报警器。中国 2018 年有 1.15 万人死于一氧化碳中毒，冬天那三个月七成死在家里。</p>","收益":"<p>美国北卡罗来纳州研究了一批住宅火灾，回头比对出事和没出事的家庭。家里有一个能正常工作的烟雾报警器，死亡风险下降约六成。原值 <a class=\"gl\" href=\"gloss://OR\">OR</a> 0.39，可信范围 <a class=\"gl\" href=\"gloss://95% CI\">95% CI</a> 0.18 到 0.83。美国 2018 到 2020 年，有人住的住宅里发生的致死火灾，24% 家里没有烟雾报警器，41% 起火时人在睡觉。中国 2018 年报告一氧化碳中毒死亡 11,523 例。这些死亡里，12 月有 72.59%、1 月有 67.42%、2 月有 66.48% 发生在家中</p>","证据等级":"<p>B</p>","来源":"<p>Marshall SW 等 (1998). Fatal residential fires: who dies and who survives? JAMA. <a class=\"ext\" href=\"https://doi.org/10.1001/jama.279.20.1633\">https://doi.org/10.1001/jama.279.20.1633</a> ; USFA (2022). Fatal Fires in Residential Buildings (2018-2020), Topical Fire Report Series 22(2). <a class=\"ext\" href=\"https://www.usfa.fema.gov/downloads/pdf/statistics/v22i2.pdf\">https://www.usfa.fema.gov/downloads/pdf/statistics/v22i2.pdf</a> ; You J 等 (2020). Number of Deaths due to Carbon Monoxide Poisoning by Month and by Place of Death — China, 2018. China CDC Weekly. <a class=\"ext\" href=\"https://doi.org/10.46234/ccdcw2020.008\">https://doi.org/10.46234/ccdcw2020.008</a></p>","备注":"<p>给 B 的原因：烟雾报警器这边只有一项研究，做法是回头比对出事和没出事的家庭，不是随机分组的试验。一氧化碳报警器本身没有降低死亡率的研究。这里的收益是按「中毒死亡集中在冬季、集中在家中」推出来的。</p>"},"dispute":false,"todo":false}],"files":[{"name":"book.pdf","bytes":6284546,"sha256":"bc5bbbc0588a8d0a6bf08da253441d0344bf3ff818812ce0320bea5483acc1ae"},{"name":"themes.pdf","bytes":695251,"sha256":"27e60092925842b20e842e6eadd38c06daee8f372844815e9439630e5d0f8fe1"},{"name":"sample.pdf","bytes":243672,"sha256":"e454e70790f21fa0a007764188dde115cd41ef4977b3b549396973eee2aeb5ec"}]}

}};const cache={};function load(name){if(cache[name])return cache[name].exports;const module={exports:{}};cache[name]=module;factories[name](module,module.exports,function(spec){const base=name.split("/");base.pop();spec.split("/").forEach(part=>{if(part==="..")base.pop();else if(part!==".")base.push(part)});return load(base.join("/"))});return module.exports}window.demoModules={store:load("utils/store"),favorites:load("utils/favorites"),advice:load("utils/advice"),refs:load("utils/refs"),help:load("utils/reading-help"),sectionGuide:load("utils/section-guide"),share:load("utils/share"),shareCover:load("utils/share-cover"),packData:load("data/reading-pack")}})();