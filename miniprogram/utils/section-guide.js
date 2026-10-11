function overview(intro, groups) {
  const labels = (groups || []).map((group) => group.label)
  return (intro || []).filter((paragraph) => {
    const heading = String(paragraph).match(/^\s*<p>\s*<(?:b|strong)>([^<]+)<\/(?:b|strong)>\s*[：:]/)
    return !heading || labels.indexOf(heading[1].trim()) < 0
  }).join('')
}

function navigation(groups) {
  return (groups || []).map((group, index) => Object.assign({}, group, {
    order: String(index + 1).padStart(2, '0'),
    items: (group.items || []).map((item) => Object.assign({}, item, {
      label: String(item.label || '').replace(/^[\s，,、；;]+/, ''),
    })),
  }))
}

module.exports = { overview, navigation }
