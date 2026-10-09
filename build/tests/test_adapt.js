/**
 * syncIngest 入口适配逻辑的本地自测（不需要云环境）。
 * 跑法：node build/tests/test_adapt.js
 *
 * 这一层覆盖的是「HTTP 访问服务 vs callFunction/定时触发器」两种 event 结构，
 * 写错的症状分别是「公网调用永远 BAD_TOKEN」和「调用方拿到被二次转义的 JSON」，
 * 线上极难定位 —— 所以必须有本地断言。
 */
const adapt = require('../../cloudfunctions/syncIngest/adapt')

let failed = 0
function ok(name, cond, extra) {
  if (cond) console.log('  PASS ' + name)
  else {
    failed += 1
    console.log('  FAIL ' + name + (extra ? '  -> ' + extra : ''))
  }
}

/* ------------------------------------------------ isHttpEvent：区分触发方式 */

ok('callFunction 的 event 不算 HTTP', adapt.isHttpEvent({ token: 'x' }) === false)
ok('空 event 不算 HTTP', adapt.isHttpEvent({}) === false)
ok('定时触发器不算 HTTP', adapt.isHttpEvent({ Type: 'Timer', TriggerName: 'dailySyncFallback' }) === false)
ok(
  'HTTP 访问服务的 event 能识别',
  adapt.isHttpEvent({ path: '/syncIngest', httpMethod: 'POST', body: '{}' }) === true
)
ok('只有 path 也认', adapt.isHttpEvent({ path: '/syncIngest' }) === true)

/* ------------------------------------------------ unwrapEvent：取业务参数 */

{
  const raw = { token: 'abc', force: true }
  ok('非 HTTP 时原样返回', adapt.unwrapEvent(raw) === raw)
}
{
  // 真实形态：body 是字符串，不是对象
  const raw = {
    path: '/syncIngest',
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: 'abc', force: true }),
    isBase64Encoded: false,
  }
  const ev = adapt.unwrapEvent(raw)
  ok('HTTP 时从 body 字符串里取到 token', ev.token === 'abc', JSON.stringify(ev))
  ok('HTTP 时从 body 字符串里取到 force', ev.force === true)
}
{
  const raw = { httpMethod: 'POST', body: '{"continue":true}' }
  ok('continue 透传', adapt.unwrapEvent(raw).continue === true)
}
{
  const raw = { httpMethod: 'POST', body: '不是 JSON' }
  const ev = adapt.unwrapEvent(raw)
  ok('body 不是 JSON 时降级为空对象而不是抛错', ev && Object.keys(ev).length === 0, JSON.stringify(ev))
}
{
  const raw = { httpMethod: 'POST', body: { token: 'obj' } }
  ok('body 已经是对象时直接用', adapt.unwrapEvent(raw).token === 'obj')
}
{
  const raw = { httpMethod: 'GET', queryStringParameters: { token: 'fromq' } }
  ok('GET 时能从 query 取 token', adapt.unwrapEvent(raw).token === 'fromq')
}
{
  const raw = { httpMethod: 'POST', body: '{"token":"b"}', queryStringParameters: { debug: '1' } }
  const ev = adapt.unwrapEvent(raw)
  ok('body 与 query 合并', ev.token === 'b' && ev.debug === '1', JSON.stringify(ev))
}

/* ------------------------------------------------ httpReply：回包结构 */

{
  const r = adapt.httpReply({ ok: true, remaining: 3 })
  ok('HTTP 回包带 statusCode 200', r.statusCode === 200)
  ok('HTTP 回包带 JSON Content-Type', String(r.headers['Content-Type']).indexOf('application/json') === 0)
  ok('HTTP 回包 body 是字符串（否则会被二次转义）', typeof r.body === 'string')
  ok('HTTP 回包 body 能解析回原对象', r.body && JSON.parse(r.body).remaining === 3)
}

/* ------------------------------------------------ clampBudget：夹在安全区间 */

ok('未指定时用默认值', adapt.clampBudget(undefined, 40000) === 40000)
ok('非法值用默认值', adapt.clampBudget('abc', 40000) === 40000)
ok('过小被抬到下限', adapt.clampBudget(1, 40000) === adapt.MIN_BUDGET)
ok('过大被压到上限（不能撞上函数 60s 硬超时）', adapt.clampBudget(999999, 40000) === adapt.MAX_BUDGET)
ok('正常值原样保留', adapt.clampBudget(30000, 40000) === 30000)
ok('字符串数字也接受', adapt.clampBudget('20000', 40000) === 20000)
ok('上限必须小于云函数 60 秒硬超时', adapt.MAX_BUDGET < 60000)

console.log(failed ? `\n${failed} 项失败` : '\n全部通过')
process.exit(failed ? 1 : 0)
