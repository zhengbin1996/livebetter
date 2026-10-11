const fs = require('fs')
const path = require('path')
const root = path.resolve(__dirname, '..')
const modules = ['utils/store', 'utils/cloud', 'utils/favorites', 'utils/advice', 'utils/reader-content', 'utils/refs', 'utils/reading-help', 'utils/section-guide', 'utils/share', 'utils/share-cover', 'config', 'data/pick-summaries', 'data/reading-pack']
const bundled = modules.map((name) => JSON.stringify(name) + ':function(module,exports,require){\n' + fs.readFileSync(path.join(root, 'miniprogram', name + '.js'), 'utf8') + '\n}').join(',\n')
const runtime = '(function(){const factories={' + bundled + '};const cache={};function load(name){if(cache[name])return cache[name].exports;const module={exports:{}};cache[name]=module;factories[name](module,module.exports,function(spec){const base=name.split("/");base.pop();spec.split("/").forEach(part=>{if(part==="..")base.pop();else if(part!==".")base.push(part)});return load(base.join("/"))});return module.exports}window.demoModules={store:load("utils/store"),favorites:load("utils/favorites"),advice:load("utils/advice")}})();'
fs.writeFileSync(path.join(root, 'design', 'interaction-runtime.js'), runtime.replace('advice:load("utils/advice")', 'advice:load("utils/advice"),refs:load("utils/refs"),help:load("utils/reading-help"),sectionGuide:load("utils/section-guide"),share:load("utils/share"),shareCover:load("utils/share-cover"),packData:load("data/reading-pack")'))
const styles = [
  'app.wxss', 'components/item-row/index.wxss',
  'pages/item-detail/index.wxss', 'pages/search/index.wxss', 'pages/index/index.wxss',
  'subpackages/read/pages/section-detail/index.wxss',
]
let css = styles.map((file) => fs.readFileSync(path.join(root, 'miniprogram', file), 'utf8')).join('\n')
css = css.replace(/@import[^;]+;/g, '').replace(/@media \(prefers-color-scheme: dark\)\s*\{\s*page\s*\{([^}]+)\}\s*\}/, '.phone[data-theme="dark"] {$1}')
css = css.replace(/\bpage\s*\{/g, '.phone {').replace(/(-?\d*\.?\d+)rpx/g, (match, number) => Number(number) / 2 + 'px')
fs.writeFileSync(path.join(root, 'design', 'interaction-generated.css'), css)
console.log('Generated interaction runtime and CSS from mini-program sources')
