Component({
  data: {
    selected: 0,
    list: [
      { path: '/pages/index/index', text: '今天' },
      { path: '/pages/search/index', text: '检索' },
      { path: '/pages/checkin/index', text: '清单' },
      { path: '/pages/about/index', text: '关于' },
    ],
  },
  methods: {
    onTap(e) {
      const i = e.currentTarget.dataset.i
      const item = this.data.list[i]
      if (!item || i === this.data.selected) return
      wx.switchTab({ url: item.path })
    },
    /** 页面 onShow 里调：this.getTabBar().setTab(0) */
    setTab(i) {
      this.setData({ selected: i })
    },
  },
})
