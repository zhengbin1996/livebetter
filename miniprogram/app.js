const config = require('./config')
const cloud = require('./utils/cloud')
const content = require('./utils/content')
const store = require('./utils/store')

App({
  globalData: {
    /** 随安装内置的索引（节索引/问题表/术语表/图例），首屏与离线降级都靠它 */
    essentials: null,
    /** 云端 manifest；拿不到时为 null */
    manifest: null,
    /** 当前内容版本，形如 v20261009-a994b6a */
    version: '',
    /** 云开发是否可用 */
    cloudReady: false,
    /** 内容同步状态：ok | stale | offline | unknown */
    syncState: 'unknown',
    /** 启动时间，用于判断缓存是否过期 */
    bootAt: 0,
  },

  onLaunch() {
    this.globalData.bootAt = Date.now()
    this.ready = this.bootstrap()
  },

  /**
   * 启动流程刻意做成「先能读，再求新」：
   * 内置 essentials 先落地（保证首屏和离线可用），再去云上问有没有新版本。
   * 云开发没开通、没网、云函数报错，都不该让 app 打不开。
   */
  async bootstrap() {
    const g = this.globalData

    // 1) 内置索引：安装即有
    //    ⚠️ 这里是 .js 不是 .json —— 小程序**不支持 require JSON**，
    //    工具会给它补 `.js` 后缀并报 `module 'data/essentials.json.js' is not defined`，
    //    然后整个首屏空掉（所有数字变 undefined、问题列表为空）。
    //    所以索引由 build/parse.py 生成成 module.exports 形式的 JS 模块。
    try {
      g.essentials = require('./data/essentials.js')
      g.version = g.essentials.meta.version
    } catch (e) {
      // 不能静默：首屏会整页没数据，而页面上看不出原因，必须打到控制台
      g.essentials = null
      console.error('[app] 内置索引加载失败，首屏将没有数据：', e)
    }

    // 2) 云开发
    if (!wx.cloud) {
      g.cloudReady = false
      g.syncState = 'offline'
      return g
    }
    try {
      wx.cloud.init({ env: config.CLOUD_ENV || undefined, traceUser: true })
      g.cloudReady = true
    } catch (e) {
      g.cloudReady = false
      g.syncState = 'offline'
      return g
    }

    // 3) 问云端要 manifest
    try {
      const m = await cloud.call('getVersion', {}, { timeout: 8000 })
      if (m && m.version) {
        g.manifest = m
        store.recordSync(m)
        // 云上版本更新 → 切到新版本；本地缓存按版本目录隔离，旧版仍在，可回退
        if (m.version !== g.version) {
          g.version = m.version
          g.syncState = 'stale' // 索引已是新版，正文分片还需按需下载
        } else {
          g.syncState = 'ok'
        }
      } else {
        g.syncState = 'offline'
      }
    } catch (e) {
      g.syncState = 'offline'
    }
    return g
  },

  /** 手动重试同步（「关于」页用） */
  async refresh() {
    const g = this.globalData
    if (!g.cloudReady) return { ok: false, reason: '云开发不可用' }
    try {
      const m = await cloud.call('getVersion', {}, { timeout: 8000 })
      g.manifest = m
      store.recordSync(m)
      if (m && m.version && m.version !== g.version) g.version = m.version
      g.syncState = 'ok'
      return { ok: true, version: g.version }
    } catch (e) {
      return { ok: false, reason: (e && e.errMsg) || '同步失败' }
    }
  },

  /** 全局可读的当前版本信息 */
  versionInfo() {
    const g = this.globalData
    const e = g.essentials && g.essentials.meta
    const m = g.manifest
    const src = m || e || {}
    return {
      version: g.version || (src.version || ''),
      commit: src.upstreamCommit || src.commit || '',
      upstreamDate: src.upstreamDate || src.commitDate || '',
      syncedAt: store.readSync().at || '',
      syncState: g.syncState,
      counts: (g.manifest && g.manifest.counts) || (g.essentials && g.essentials.counts) || {},
    }
  },

  /** 内容服务（分片加载 / 下载全书） */
  content,
  config,
})
