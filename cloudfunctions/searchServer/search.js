/**
 * 检索的纯逻辑层（不依赖 wx-server-sdk，可本地单测）。
 *
 * 这一层负责：归一化 → 切词 → 打分 → 生成可读摘要。
 * I/O（拉语料、缓存、云函数入口）都在 index.js，好让这里能被 node 直接跑。
 *
 * 归一化口径与构建期 build/common.py 的 chars_for_search 严格一致：
 * 小写、全角 ASCII 转半角、去掉所有空白。两端一致才能保证
 * 「搜低钠盐」命中排版里写成「低钠 盐」的原文。
 */

const MAX_HITS = 200
const SNIPPET_LEN = 96
const MAX_DOC_HITS = 20

/** 字段权重：命中越靠前的字段分越高，决定结果排序 */
const FIELDS = [
  { key: 'tn', weight: 100 }, // 标题
  { key: 'p', weight: 44 }, // 说人话
  { key: 'b', weight: 20 }, // 收益
  { key: 'm', weight: 10 }, // 备注
  { key: 'u', weight: 10 }, // 成本
  { key: 'src', weight: 5 }, // 来源
]

/** chars_for_search 的 JS 版 */
function normalize(s) {
  const t = String(s == null ? '' : s).toLowerCase()
  let out = ''
  for (let i = 0; i < t.length; i++) {
    const code = t.charCodeAt(i)
    if (code >= 0xff01 && code <= 0xff5e) out += String.fromCharCode(code - 0xfee0)
    else if (/\s/.test(t[i])) continue
    else out += t[i]
  }
  return out
}

/** 归一化，同时记录「归一化后第 k 个字符」对应原文的下标，用于回定位片段 */
function normalizeWithMap(plain) {
  const src = String(plain == null ? '' : plain).toLowerCase()
  const chars = []
  const pos = []
  for (let i = 0; i < src.length; i++) {
    if (/\s/.test(src[i])) continue
    const code = src.charCodeAt(i)
    chars.push(code >= 0xff01 && code <= 0xff5e ? String.fromCharCode(code - 0xfee0) : src[i])
    pos.push(i)
  }
  return { norm: chars.join(''), pos }
}

/** 把查询串切成若干「与」关系的词：空格 / 中英文逗号 / 顿号 / 分号 / 加号 */
function toTerms(raw) {
  return String(raw == null ? '' : raw)
    .split(/[\s,，、;；+]+/)
    .map(normalize)
    .filter(Boolean)
}

function clip(s, n) {
  const t = String(s || '').trim()
  return t.length <= n ? t : t.slice(0, n) + '…'
}

/** 在明文里截一段可读摘要，尽量把命中词包进去 */
function snippetOf(plain, termNorms, fallback) {
  const src = String(plain == null ? '' : plain)
  if (!src) return fallback || ''
  const map = normalizeWithMap(src)
  let at = -1
  for (const n of termNorms) {
    const i = map.norm.indexOf(n)
    if (i >= 0 && (at < 0 || i < at)) at = i
  }
  if (at < 0) return clip(src, SNIPPET_LEN)
  const plainAt = map.pos[at] == null ? 0 : map.pos[at]
  const half = Math.floor(SNIPPET_LEN / 2)
  const s = Math.max(0, plainAt - half)
  const e = Math.min(src.length, plainAt + SNIPPET_LEN)
  return (s > 0 ? '…' : '') + src.slice(s, e).trim() + (e < src.length ? '…' : '')
}

/** 三维成本标签转成给人看的对象 */
function tagOf(it) {
  const tg = it.tg || ['', '', '']
  return { money: tg[0], time: tg[1], will: tg[2], benefit: it.g || '', caliber: it.cal || '' }
}

