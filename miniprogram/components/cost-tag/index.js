const fmt = require('../../utils/fmt')

Component({
  properties: {
    tag: { type: Object, value: null },
    /** 口径的中文别名映射，来自 essentials.legend.tagLabels */
    labelMap: { type: Object, value: null },
    size: { type: String, value: 'md' }, // sm | md
    /** 为真时某格可点，回调 detail 给 {key, label, value} */
    tappable: { type: Boolean, value: false },
  },
  data: {
    cells: [],
    keys: ['money', 'time', 'will', 'benefit', 'caliber'],
  },
  observers: {
    'tag, labelMap': function (tag, labelMap) {
      this.setData({ cells: fmt.costStrip(tag, labelMap) })
    },
  },
  methods: {
    onCell(e) {
      if (!this.data.tappable) return
      const i = e.currentTarget.dataset.i
      const cell = this.data.cells[i]
      if (!cell) return
      this.triggerEvent('celltap', {
        key: this.data.keys[i],
        label: cell.k,
        value: cell.v,
      })
    },
  },
})
