const fmt = require('../../utils/fmt')

Component({
  properties: {
    level: { type: String, value: '一般' }, // 极高 | 高 | 一般
    showText: { type: Boolean, value: false },
    sm: { type: Boolean, value: false },
  },
  data: { rank: 1 },
  observers: {
    level(v) {
      this.setData({ rank: fmt.tierRank(v) })
    },
  },
  lifetimes: {
    // 兜底：不同基础库对「属性 observers 在实例化时是否触发」的行为不完全一致，
    // 这里再算一次，保证首屏配色就对（rank 决定 .tier.rN 的配色）。
    attached() {
      const rank = fmt.tierRank(this.data.level)
      if (rank !== this.data.rank) this.setData({ rank })
    },
  },
})
