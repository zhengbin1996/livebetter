/**
 * 展示层格式化。所有「标注类」数据（成本签、条号、证据等级、版本号）
 * 都在这里统一成等宽字体要用的短字符串。
 */

const TIER_TEXT = { '极高': '极高', '高': '高', '一般': '一般' }
const TIER_RANK = { '极高': 3, '高': 2, '一般': 1 }

/** 成本签五格：钱 / 时间 / 毅力 / 收益 / 口径 */
function costStrip(tag, labelMap) {
  const t = tag || {}
  const L = labelMap || {}
  const money = t.money || '0'
  const time = t.time || '少'
  const will = t.will || '否'
  return [
    { k: '钱', v: money === '0' ? '不花' : money, tone: money === '0' ? 'g' : '' },
    { k: '时间', v: time, tone: time === '少' ? 'g' : '' },
    { k: '毅力', v: will === '否' ? '不用' : will, tone: will === '否' ? 'g' : '' },
    { k: '收益', v: t.benefit || '—', tone: t.benefit === '大' ? 'g' : '' },
    { k: '口径', v: (L.caliber && L.caliber[t.caliber]) || t.caliber || '—', tone: '' },
  ]
}

function tierRank(tier) {
  return TIER_RANK[tier] || 0
}

function evidenceText(level) {
  return level === 'A' ? 'A 级 · 有具体数字可查'
    : level === 'B' ? 'B 级 · 有研究但数字不确切'
      : 'C 级 · 作者经验或公认做法'
}

function pad2(n) {
  return n < 10 ? `0${n}` : `${n}`
}

function parseDate(s) {
  if (!s) return null
  if (s instanceof Date) return s
  // iOS 不认 "2026-10-09 12:00"，统一转成 ISO
  const iso = String(s).replace(' ', 'T')
  const d = new Date(iso)
  return isNaN(d.getTime()) ? null : d
}

function fmtDate(s) {
  const d = parseDate(s)
  if (!d) return ''
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function fmtDateTime(s) {
  const d = parseDate(s)
  if (!d) return ''
  return `${fmtDate(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

function fmtMd(s) {
  const d = parseDate(s)
  if (!d) return ''
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function relTime(s) {
  const d = parseDate(s)
  if (!d) return ''
  const diff = Date.now() - d.getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小时前`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day} 天前`
  return fmtDate(d)
}

function fmtBytes(n) {
  if (!n) return '0 KB'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** 「第 5 节第 12 条」这种面包屑 */
function crumb(sec, num, secTitle) {
  return secTitle ? `${pad2(sec)} · ${secTitle} · 第 ${num} 条` : `第 ${sec} 节第 ${num} 条`
}

function secName(sec) {
  return pad2(sec)
}

module.exports = {
  TIER_TEXT,
  costStrip,
  tierRank,
  evidenceText,
  fmtDate,
  fmtDateTime,
  fmtMd,
  relTime,
  fmtBytes,
  crumb,
  secName,
  pad2,
}
