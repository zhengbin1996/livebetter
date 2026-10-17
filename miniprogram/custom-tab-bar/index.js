Component({
  data: {
    selected: 0,
    list: [
      { path: '/pages/index/index', text: '首页', icon: 'today' },
      { path: '/pages/search/index', text: '检索', icon: 'search' },
      { path: '/pages/favorites/index', text: '收藏', icon: 'star' },
      { path: '/pages/about/index', text: '关于', icon: 'person' },
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
