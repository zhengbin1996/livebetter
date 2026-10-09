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
})
