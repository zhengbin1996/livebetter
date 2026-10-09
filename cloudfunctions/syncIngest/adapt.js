/**
 * 云函数入口适配层：把两种触发方式的 event 归一，并生成对应的返回结构。
 *
 * 为什么单独成文件
 *   跟 searchServer/search.js、getUserData/merge.js 一样，把纯逻辑摘出来才能本地单测。
 *   这一层写错的症状是「公网调用永远 BAD_TOKEN」或「调用方拿到被二次转义的 JSON」，
 *   线上极难定位，必须本地就能验。
 *
 * 两种触发方式的 event 结构完全不同：
 *   1) wx.cloud.callFunction / 定时触发器
 *      event 就是业务参数本身，例如 { token: 'xxx' }。
 *   2) HTTP 访问服务（公网 URL）
 *      整个 HTTP 请求被包成
 *      { path, httpMethod, headers, queryStringParameters, body, isBase64Encoded }，
 *      业务参数在 body 里，而且 **body 是字符串**，必须自己 JSON.parse。
 *      —— 直接读 event.token 只会拿到 undefined。
 *      返回时也必须回 { statusCode, headers, body }，且 body 要是字符串。
 */

const MIN_BUDGET = 5000
const MAX_BUDGET = 55000 // 微信云开发云函数硬超时 60s，留 5s 写进度文档

/** HTTP 触发时 event 里一定有这几类字段，callFunction 与定时器都不会有 */
function isHttpEvent(e) {
  return !!(e && (typeof e.httpMethod === 'string' || typeof e.path === 'string' || 'isBase64Encoded' in e))
}

/** 归一成业务参数 */
function unwrapEvent(e) {
  const ev = e || {}
  if (!isHttpEvent(ev)) return ev
  let biz = {}
  if (typeof ev.body === 'string' && ev.body) {
    try {
      biz = JSON.parse(ev.body)
    } catch (err) {
      biz = {}
    }
  } else if (ev.body && typeof ev.body === 'object') {
    biz = ev.body
  }
  // 顺带支持把参数挂在 query 上，方便用浏览器 / curl 直接戳一下
  return Object.assign({}, biz, ev.queryStringParameters || {})
}

/** HTTP 触发时必须回完整响应结构 */
function httpReply(result) {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(result),
  }
}

/** 把调用方指定的时间预算夹在「够用」和「不会撞上函数硬超时」之间 */
function clampBudget(value, fallback) {
  const n = Number(value)
  if (!isFinite(n) || n <= 0) return fallback
  return Math.min(Math.max(n, MIN_BUDGET), MAX_BUDGET)
}

module.exports = { isHttpEvent, unwrapEvent, httpReply, clampBudget, MIN_BUDGET, MAX_BUDGET }
