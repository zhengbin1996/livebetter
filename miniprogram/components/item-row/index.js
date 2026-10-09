Component({
  properties: {
    item: { type: Object, value: null },
    /** 检索结果需要显示所属节 */
    showSec: { type: Boolean, value: false },
    labelMap: { type: Object, value: null },
    fav: { type: Boolean, value: false },
  },
  data: {
    num: '',
    disputed: false,
    secTag: '',
  },
  observers: {
    'item, showSec': function (item, showSec) {
      const it = item || {}
      this.setData({
        num: it.num != null ? String(it.num) : '',
        disputed: !!it.dispute,
        secTag: showSec ? `${it.sec || ''} 节` : '',
      })
    },
  },
  methods: {
    onTap() {
      const it = this.data.item
      if (!it) return
      this.triggerEvent('tapitem', { sid: it.sid, item: it })
    },
  },
})
