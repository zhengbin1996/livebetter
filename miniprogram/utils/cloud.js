const config = require('../config')

/**
 * 云函数调用封装：统一超时与错误形态。
 * 所有云调用都经过这里，方便以后换实现（比如换成自建后端）时只改一处。
 */
function call(name, data, opts) {
  const timeout = (opts && opts.timeout) || config.CLOUD_TIMEOUT
  return new Promise((resolve, reject) => {
    if (!wx.cloud) {
      reject(new Error('当前基础库不支持云开发'))
      return
    }
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error('云函数 ' + name + ' 超时'))
    }, timeout)

    wx.cloud.callFunction({
      name,
      data: data || {},
      success(res) {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(res.result)
      },
      fail(err) {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(err)
      },
    })
  })
}

/**
 * 下载云存储文件。用 wx.cloud.downloadFile 而不是 wx.downloadFile ——
 * 前者走云开发通道，不受 request/downloadFile 合法域名白名单限制。
 */
function download(fileID) {
  return new Promise((resolve, reject) => {
    wx.cloud.downloadFile({
      fileID,
      success: (res) => resolve(res.tempFilePath),
      fail: reject,
    })
  })
}

module.exports = { call, download }
