const demoData = window.interactionData
const demoPrefix = 'livebetter-interaction-demo:'
window.wx = {
  getStorageSync(key) { try { return JSON.parse(localStorage.getItem(demoPrefix + key) || 'null') || '' } catch (error) { return '' } },
  setStorageSync(key, value) { localStorage.setItem(demoPrefix + key, JSON.stringify(value)) },
  showToast(options) { showNotice(options.title) },
}
window.getApp = () => ({ globalData: { cloudReady: false, version: demoData.meta.version, essentials: demoData } })
let route = 'home'
let previous = 'home'
let selected = null
let originalOpen = false
let query = ''
let filters = emptyFilters()
let draft = null
let notice = ''
let noticeTimer = null
let searchSubmitted = false
let recommendation = 0
let visibleCount = 30
const scrolls = {}
const screen = document.querySelector('#screen')
const phone = document.querySelector('.phone')
let store
let favorites
let advice
let refs
let help
let sectionGuide
let share
let shareCover
let packData
let packCheckout = false
let packUnlocked = false
let sharePreview = null
let directoryTab = 'sections'
const directoryViews = { sections: { query: '', scroll: 0 }, docs: { query: '', scroll: 0 } }
let selectedSection = null
let sectionGuideOpen = false
let guideSourceOpen = false
let selectedDoc = null
const trail = []
const tabRoutes = ['home', 'search', 'favorites', 'reading-pack', 'about']
const runtime = document.createElement('script')
runtime.src = 'interaction-runtime.js'
runtime.onload = () => {
  ;({ store, favorites, advice, refs, help, sectionGuide, share, shareCover, packData } = window.demoModules)
  demoData.items.forEach((item) => advice.remember(item))
  favorites.subscribe(() => render())
  favorites.refresh()
}
document.head.append(runtime)

