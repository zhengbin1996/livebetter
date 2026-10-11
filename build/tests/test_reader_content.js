const assert = require('assert')
const files = {}
const destinations = []
const notices = []
const essentials = {
  docs: [{ sid: 'd-family', name: '家庭应急装备清单', title: '家庭应急装备清单：买什么', kind: 'doc' }, { sid: 'd-map', name: '引用对照', kind: 'refsmap' }],
  sections: [{ sec: 1, title: '不要早死', summary: '安全', groups: [], items: 2 }, { sec: 2, title: '健康', summary: '血压', groups: [], items: 3 }],
}
const shards = [
  { kind: 'book', path: 'book/01.json', size: 10 },
  { kind: 'doc', path: 'docs/d-family.json', size: 20 },
  { kind: 'refsmap', path: 'docs/d-map.json', size: 100 },
  { kind: 'verify', path: 'docs/verify/d-test.json', size: 100 },
  { kind: 'corpus', path: 'search/corpus.json', size: 100 },
]
global.wx = {
  env: { USER_DATA_PATH: '/test' },
  getFileSystemManager: () => ({
    accessSync(filename) { if (!files[filename]) throw new Error('missing') },
    readFileSync(filename) { if (!files[filename]) throw new Error('missing'); return files[filename] },
  }),
  getStorageSync: () => '',
  navigateTo: ({ url }) => destinations.push(url),
  showToast: ({ title }) => notices.push(title),
  pageScrollTo: (options) => { global.scrollTarget = options.scrollTop },
  setClipboardData: ({ data }) => { global.copied = data },
}
const app = { ready: Promise.resolve(), globalData: { essentials, version: 'test', manifest: { shards } } }
global.getApp = () => app
const content = require('../../miniprogram/utils/content')
files['/test/htb/test/book__01.json'] = '{}'
files['/test/htb/test/docs__d-family.json'] = '{}'
assert.deepStrictEqual(content.clientShards().map((entry) => entry.kind), ['book', 'doc'], '下载只包含读者内容')
assert.strictEqual(content.localStats().complete, true, '过程材料不影响全书离线完成度')
assert.strictEqual(content.localStats().totalBytes, 30)
const refs = require('../../miniprogram/utils/refs')
const sectionGuide = require('../../miniprogram/utils/section-guide')
const guideIntro = ['<p>风险降低 12%，仅适用于成人。<a href="gloss://RR">RR</a></p>', '<p><b>路上</b>：系安全带（第 1 条）。</p>', '<p><b>其他说明</b>：尚无分组导航。</p>']
const guideGroups = [{ label: '路上', items: [{ num: 1, label: '，系安全带' }] }]
const guideSnapshot = JSON.stringify({ guideIntro, guideGroups })
assert.ok(sectionGuide.overview(guideIntro, guideGroups).includes('风险降低 12%，仅适用于成人。<a href="gloss://RR">RR</a>'), '说明保留条件数字和术语链接')
assert.ok(sectionGuide.overview(guideIntro, guideGroups).includes('其他说明'), '缺少导航时不隐藏原文主题')
assert.ok(!sectionGuide.overview(guideIntro, guideGroups).includes('系安全带'), '已提供导航的主题不重复铺开')
assert.strictEqual(sectionGuide.navigation(guideGroups)[0].items[0].label, '系安全带')
assert.strictEqual(JSON.stringify({ guideIntro, guideGroups }), guideSnapshot, '原文导读和缓存数据不被修改')
for (const href of ['../docs/家庭应急装备清单.md', 'https://github.com/eternity4719/HowToLiveBetter/blob/main/docs/%E5%AE%B6%E5%BA%AD%E5%BA%94%E6%80%A5%E8%A3%85%E5%A4%87%E6%B8%85%E5%8D%95.md']) {
  assert.deepStrictEqual(refs.classify(href), { kind: 'doc', sid: 'd-family' })
  refs.handle(href)
  assert.strictEqual(destinations.pop(), '/subpackages/read/pages/doc-read/index?sid=d-family')
}
refs.handle('../docs/引用对照.md')
assert.strictEqual(notices.pop(), '此内容未在小程序提供')
assert.strictEqual(refs.classify('https://example.com/paper').kind, 'http')
refs.handle('https://example.com/paper')
assert.strictEqual(global.copied, 'https://example.com/paper')
assert.strictEqual(refs.classify('gloss://RR').kind, 'gloss')
assert.deepStrictEqual(refs.classify('gloss://ARR=1.05%'), { kind: 'gloss', term: 'ARR=1.05%' }, '原文百分号不是编码错误')
assert.strictEqual(refs.classify('ref://s01-test').kind, 'ref')
const sourceHtml = '<p>详见 <a href="../docs/家庭应急装备清单.md">docs/家庭应急装备清单.md</a>，适用于成人，风险 12%。<a href="https://example.com/paper">原始来源</a></p>'
assert.strictEqual(refs.readableHtml(sourceHtml), sourceHtml.replace('../docs/家庭应急装备清单.md', 'doc://d-family').replace('>docs/家庭应急装备清单.md<', '>家庭应急装备清单：买什么<'))
assert.strictEqual(refs.readableHtml('<a href="../docs/家庭应急装备清单.md"><strong>查看装备</strong></a>'), '<a href="doc://d-family"><strong>查看装备</strong></a>', '描述性标签保留且不触发渲染器相对路径跳转')
assert.strictEqual(refs.classify('doc://d-family').kind, 'doc')
assert.strictEqual(refs.classify('doc://d-map').kind, 'unavailable')
assert.strictEqual(refs.readableHtml('<a href="../docs/未知.md">说明</a>'), '<a href="unavailable://content">说明</a>')
let definition
global.Page = (page) => { definition = page }
require('../../miniprogram/pages/section-list/index')
const directory = Object.assign({}, definition, { data: JSON.parse(JSON.stringify(definition.data)) })
directory.setData = (patch, callback) => { Object.assign(directory.data, patch); if (callback) callback() }
directory.apply()
directory.onInput({ detail: { value: '安全' } })
directory.onPageScroll({ scrollTop: 160 })
directory.switchTab({ currentTarget: { dataset: { tab: 'docs' } } })
assert.strictEqual(directory.data.docs.length, 1)
directory.onInput({ detail: { value: '应急' } })
directory.onPageScroll({ scrollTop: 70 })
directory.switchTab({ currentTarget: { dataset: { tab: 'sections' } } })
assert.strictEqual(directory.data.q, '安全')
assert.strictEqual(directory.data.sections.length, 1)
assert.strictEqual(global.scrollTarget, 160)
directory.switchTab({ currentTarget: { dataset: { tab: 'docs' } } })
assert.strictEqual(directory.data.q, '应急')
assert.strictEqual(global.scrollTarget, 70)
directory.onDoc({ currentTarget: { dataset: { sid: 'd-family' } } })
assert.strictEqual(destinations.pop(), '/subpackages/read/pages/doc-read/index?sid=d-family')
console.log('PASS 读者下载范围、缓存完成度、专题链接、外部来源、目录条件与位置')
