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