function emptyFilters() { return { grade: '', tier: '', caliber: '', sec: '', cost: { money: '', time: '', will: '' } } }
function escape(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]) }
function itemOf(sid) { return demoData.items.find((item) => item.sid === sid) }
function button(label, command, sid, className) { return `<button class="${className || ''}" data-command="${command}"${sid ? ` data-sid="${sid}"` : ''}>${escape(label)}</button>` }
function favoriteButton(item) { return button(store.isFavorite(item.sid) ? '已收藏 · 取消' : '收藏', 'favorite', item.sid, 'advice-favorite') }
function card(item, highlight) {
  return `<article class="advice-card ${highlight ? 'advice-card--highlight' : ''}" data-sid="${item.sid}"><button class="advice-main" data-command="open" data-sid="${item.sid}"><div class="advice-meta">${item.sec} 节 · 第 ${item.num} 条</div><div class="advice-title">${escape(item.title)}</div>${item.dispute || item.todo ? `<div class="advice-flags">${item.dispute ? '<span>争议</span>' : ''}${item.todo ? '<span>待核实</span>' : ''}</div>` : ''}${item.summary ? `<div class="advice-summary">${escape(item.summary)}</div>` : ''}</button>${favoriteButton(item)}</article>`
}
function searchForm() { return `<form class="demo-search"><input name="query" aria-label="搜索建议" placeholder="搜建议、搜症状、搜钱的事" value="${escape(query)}"><button type="submit">搜</button></form>` }
function head(title, label, command) { return `<div class="section-head"><h2>${title}</h2>${label ? button(label, command) : ''}</div>` }
function moduleHead(number, title, label, command) { return `<div class="home-module-head"><h2 class="home-module-title"><span class="home-module-number">${number}</span><span>${title}</span></h2>${label ? button(label, command, '', 'today-all') : ''}</div>` }
function homePage() {
  const candidates = demoData.items.filter((item) => item.ratio === '极高' && !item.dispute)
  const pick = candidates[recommendation % candidates.length]
  return `<div class="home-brand"><strong>高性价比人生指南</strong><span>34 节 · 原文阅读</span></div><section class="home-search" aria-label="搜索建议"><div class="home-search-title">找一条需要的建议</div>${searchForm()}</section>${pick ? `<section class="home-module home-module--recommend" aria-label="推荐阅读">${moduleHead('01', '推荐阅读', '换一条 ↻', 'shuffle')}${card(pick, true)}</section>` : ''}<section class="home-module home-module--topics" aria-label="按你的处境">${moduleHead('02', '按你的处境')}<p class="home-module-note">从关心的问题开始，展开分类找建议。</p><div class="home-topic-list">${demoData.problemGroups.map((group) => `<details class="home-topic"><summary>${escape(group.name)}</summary>${demoData.problems.filter((problem) => problem.group === group.key).map((problem) => `<button data-command="section" data-sec="${problem.sec}">${escape(problem.q)} ›</button>`).join('')}</details>`).join('')}</div></section><section class="home-module home-module--directory" aria-label="全书目录">${moduleHead('03', '全书目录')}${button('章节与专题长文　›', 'sections', '', 'home-directory-link')}<p class="home-module-note">${demoData.sections.length} 节 · ${demoData.docs.length} 篇专题，按需要查阅。</p></section>`
}
function matching() {
  const needle = query.replace(/\s+/g, '').toLowerCase()
  const items = demoData.items.filter((item) => {
    const text = (item.title + Object.values(item.fields).join(' ').replace(/<[^>]*>/g, '')).replace(/\s+/g, '').toLowerCase()
    if (needle && !text.includes(needle)) return false
    if (filters.grade && filters.grade !== item.evidenceLevel) return false
    if (filters.sec && Number(filters.sec) !== item.sec) return false
    if (filters.caliber && filters.caliber !== item.tag.caliber) return false
    if (filters.tier && filters.tier !== ratio(item)) return false
    return Object.keys(filters.cost).every((key) => !filters.cost[key] || filters.cost[key] === item.tag[key])
  })
  const hasFilters = filters.grade || filters.sec || filters.caliber || filters.tier || Object.values(filters.cost).some(Boolean)
  const docs = hasFilters ? [] : demoData.docs.filter((doc) => (doc.title + doc.body.replace(/<[^>]*>/g, '')).replace(/\s+/g, '').toLowerCase().includes(needle))
  return items.concat(docs)
}
function ratio(item) {
  return item.ratio
}
function filterLabels() {
  const labels = []
  if (filters.grade) labels.push(['grade', '证据 ' + filters.grade])
  if (filters.tier) labels.push(['tier', '性价比 ' + filters.tier])
  if (filters.caliber) labels.push(['caliber', { 死亡率: '换寿命', 金钱: '换钱', 时间: '换时间', 自由: '换自由' }[filters.caliber]])
  if (filters.sec) labels.push(['sec', '第 ' + filters.sec + ' 节'])
  for (const key of Object.keys(filters.cost)) if (filters.cost[key]) labels.push(['cost.' + key, { money: '钱', time: '时间', will: '毅力' }[key] + ' ' + filters.cost[key]])
  return labels.map(([key, label]) => `<button data-command="remove-filter" data-key="${key}">${escape(label)} ×</button>`).join('')
}
function searchPage() {
  const results = matching()
  const recent = wx.getStorageSync('htb.search-history') || []
  return `<h1 class="page-heading">找到需要的建议。</h1>${searchForm()}<div class="demo-seg">${button('全部', 'quick-all', '', !filters.grade && !filters.tier ? 'on' : '')}${button('只看证据 A', 'quick-grade', '', filters.grade === 'A' ? 'on' : '')}${button('只看极高', 'quick-tier', '', filters.tier === '极高' ? 'on' : '')}</div><div class="filter-tags">${button('筛选', 'filters')}${filterLabels()}${query ? button('清空关键词', 'clear-query') : ''}</div>${searchSubmitted ? `<p class="summary-note">命中 ${results.length} 条 · 演示样本 ${demoData.items.length} 条</p>${results.slice(0, visibleCount).map((item) => item.kind === 'doc' ? docCard(item) : card(item)).join('')}${!results.length ? '<p class="empty-demo">没找到，换个词或减少筛选条件。</p>' : ''}` : `<p class="empty-demo">可以搜“安全带”“保险”“加班”。<br>点击标题读摘要，收藏方便以后再看。</p><div class="filter-tags">${recent.map((word) => `<button data-command="history" data-query="${escape(word)}">${escape(word)}</button>`).join('')}</div>`}`
}
function favoritesPage() {
  const items = Object.keys(store.getFavorites()).map((sid) => itemOf(sid)).filter(Boolean)
  return `<h1 class="page-heading">值得再读的建议。</h1>${items.length ? `<p class="summary-note">已收藏 ${items.length} 条</p>${items.map((item) => card(item)).join('')}` : `<div class="empty-demo">还没有收藏。<br>看到想留住的建议，点击“收藏”。<br>${button('去检索', 'search')}</div>`}<p class="disclaimer">收藏保存在本机，联网后同步。</p>`
}
function detailPage() {
  const fields = selected.fields
  const original = ['收益', '成本', '备注', '来源'].filter((key) => fields[key]).map((key) => `<section class="field"><div class="k">${key}</div><div class="v">${refs.readableHtml(fields[key])}</div></section>`).join('')
  return `<div class="dtitle">${escape(selected.title)}</div>${selected.dispute || selected.todo ? '<div class="advice-flags">' + (selected.dispute ? '<span>争议</span>' : '') + (selected.todo ? '<span>待核实</span>' : '') + '</div>' : ''}<div class="dplain"><span class="k">原文摘要</span><div class="v">${refs.readableHtml(fields['说人话'])}</div></div><div class="detail-actions">${favoriteButton(selected)}</div>${button(originalOpen ? '收起原文 ↑' : '查看原文 ↓', 'original', '', 'original-toggle')}${originalOpen ? `<div class="marks-demo"><span>证据 ${selected.evidenceLevel}</span><span>性价比 ${ratio(selected)}</span></div>${original}${button('收起原文 ↑', 'original', '', 'original-toggle')}` : ''}<p class="disclaimer">《高性价比人生指南》· 原作者 · CC BY 4.0<br>本内容为生活建议，不构成医疗建议或法律意见。</p>`
}
function aboutPage() {
  return `<h1 class="page-heading">高性价比人生指南</h1><p class="about-intro">找到需要的内容，读懂后再做判断。</p>
    <section class="about-section"><h2>阅读帮助</h2><div class="about-group">${help.map((entry) => `<details class="about-entry"><summary><strong>${escape(entry.head)}</strong></summary><p>${escape(entry.body)}</p></details>`).join('')}${button('术语表 ›', 'glossary', '', 'directory-row')}${button('标注怎么读 ›', 'legend', '', 'directory-row')}</div></section>
    <section class="about-section"><h2>离线与更新</h2><div class="about-group"><details class="about-entry"><summary><strong>离线与更新</strong><span>下载全书、查看下载进度和管理缓存</span></summary><p>小程序支持检查内容更新，离线下载包含章节与专题长文。清空正文缓存不会删除收藏。</p><p>此演示不连接云端，下载、更新和缓存管理需在小程序中验证。</p></details></div></section>
    <section class="about-section"><h2>原作与说明</h2><p class="about-intro">《高性价比人生指南》· 原作者。本程序为阅读呈现工具，非原始发布方。调整了排版、分页与链接交互，原书文字和数字未改写。</p><p><a href="https://github.com/eternity4719/HowToLiveBetter" target="_blank" rel="noreferrer">原作链接</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a></p></section>
    <p class="disclaimer">本内容为生活建议，不构成医疗建议或法律意见。演示包含固定版本的 ${demoData.items.length} 条建议及 ${demoData.docs.length} 篇专题长文，收藏保存在浏览器本机。</p>`
}
function readingPackPage() {
  return `<div class="pack-hero"><span class="pack-kicker">随时翻阅，也能打印</span><h1>便携阅读包</h1><p>把《高性价比人生指南》带在身边。全书 PDF 与主题索引，按需要找到原文。</p><div class="pack-price"><strong>¥1</strong><span>计划售价 · 一次购买</span></div><span class="summary-note">内容日期 ${escape(packData.contentDate)}</span></div><section class="about-section pack-test"><h2>先试试 PDF 阅读效果</h2><p class="about-intro">免费样张 · 8 页 · 第 1 节前 3 条完整建议，无需购买。</p><a class="pack-download" href="reading-pack/sample.pdf" download="高性价比人生指南-免费样张.pdf" data-document-link>下载免费 PDF 样张 ↓</a><a class="pack-download" href="reading-pack/book.pdf" download="高性价比人生指南-全书阅读版.pdf" data-document-link>下载全书 PDF（本地测试） ↓</a><p class="summary-note">浏览器下载保存到浏览器设置的目录。小程序内先打开样张，再从微信文件菜单尝试保存或转发。</p></section><section class="about-section"><h2>阅读包包含什么</h2><div class="pack-file"><span class="pack-kicker">01 / 全书阅读版 PDF</span><h2>完整原文，随时翻阅。</h2><p>${packData.sections} 节 · ${packData.items} 条建议 · ${packData.docs} 篇专题。手机阅读排版、可点击目录与书签，保留摘要、条件、争议提示和来源。</p></div><div class="pack-file"><span class="pack-kicker">02 / 主题查阅索引 PDF</span><h2>从需要的处境开始。</h2><div class="pack-topics">${packData.themeNames.map((name) => `<span>${escape(name)}</span>`).join('')}</div><p>按原书章节和条目标题找内容，完整正文见全书 PDF 或免费小程序。</p></div></section><section class="about-section"><h2>购买与保存说明</h2><p class="about-intro">计划一次购买当前日期版本，不连续扣费。正式开放时将说明重新下载、更新与退款规则。</p><p class="about-intro">PDF 在微信预览后可通过文件菜单保存或转发，具体保存操作取决于手机系统与微信版本。</p><p class="about-intro">原文可免费阅读。收费针对文件排版与索引整理，小程序的阅读、搜索、收藏和离线阅读继续免费。</p></section>${packUnlocked ? `<div class="pack-demo-note">演示已领取 · 未真实付款<br>这只是当前演示的临时状态，不代表正式购买权益。</div><a class="pack-download" href="reading-pack/book.pdf" download="高性价比人生指南-全书阅读版.pdf" data-document-link>下载全书 PDF ↓</a><a class="pack-download" href="reading-pack/themes.pdf" download="高性价比人生指南-主题查阅索引.pdf" data-document-link>下载主题索引 PDF ↓</a>${button('重新体验购买流程', 'pack-reset', '', 'original-toggle')}` : `<div class="pack-demo-note">支付尚未开通 · 浏览器模拟流程<br>点击按钮不扣款，也不产生正式订单。</div>${button('体验 1 元购买流程（模拟）', 'pack-buy', '', 'pack-buy')}`}<p class="disclaimer">原作：eternity4719 / HowToLiveBetter · CC BY 4.0。原文文字和数字未改写。<br>本内容为生活建议，不构成医疗建议或法律意见。</p>`
}
function docCard(doc) {
  return `<button class="directory-row" data-command="doc" data-sid="${doc.sid}"><span class="advice-meta">专题长文</span><strong>${escape(doc.title)}</strong></button>`
}
function directoryPage() {
  const view = directoryViews[directoryTab]
  const source = directoryTab === 'docs' ? demoData.docs : demoData.sections
  const needle = view.query.trim().toLowerCase()
  const rows = source.filter((entry) => [entry.title, entry.summary, ...(entry.groups || []), ...(entry.headings || []).map((heading) => typeof heading === 'string' ? heading : heading.text)].join(' ').toLowerCase().includes(needle))
  return `<h1 class="page-heading">全书目录</h1><div class="demo-seg">${button('章节', 'directory-sections', '', directoryTab === 'sections' ? 'on' : '')}${button('专题长文', 'directory-docs', '', directoryTab === 'docs' ? 'on' : '')}</div><form class="directory-search demo-search"><input name="keyword" aria-label="搜索当前目录" placeholder="${directoryTab === 'sections' ? '搜章节标题或导读' : '搜专题标题或小标题'}" value="${escape(view.query)}"><button type="submit">搜</button></form><p class="summary-note">${rows.length} ${directoryTab === 'sections' ? '节' : '篇'}</p>${rows.map((entry) => directoryTab === 'docs' ? docCard(entry) : `<button class="directory-row" data-command="section" data-sec="${entry.sec}"><span class="advice-meta">第 ${entry.sec} 节 · ${entry.items} 条</span><strong>${escape(entry.title)}</strong><span>${escape(entry.summary)}</span></button>`).join('')}${!rows.length ? '<p class="empty-demo">没有匹配内容，换个词试试。</p>' : ''}`
}
function sectionPage() {
  const section = demoData.sections.find((entry) => entry.sec === selectedSection)
  const items = demoData.items.filter((item) => item.sec === selectedSection)
  const groups = sectionGuide.navigation(section.guideGroups)
  const intro = (section.intro || []).join('')
  const overview = sectionGuide.overview(section.intro, section.guideGroups)
  const guide = sectionGuideOpen ? `<div class="section-guide">${overview ? `<div class="guide-overview"><h2 class="guide-section-title">本节说明</h2><div class="intro field"><div class="v">${refs.readableHtml(overview)}</div></div></div>` : ''}${groups.length ? `<div class="gnav"><h2 class="guide-section-title">主题导航</h2><p class="guide-nav-hint">点击条目，跳到对应建议</p>${groups.map((group) => `<div class="gblock"><div class="gl"><span class="group-order mono">${group.order}</span><span>${escape(group.label)}</span></div><div class="gitems">${group.items.map((item) => `<button class="gi" data-command="section-group" data-num="${item.num}"><span class="group-num mono">${item.num}</span><span class="group-item-label">${escape(item.label)}</span><span class="group-chevron" aria-hidden="true">›</span></button>`).join('')}</div></div>`).join('')}</div>` : ''}${intro ? `<div class="guide-source"><button class="guide-source-toggle" data-command="guide-source" aria-expanded="${guideSourceOpen}">${guideSourceOpen ? '收起完整原文导读 ↑' : '查看完整原文导读 ↓'}</button>${guideSourceOpen ? `<div class="intro field"><div class="v">${refs.readableHtml(intro)}</div></div>` : ''}</div>` : ''}</div>` : ''
  return `<div class="shead"><div class="sn mono">第 ${section.sec} 节</div><h1 class="st">${escape(section.title)}</h1><div class="section-meta"><span class="sc mono">${items.length} 条 · 按性价比排序</span>${intro || groups.length ? `<button class="guide-toggle" data-command="section-guide" aria-expanded="${sectionGuideOpen}"><span class="guide-label"><span class="guide-title">${sectionGuideOpen ? '收起本节导读' : '展开本节导读'}</span><span class="guide-hint">本节讲什么 · 主题导航</span></span><span class="guide-arrow" aria-hidden="true">${sectionGuideOpen ? '↑' : '↓'}</span></button>` : ''}</div></div>${guide}${items.map((item) => `<div id="section-item-${item.num}">${card(item)}</div>`).join('')}`
}
function documentPage() {
  return `<h1 class="page-heading">${escape(selectedDoc.title)}</h1><p class="summary-note">专题长文</p><details class="about-entry"><summary>文章目录</summary>${(selectedDoc.toc || []).filter((heading) => heading.level <= 2).map((heading) => `<a href="#${heading.id}">${escape(heading.text)}</a><br>`).join('')}</details><div class="field docbody"><div class="v">${refs.readableHtml(selectedDoc.body)}</div></div>`
}
function glossaryPage() {
  return `<h1 class="page-heading">术语表</h1><div class="about-group">${demoData.glossary.map((entry) => `<details class="about-entry"><summary><strong>${escape(entry.term)}</strong></summary><p>${escape(entry.meaning)}</p></details>`).join('')}</div>`
}
function legendPage() {
  const legend = demoData.legend
  return `<h1 class="page-heading">标注怎么读</h1><section class="about-section"><h2>证据等级</h2>${legend.evidence.map((entry) => `<p class="about-intro"><strong>${entry.level}</strong> · ${escape(entry.meaning)}</p>`).join('')}${legend.evidenceNote}</section><section class="about-section"><h2>性价比档</h2>${legend.tierNote}</section><section class="about-section"><h2>资源与成本</h2>${legend.resources.map((entry) => `<p class="about-intro">${escape(entry.name)} · ${escape(entry.desc)}</p>`).join('')}</section>`
}
function pushPage(next) {
  trail.push({ route, selected, selectedSection, selectedDoc, originalOpen, sectionGuideOpen, guideSourceOpen })
  scrolls[route] = screen.scrollTop
  draft = null
  route = next
  screen.scrollTop = 0
}
function render() {
  if (!favorites) return
  const scroll = screen.scrollTop
  const names = { home: '首页', search: '检索', favorites: '收藏', about: '关于', detail: '原文摘要', sections: '全书目录', section: '章节阅读', doc: '专题长文', glossary: '术语表', legend: '标注怎么读', 'reading-pack': '便携阅读包' }
  document.querySelector('#phone-header').innerHTML = (!tabRoutes.includes(route) ? button('‹ 返回', 'back', '', 'back') : '') + names[route]
  screen.innerHTML = route === 'home' ? homePage() : route === 'search' ? searchPage() : route === 'favorites' ? favoritesPage() : route === 'detail' ? detailPage() : route === 'sections' ? directoryPage() : route === 'section' ? sectionPage() : route === 'doc' ? documentPage() : route === 'glossary' ? glossaryPage() : route === 'legend' ? legendPage() : route === 'reading-pack' ? readingPackPage() : aboutPage()
  if (['home', 'sections', 'detail', 'section', 'doc'].includes(route)) {
    const shareButton = button('分享给好友 ↗', 'share-preview', '', 'reader-share')
    if (route === 'detail') screen.querySelector('.detail-actions').insertAdjacentHTML('beforeend', shareButton)
    else if (route === 'section') screen.querySelector('.sn').outerHTML = `<div class="reading-heading">${screen.querySelector('.sn').outerHTML}${shareButton}</div>`
    else if (route === 'doc') screen.querySelector('.summary-note').outerHTML = `<div class="reading-heading">${screen.querySelector('.summary-note').outerHTML}${shareButton}</div>`
    else document.querySelector('#phone-header').insertAdjacentHTML('beforeend', button('分享 ↗', 'share-preview', '', 'header-share'))
  }
  document.querySelector('#navigation').innerHTML = tabRoutes.map((key) => `<button data-command="${key}" ${route === key ? 'aria-current="page"' : ''}>${key === 'reading-pack' ? '阅读包' : names[key]}</button>`).join('')
  screen.scrollTop = scroll
  renderFeedback()
  renderOverlay()
}
function navigate(next) {
  scrolls[route] = screen.scrollTop
  draft = null
  sharePreview = null
  packCheckout = false
  route = next
  render()
  screen.scrollTop = scrolls[next] || 0
}
function showNotice(text) {
  notice = text
  if (noticeTimer) clearTimeout(noticeTimer)
  renderFeedback()
  noticeTimer = setTimeout(() => { notice = ''; renderFeedback() }, 3000)
}
function renderFeedback() { document.querySelector('#feedback').innerHTML = notice ? `<div class="feedback"><span>${escape(notice)}</span></div>` : '' }
function group(key, title, options) {
  const current = key.startsWith('cost.') ? draft.cost[key.slice(5)] : draft[key]
  return `<h3>${title}</h3><div class="sheet-options">${options.map(([value, label]) => `<button class="${current === value ? 'on' : ''}" data-command="draft" data-key="${key}" data-value="${value}">${escape(label)}</button>`).join('')}</div>`
}
function renderOverlay() {
  let body = ''
  if (packCheckout) {
    body = `<div class="sheet-head"><span>模拟购买确认</span>${button('关闭 ×', 'pack-cancel')}</div><div class="sheet-body"><h2>便携阅读包</h2><p class="about-intro">全书 PDF ＋ 六个主题的查阅索引<br>内容日期 ${escape(packData.contentDate)}</p><div class="pack-price"><strong>¥1</strong><span>计划售价</span></div><div class="pack-demo-note">本次为本地演示，不发起微信支付，不扣款，不创建订单。确认后可下载本机生成的演示文件。</div></div><div class="sheet-footer">${button('取消', 'pack-cancel')}${button('模拟领取（不扣款）', 'pack-confirm', '', 'apply')}</div>`
  } else if (sharePreview) {
    body = `<div class="sheet-head"><span>分享预览</span>${button('关闭 ×', 'close-share')}</div><div class="sheet-body"><div class="share-card"><img class="share-cover" src="${sharePreview.cover || 'share-cover.png'}" alt="${escape(sharePreview.payload.title)} · 原文摘录"><div class="share-book">高性价比人生指南</div><h2>${escape(sharePreview.payload.title)}</h2><p>打开小程序，直接阅读${sharePreview.route === 'detail' ? '这条建议' : sharePreview.route === 'section' ? '本节内容' : sharePreview.route === 'doc' ? '这篇专题' : '原书内容'}。</p></div><p class="share-native-note">浏览器仅展示分享效果。发送给好友或分享到朋友圈，请在微信小程序中操作。</p></div><div class="sheet-footer">${button('查看接收页面', 'share-open', '', 'apply')}</div>`
  } else if (draft) {
    body = `<div class="sheet-head"><span>筛选建议</span>${button('关闭 ×', 'close-overlay')}</div><div class="sheet-body">${group('cost.money', '花钱', [['0', '不花钱'], ['少', '花一点'], ['多', '花不少']])}${group('cost.time', '花时间', [['少', '不占时间'], ['中', '占一些'], ['多', '占很多']])}${group('cost.will', '要毅力', [['否', '不用'], ['些', '要一点'], ['是', '很吃毅力']])}${group('grade', '证据等级', [['A', 'A'], ['B', 'B'], ['C', 'C']])}${group('tier', '性价比', [['极高', '极高'], ['高', '高'], ['一般', '一般']])}${group('caliber', '换回什么', [['死亡率', '换寿命'], ['金钱', '换钱'], ['时间', '换时间'], ['自由', '换自由']])}${group('sec', '章节', demoData.sections.map((section) => [String(section.sec), section.sec + ' ' + section.title]))}</div><div class="sheet-footer">${button('重置', 'reset-filters')}${button('应用筛选', 'apply-filters', '', 'apply')}</div>`
  }
  document.querySelector('#overlay').innerHTML = body ? `<div class="sheet-mask"><div class="sheet" role="dialog" aria-modal="true" aria-label="${packCheckout ? '模拟购买确认' : sharePreview ? '分享预览' : '筛选建议'}">${body}</div></div>` : ''
}
function search() {
  query = query.trim()
  if (!query) { showNotice('输入关键词'); return }
  const recent = (wx.getStorageSync('htb.search-history') || []).filter((word) => word !== query)
  wx.setStorageSync('htb.search-history', [query].concat(recent).slice(0, 6))
  searchSubmitted = true
  visibleCount = 30
  if (route !== 'search') navigate('search')
  else render()
  screen.scrollTop = 0
}
document.addEventListener('submit', (event) => {
  if (event.target.matches('.directory-search')) { event.preventDefault(); directoryViews[directoryTab].query = event.target.elements.keyword.value; directoryViews[directoryTab].scroll = 0; render(); screen.scrollTop = 0; return }
  if (!event.target.matches('.demo-search')) return
  event.preventDefault()
  query = event.target.elements.query.value
  search()
})
document.addEventListener('click', (event) => {
  const link = event.target.closest('#screen a')
  if (link) {
    if (link.hasAttribute('data-document-link')) return
    const href = link.getAttribute('href')
    if (href.startsWith('#')) { event.preventDefault(); screen.querySelector('[id="' + href.slice(1) + '"]')?.scrollIntoView(); return }
    const info = refs.classify(href)
    if (info.kind === 'doc') { event.preventDefault(); pushPage('doc'); selectedDoc = demoData.docs.find((doc) => doc.sid === info.sid); render(); return }
    if (info.kind === 'ref') { event.preventDefault(); const item = itemOf(info.sid); if (item) { pushPage('detail'); selected = item; originalOpen = false; render() } else showNotice('此内容未在演示提供'); return }
    if (info.kind === 'gloss') { event.preventDefault(); const term = demoData.glossary.find((entry) => entry.term === info.term); if (term) showNotice(term.term + '：' + term.meaning); return }
    if (info.kind === 'unavailable') { event.preventDefault(); showNotice('此内容未在小程序提供'); return }
  }
  const target = event.target.closest('[data-command]')
  if (!target) {
    if (event.target.matches('.sheet-mask')) { draft = null; sharePreview = null; packCheckout = false; renderOverlay() }
    return
  }
  const command = target.dataset.command
  const item = itemOf(target.dataset.sid)
  if (tabRoutes.includes(command) && !item) navigate(command)
  else if (command === 'pack-buy') { packCheckout = true; renderOverlay() }
  else if (command === 'pack-cancel') { packCheckout = false; renderOverlay() }
  else if (command === 'pack-confirm') { if (!packCheckout) return; packCheckout = false; packUnlocked = true; render(); showNotice('演示领取完成，未发生付款') }
  else if (command === 'pack-reset') { packUnlocked = false; render() }
  else if (command === 'share-preview') {
    const section = demoData.sections.find((entry) => entry.sec === selectedSection)
    const payload = route === 'detail' ? share.item(selected) : route === 'section' ? share.section(selectedSection, section.title) : route === 'doc' ? share.doc(selectedDoc) : route === 'sections' ? share.directory(directoryTab) : share.home()
    const info = route === 'detail' ? shareCover.item(selected) : route === 'section' ? shareCover.section(selectedSection, section.title, section.intro) : route === 'doc' ? shareCover.doc(selectedDoc) : null
    let cover = ''
    if (info) {
      const canvas = document.createElement('canvas')
      canvas.width = 1000; canvas.height = 800
      shareCover.draw(canvas.getContext('2d'), info)
      cover = canvas.toDataURL('image/png')
    }
    sharePreview = { route, payload, cover }; draft = null; renderOverlay()
  }
  else if (command === 'close-share') { sharePreview = null; renderOverlay() }
  else if (command === 'share-open') { sharePreview = null; originalOpen = false; sectionGuideOpen = false; guideSourceOpen = false; if (route === 'sections') directoryViews[directoryTab].query = ''; render(); screen.scrollTop = 0 }
  else if (command === 'sections') { pushPage('sections'); render(); screen.scrollTop = directoryViews[directoryTab].scroll }
  else if (command === 'open') { pushPage('detail'); selected = item; originalOpen = false; render() }
  else if (command === 'back') { const state = trail.pop(); if (state) { selected = state.selected; selectedSection = state.selectedSection; selectedDoc = state.selectedDoc; originalOpen = state.originalOpen; sectionGuideOpen = state.sectionGuideOpen; guideSourceOpen = state.guideSourceOpen; navigate(state.route) } else navigate('home') }
  else if (command === 'favorite') favorites.toggle(item)
  else if (command === 'shuffle') { recommendation = (recommendation + 1) % demoData.items.length; render() }
  else if (command === 'original') { originalOpen = !originalOpen; render(); if (!originalOpen) screen.querySelector('.original-toggle').scrollIntoView({ block: 'center' }) }
  else if (command === 'filters') { draft = JSON.parse(JSON.stringify(filters)); renderOverlay() }
  else if (command === 'close-overlay') { draft = null; renderOverlay() }
  else if (command === 'draft') {
    const key = target.dataset.key
    const container = key.startsWith('cost.') ? draft.cost : draft
    const field = key.startsWith('cost.') ? key.slice(5) : key
    container[field] = container[field] === target.dataset.value ? '' : target.dataset.value
    const scroll = document.querySelector('.sheet-body').scrollTop
    renderOverlay()
    document.querySelector('.sheet-body').scrollTop = scroll
  } else if (command === 'reset-filters') { draft = emptyFilters(); renderOverlay() }
  else if (command === 'apply-filters') { filters = draft; draft = null; render() }
  else if (command === 'remove-filter') {
    const key = target.dataset.key
    if (key.startsWith('cost.')) filters.cost[key.slice(5)] = ''
    else filters[key] = ''
    render()
  } else if (command.startsWith('quick-')) {
    filters.grade = command === 'quick-grade' ? 'A' : ''
    filters.tier = command === 'quick-tier' ? '极高' : ''
    render()
  } else if (command === 'clear-query') { query = ''; searchSubmitted = false; render() }
  else if (command === 'history') { query = target.dataset.query; search() }
  else if (command.startsWith('directory-')) { directoryViews[directoryTab].scroll = screen.scrollTop; directoryTab = command === 'directory-docs' ? 'docs' : 'sections'; render(); screen.scrollTop = directoryViews[directoryTab].scroll }
  else if (command === 'section') { pushPage('section'); selectedSection = Number(target.dataset.sec); sectionGuideOpen = false; guideSourceOpen = false; render() }
  else if (command === 'section-guide') { sectionGuideOpen = !sectionGuideOpen; render() }
  else if (command === 'guide-source') { guideSourceOpen = !guideSourceOpen; render() }
  else if (command === 'section-group') { screen.querySelector('#section-item-' + target.dataset.num)?.scrollIntoView() }
  else if (command === 'doc') { pushPage('doc'); selectedDoc = demoData.docs.find((doc) => doc.sid === target.dataset.sid); render() }
  else if (command === 'glossary' || command === 'legend') { pushPage(command); render() }
})
screen.addEventListener('scroll', () => {
  if (route === 'sections') directoryViews[directoryTab].scroll = screen.scrollTop
  if (route === 'search' && screen.scrollTop + screen.clientHeight >= screen.scrollHeight - 120 && matching().length > visibleCount) { visibleCount += 30; render() }
})
document.querySelector('#theme').onclick = (event) => { const dark = phone.dataset.theme === 'light'; phone.dataset.theme = dark ? 'dark' : 'light'; event.target.textContent = dark ? '切换浅色' : '切换深色' }
document.querySelector('#width').onclick = (event) => { const narrow = phone.style.width !== '320px'; phone.style.width = narrow ? '320px' : ''; event.target.textContent = narrow ? '切换 375px' : '切换 320px' }
document.querySelector('#reset').onclick = () => {
  Object.keys(localStorage).filter((key) => key.startsWith(demoPrefix)).forEach((key) => localStorage.removeItem(key))
  demoData.items.forEach((item) => advice.remember(item))
  trail.length = 0; directoryTab = 'sections'; Object.values(directoryViews).forEach((view) => { view.query = ''; view.scroll = 0 }); route = 'home'; query = ''; filters = emptyFilters(); searchSubmitted = false; draft = null; sharePreview = null; packCheckout = false; packUnlocked = false; recommendation = 0; notice = ''
  if (noticeTimer) clearTimeout(noticeTimer)
  render(); screen.scrollTop = 0
}
