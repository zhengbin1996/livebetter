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
