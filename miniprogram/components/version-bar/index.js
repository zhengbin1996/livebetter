const fmt = require('../../utils/fmt')

Component({
  properties: {
    info: { type: Object, value: null },
    /** 列表页顶部用 compact，页面底部的「关于」区用 full */
    compact: { type: Boolean, value: false },
  },
  data: {
    upDate: '—',
    syncTime: '—',
    stateClass: 'off',
  },
  observers: {
    info(v) {
      const i = v || {}
      const state = i.syncState
      this.setData({
        upDate: i.upstreamDate ? fmt.fmtDate(i.upstreamDate) : '—',
        syncTime: i.syncedAt ? fmt.fmtMd(i.syncedAt) : '未同步',
        stateClass: state === 'ok' ? '' : state === 'stale' ? 'stale' : 'off',
      })
    },
  },
  methods: {
    onTap() {
      wx.navigateTo({ url: '/subpackages/mine/pages/version/index' })
    },
  },
})
