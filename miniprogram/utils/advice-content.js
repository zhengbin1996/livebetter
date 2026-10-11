const content = require('./content')
const advice = require('./advice')

function initial(sids) {
  const app = getApp()
  const picks = (((app || {}).globalData || {}).essentials || {}).picks || []
  const bySid = {}
  picks.forEach((pick) => { bySid[pick.sid] = pick })
  return sids.map((sid) => {
    const fallback = advice.placeholder(sid)
    const sec = fallback.sec
    const shard = sec ? content.readLocal(`book/${String(sec).padStart(2, '0')}.json`) : null
    const item = shard && (shard.items || []).find((entry) => entry.sid === sid)
    if (item) return Object.assign(advice.remember(Object.assign({}, item, { sec })), { unavailable: false })
    if (bySid[sid]) return Object.assign({}, fallback, advice.normalize(bySid[sid]))
    return fallback
  })
}

async function hydrate(items, onUpdate) {
  const rows = items.map((item) => advice.normalize(item))
  const sections = []
  rows.forEach((item) => { if (item.sec && sections.indexOf(item.sec) < 0) sections.push(item.sec) })
  let cursor = 0
  async function worker() {
    while (cursor < sections.length) {
      const sec = sections[cursor++]
      try {
        const shard = await content.loadSection(sec)
        const index = {}
        ;(shard.items || []).forEach((item) => { index[item.sid] = Object.assign({}, item, { sec: shard.sec }) })
        rows.forEach((item, position) => {
          if (index[item.sid]) rows[position] = Object.assign(advice.remember(index[item.sid]), { unavailable: false })
        })
        if (onUpdate) onUpdate(rows.slice())
      } catch (error) {}
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, sections.length) }, () => worker()))
  return rows
}

module.exports = { initial, hydrate }