function passFilters(it, f) {
  if (!f) return true
  if (f.sec != null && f.sec !== '' && Number(f.sec) !== it.s) return false
  if (f.evidence && it.e !== f.evidence) return false
  if (f.tier && it.r !== f.tier) return false
  if (f.caliber && it.cal !== f.caliber) return false
  if (f.cost) {
    const tg = it.tg || ['', '', '']
    if (f.cost.money && tg[0] !== f.cost.money) return false
    if (f.cost.time && tg[1] !== f.cost.time) return false
    if (f.cost.will && tg[2] !== f.cost.will) return false
  }
  return true
}

/** 命中一条建议：返回分数；有任一词找不到就返回 -1（「与」语义） */
function scoreItem(it, termNorms) {
  let score = 0
  for (const term of termNorms) {
    let best = 0
    for (const f of FIELDS) {
      const hay = it[f.key]
      if (hay && hay.indexOf(term) >= 0) {
        best = f.weight
        break
      }
    }
    if (!best) return -1
    score += best
  }
  // 同分时让性价比高、证据强的略靠前，贴合这本工具书的排序偏好
  if (it.r === '极高') score += 6
  else if (it.r === '高') score += 3
  if (it.e === 'A') score += 3
  return score
}

/** 条目筛选是否「全空」——只有全空时才附带长文结果（长文没有这些维度） */
function noItemFilter(f) {
  if (!f) return true
  if (f.sec || f.evidence || f.tier || f.caliber) return false
  if (f.cost && (f.cost.money || f.cost.time || f.cost.will)) return false
  return true
}

/**
 * 主检索：在语料上跑一次查询。
 * @returns {{ total:number, items:number, docs:number, hits:Array }}
 */
function runSearch(corpus, q, filters) {
  const terms = toTerms(q)
  if (!terms.length) return { total: 0, items: 0, docs: 0, hits: [] }

  const scored = []
  for (const it of corpus.items || []) {
    if (!passFilters(it, filters)) continue
    const sc = scoreItem(it, terms)
    if (sc < 0) continue
    scored.push({ it, sc })
  }
  scored.sort((a, b) => b.sc - a.sc || a.it.s - b.it.s || a.it.n - b.it.n)

  const hits = scored.slice(0, MAX_HITS).map(({ it }) => ({
    sid: it.sid,
    kind: 'item',
    sec: it.s,
    num: it.n,
    title: it.t,
    snippet: snippetOf(it.px, terms, it.sn),
    e: it.e,
    r: it.r,
    tag: tagOf(it),
    dispute: !!it.d,
  }))

  const docHits = []
  if (noItemFilter(filters)) {
    for (const d of corpus.docs || []) {
      let ok = true
      let sc = 0
      for (const term of terms) {
        if ((d.tn || '').indexOf(term) >= 0) sc += 60
        else if ((d.p || '').indexOf(term) >= 0) sc += 15
        else {
          ok = false
          break
        }
      }
      if (!ok) continue
      docHits.push({
        sid: d.sid,
        kind: 'doc',
        docKind: d.k,
        title: d.t,
        snippet: snippetOf(d.px, terms, ''),
        sc,
      })
    }
    docHits.sort((a, b) => b.sc - a.sc)
  }

  const docTop = docHits.slice(0, MAX_DOC_HITS)
  const combined = hits.concat(
    docTop.map((d) => ({ sid: d.sid, kind: 'doc', docKind: d.docKind, title: d.title, snippet: d.snippet }))
  )

  return { total: scored.length + docTop.length, items: scored.length, docs: docTop.length, hits: combined }
}

/** 载入语料后调一次：补上构建期没存的归一化标题 */
function prepare(corpus) {
  for (const it of corpus.items || []) it.tn = normalize(it.t)
  for (const d of corpus.docs || []) d.tn = normalize(d.t)
  return corpus
}

module.exports = {
  normalize,
  normalizeWithMap,
  toTerms,
  snippetOf,
  clip,
  tagOf,
  passFilters,
  scoreItem,
  runSearch,
  prepare,
  MAX_HITS,
  SNIPPET_LEN,
}
