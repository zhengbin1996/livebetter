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
  return read(FAV_KEY, {})
}

function isFavorite(sid) {
  return !!getFavorites()[sid]
}

/** 返回收藏后的状态 */
function toggleFavorite(sid) {
  const fav = getFavorites()
  let on
  if (fav[sid]) {
    delete fav[sid]
    on = false
    push('favorite', sid, { removed: true, at: new Date().toISOString() })
  } else {
    const at = new Date().toISOString()
    fav[sid] = { at }
    on = true
    push('favorite', sid, fav[sid])
  }
  write(FAV_KEY, fav)
  return on
}

function removeFavorite(sid) {
  const fav = getFavorites()
  if (!fav[sid]) return
  delete fav[sid]
  write(FAV_KEY, fav)
  push('favorite', sid, { removed: true, at: new Date().toISOString() })
}

/* ---------------------------------------------------------------- 打卡 */

function getCheckins() {
  return read(CHECK_KEY, {})
}

function getCheckin(sid) {
  return getCheckins()[sid] || null
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

function bumpDay(delta) {
  const days = read(DAYS_KEY, {})
  const k = dayKey(new Date())
  days[k] = Math.max(0, (days[k] || 0) + delta)
  const keys = Object.keys(days).sort()
  while (keys.length > DAYS_MAX) delete days[keys.shift()]
  write(DAYS_KEY, days)
}

/**
 * 连续天数：从今天往回数，遇到第一个「有做到」的日子起算、到第一个空日止。
 * 今天还没做**不算断**（一天才过了一半就判人断签不合理），
 * 所以从今天开始找第一个非零日，再往前连续数。
 */
function dayStats() {
  const days = read(DAYS_KEY, {})
  const today = days[dayKey(new Date())] || 0
  const d = new Date()
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
  const all = getCheckins()
  const prev = all[sid] || { done: false, plan: 'today', note: '' }
  const next = Object.assign({}, prev, patch, { updatedAt: new Date().toISOString() })
  if (next.plan !== 'later') next.plan = 'today'
  all[sid] = next
  write(CHECK_KEY, all)
  // 只有 done 真的翻转时才动「完成日记」，否则改备注之类也会虚增连续天数
  if (!!prev.done !== !!next.done) bumpDay(next.done ? 1 : -1)
  push('checkin', sid, next)
  return next
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
  const all = getCheckins()
  if (!all[sid]) return
  const wasDone = !!all[sid].done
  delete all[sid]
  write(CHECK_KEY, all)
  if (wasDone) bumpDay(-1)
  push('checkin', sid, { removed: true, updatedAt: new Date().toISOString() })
}

/* ---------------------------------------------------------------- 云端同步 */

const pending = []

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
async function flush() {
  if (!pending.length) return
  const batch = pending.splice(0, pending.length)
  const fav = {}
  const checks = {}
  for (const p of batch) {
    if (p.kind === 'favorite') fav[p.sid] = p.payload
    else checks[p.sid] = p.payload
  }
  try {
    await cloud.call('getUserData', { op: 'merge', favorite: fav, checkin: checks }, { timeout: 10000 })
  } catch (e) {
    // 放回队列头部，下次再试
    pending.unshift(...batch)
  }
}

/**
 * 进页面时与云核对一次：以 updatedAt 较大者为准，避免多端互相覆盖。
 */
async function pull() {
  try {
    const res = await cloud.call('getUserData', { op: 'read' }, { timeout: 10000 })
    if (!res || !res.ok) return { ok: false }
    const localFav = getFavorites()
    const localCheck = getCheckins()
    const cloudFav = res.favorite || {}
    const cloudCheck = res.checkin || {}

    // 收藏：并集（任一端有就算收藏，除非 Cloud 明确标记了删除时间更晚）
    const fav = Object.assign({}, localFav)
    Object.keys(cloudFav).forEach((sid) => {
      const c = cloudFav[sid]
      const l = fav[sid]
      if (c && c.removed) {
        if (!l || !l.at || (c.at && c.at > l.at)) delete fav[sid]
        return
      }
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
  const fav = getFavorites()
  const check = getCheckins()
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
  setCheckin,
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
