const refs = require('../../utils/refs')

Component({
  properties: {
    show: { type: Boolean, value: false },
    term: { type: String, value: '' },
  },
  data: {
    entry: { term: '', meaning: '' },
    total: 0,
  },
  observers: {
    term(t) {
      if (!t) return
      const app = getApp()
      const list = (app && app.globalData.essentials && app.globalData.essentials.glossary) || []
      const found = refs.glossaryOf(t)
      this.setData({
        entry: found || { term: t, meaning: '术语表里没有这一条。' },
        total: list.length,
      })
    },
  },
  methods: {
    onClose() {
      this.triggerEvent('close')
    },
    noop() {},
  },
})
