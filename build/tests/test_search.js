/**
 * searchServer 纯逻辑的本地自测（不需要云环境）。
 * 跑法：node build/tests/test_search.js
 * 依赖 dist/search/corpus.json（先跑 build/parse.py）。
 */
const fs = require('fs')
const path = require('path')
const search = require('../../cloudfunctions/searchServer/search')

const corpusPath = path.join(__dirname, '..', '..', 'dist', 'search', 'corpus.json')
const corpus = search.prepare(JSON.parse(fs.readFileSync(corpusPath, 'utf8')))

let failed = 0
function ok(name, cond, extra) {
  if (cond) {
    console.log('  PASS ' + name)
  } else {
    failed += 1
    console.log('  FAIL ' + name + (extra ? '  -> ' + extra : ''))
  }
}

console.log('语料：' + corpus.items.length + ' 条 + ' + corpus.docs.length + ' 篇\n')

// 1) 基础子串命中 + 高亮可定位
{
  const r = search.runSearch(corpus, '安全带', null)
  ok('搜「安全带」有命中', r.items > 0, 'items=' + r.items)
  const top = r.hits[0]
  ok('首条是 item', top && top.kind === 'item')
  ok('首条摘要含查询词', top && search.normalize(top.snippet).indexOf('安全带') >= 0, top && top.snippet)
}

// 2) 去空白匹配：搜「低钠盐」应命中排版成「低钠 盐」的原文
{
  const r = search.runSearch(corpus, '低钠盐', null)
  ok('搜「低钠盐」命中（去空白）', r.items > 0, 'items=' + r.items)
}

// 3) 「与」语义：两个词都要出现
{
  const a = search.runSearch(corpus, '安全带', null).items
  const b = search.runSearch(corpus, '安全带 后排', null).items
  ok('多词是「与」语义（结果更少）', b > 0 && b <= a, 'a=' + a + ' b=' + b)
}

// 4) 全角/大小写归一化
{
  const r1 = search.runSearch(corpus, 'ＮＨＴＳＡ', null).items
  const r2 = search.runSearch(corpus, 'nhtsa', null).items
  ok('全角与大写等价', r1 > 0 && r1 === r2, 'full=' + r1 + ' half=' + r2)
}

// 5) 章节筛选
{
  const all = search.runSearch(corpus, '血压', null).items
  const sec1 = search.runSearch(corpus, '血压', { sec: 1 }).items
  ok('章节筛选生效', sec1 > 0 && sec1 <= all, 'all=' + all + ' sec1=' + sec1)
  ok('筛选结果确实都在第 1 节', search.runSearch(corpus, '血压', { sec: 1 }).hits.every((h) => h.sec === 1))
}

// 6) 证据等级 / 性价比 / 口径筛选
{
  const r = search.runSearch(corpus, '血压', { evidence: 'A', tier: '极高' })
  ok('证据 A + 性价比极高', r.hits.filter((h) => h.kind === 'item').every((h) => h.e === 'A' && h.r === '极高'))
  ok('筛选后有结果', r.items > 0, 'items=' + r.items)
}

// 7) 三维成本筛选
{
  const r = search.runSearch(corpus, '血压', { cost: { money: '0' } })
  ok('不花钱筛选', r.items > 0 && r.hits.every((h) => h.kind !== 'item' || h.tag.money === '0'))
}

// 8) 长文命中且带 kind
{
  const r = search.runSearch(corpus, '增值电信', null)
  const docs = r.hits.filter((h) => h.kind === 'doc')
  ok('长文可被检索到', docs.length > 0, 'docs=' + docs.length)
  ok('长文条目带 kind/docKind', docs.every((d) => d.kind === 'doc' && !!d.sid))
  ok('长文摘要可读（无 # | 残留）', docs.every((d) => !/[#|]/.test(d.snippet)))
}

// 9) 有筛选时不返回长文
{
  const r = search.runSearch(corpus, '增值电信', { sec: 3 })
  ok('带条目筛选时不返回长文', r.hits.every((h) => h.kind === 'item'))
}

// 10) 空查询安全
{
  const r = search.runSearch(corpus, '   ', null)
  ok('空查询返回空', r.total === 0 && r.hits.length === 0)
}

// 11) 打分排序：标题命中应排在正文命中之前
{
  const r = search.runSearch(corpus, '安全带', null)
  const first = r.hits[0]
  ok('标题命中优先', search.normalize(first.title).indexOf('安全带') >= 0, first && first.title)
}

// 12) 摘要长度受控
{
  const r = search.runSearch(corpus, '血压', null)
  ok('摘要长度受控', r.hits.slice(0, 10).every((h) => h.snippet.length <= 110))
}

console.log('\n' + (failed ? failed + ' 项失败' : '全部通过'))
process.exit(failed ? 1 : 0)
