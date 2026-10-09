/**
 * 全局配置。改名只需要动这里 + app.json 的 navigationBarTitleText。
 */
module.exports = {
  // ⚠️ 小程序名称待定。这里是工作名（同时也是书名，CC BY 4.0 要求署名）。
  // 若最终改成工具向的名字（如「循证清单」），改这两处即可：
  //   1) 本文件 APP_NAME
  //   2) app.json → window.navigationBarTitleText
  // 书名字段 BOOK_NAME 用于版权署名，**不要跟着改**。
  APP_NAME: '高性价比人生指南',
  BOOK_NAME: '高性价比人生指南',

  // 云开发环境 ID。留空则用默认环境（只有一个环境时可留空）。
  CLOUD_ENV: '',

  REPO_URL: 'https://github.com/eternity4719/HowToLiveBetter',
  LICENSE_NAME: 'CC BY 4.0',
  LICENSE_URL: 'https://creativecommons.org/licenses/by/4.0/',

  // 本地缓存目录（wx.env.USER_DATA_PATH 之下），正文一律落在文件系统里，
  // 不用 setStorage（单 key 1 MB 限制）
  LOCAL_ROOT: 'htb',

  // 审核口径：健康类表述必须带免责声明，避免绝对化用语
  DISCLAIMER: '本内容为生活建议，不构成医疗建议或法律意见；就医请遵医嘱，涉诉请咨询律师。',

  // 云函数调用超时（毫秒）
  CLOUD_TIMEOUT: 20000,
}
