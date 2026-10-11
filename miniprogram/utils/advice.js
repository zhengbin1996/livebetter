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
