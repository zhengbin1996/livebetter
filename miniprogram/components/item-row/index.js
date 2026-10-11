const advice = require('../../utils/advice')
const favorites = require('../../utils/favorites')
const store = require('../../utils/store')

Component({
  properties: {
    item: { type: Object, value: null },
    showSec: { type: Boolean, value: false },
    labelMap: { type: Object, value: null },
    fav: { type: Boolean, value: false },
    highlight: { type: Boolean, value: false },
  },
  data: { normalized: {}, saved: false },
  observers: { item(item) { this.setData({ normalized: advice.normalize(item) }); this.refreshFavorite() } },
  lifetimes: {
    attached() { this.favoriteSubscription = favorites.subscribe(() => this.refreshFavorite()); this.refreshFavorite() },
    detached() { if (this.favoriteSubscription) this.favoriteSubscription() },
  },
  methods: {
    refreshFavorite() { this.setData({ saved: store.isFavorite((this.data.normalized || {}).sid) }) },
    onFavorite() { favorites.toggle(this.data.normalized) },
    onTap() {
      const item = this.data.normalized
      if (item.sid) this.triggerEvent('tapitem', { sid: item.sid, item })
    },
    onRetry() { this.triggerEvent('retry', { sid: this.data.normalized.sid, item: this.data.normalized }) },
  },
})
