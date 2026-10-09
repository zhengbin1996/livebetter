# 部署操作清单

> 架构、数据分层、设计取舍看 [README.md](./README.md)。这个文件只有「点哪里、填什么」。
> 已按你的选择固化：**企业/个体户主体** + **Release 放在公开仓库**（`syncIngest` 匿名下载，无需 PAT）。

---

## 阶段 0 · 建公开仓库并推送

- [ ] GitHub 新建仓库，**Visibility 选 Public**，且**不要**勾选自动生成 README / .gitignore / License（本地已经有了）
- [ ] 在项目根目录推送：

```bash
git remote add origin https://github.com/<你的用户名>/<仓库名>.git
git push -u origin main
```

- [ ] 确认默认分支是 **main** —— 工作流的 `push` 触发只监听 main（定时任务不受影响）
- [ ] 记下 `<你的用户名>/<仓库名>`，阶段 2 的 `SOURCE_REPO` 就是它

> 推送后 Actions 会自动跑一次：**只发布 Release、跳过入云**（`SYNC_URL` 还没配），
> 日志里有黄色 warning 属于预期，不是错误。本地首次提交是 `feat: 高性价比人生指南小程序首版`。

---

## 阶段 1 · 微信侧

- [ ] `project.config.json` → `appid` 换成你的 AppID。
      **现在是 `touristappid`（游客模式），这种模式下云开发根本开不了，第 1、2 阶段一步都走不下去。**
- [ ] 开发者工具打开项目 → 云开发 → 开通 → 把环境 ID 填进 `miniprogram/config.js` 的 `CLOUD_ENV`
      （只有一个环境时可以留空）
- [ ] 云开发控制台 → 数据库 → 建集合 **`manifest`**，权限设 **「所有人不可读写」**
      （`user_data` 不用建，`getUserData` 首次写入会自动创建）
- [ ] 右键上传并部署 **4 个**云函数，选「上传并部署：云端安装依赖」：
      `getVersion`、`searchServer`、`getUserData`、`syncIngest`

---

## 阶段 2 · 打通每日同步

- [ ] `syncIngest` → 配置 → 环境变量：**`SOURCE_REPO=<你的用户名>/<仓库名>`**（必填）
- [ ] 同上加 `SYNC_TOKEN=<一串随机字符>`（可选，建议设）
- [ ] `syncIngest` → 触发方式 → 添加 **HTTP 访问服务**，记下地址
- [ ] 同上 → 添加 **定时触发器**：每天一次，参数 `{"token":"<与上面同一个随机字符>"}`
      （GitHub 抖动或 Actions 失败时的兜底）
- [ ] GitHub 仓库 → Settings → Secrets and variables → Actions：
  - Variables：`SYNC_URL` = 上一步拿到的 HTTP 地址
  - Secrets：`SYNC_TOKEN` = 与云函数里那只一致
- [ ] Actions → 「同步上游内容」→ Run workflow（可勾 force 强制重跑）
      → 期望看到 `done: true`、`remaining` 归零、`syncStatus: ok`

---

## 阶段 3 · 真机验收

这几项最容易只在真机上暴露，逐条过一遍：

- [ ] **断网**首次打开也能看到目录 → 主包内置索引生效
- [ ] 点开任意一节 → 分片下载完成 → 六字段分层渲染（成本标签 / 说人话 / 收益 / 证据等级 / 来源 / 备注）
- [ ] 正文里的交叉引用可点、能跳到目标条目；术语可弹释义
- [ ] 检索「低钠盐」能命中 → 服务端归一化口径与构建期一致
- [ ] 三维成本（钱/时间/毅力）+ 证据等级 + 性价比 组合筛选正常
- [ ] 「下载全书」→ 断网 → 正文仍可读（走 `USER_DATA_PATH`，不是 `setStorage`）
- [ ] 收藏 / 打卡 → 换账号登录，数据互不可见
- [ ] 版本页显示上游 commit 日期，与上游一致
- [ ] 深色模式 / 浅色模式都读得清

---

## 阶段 4 · 提审

- [ ] 小程序名称定了之后，只改两处：`miniprogram/config.js` 的 `APP_NAME`
      与 `miniprogram/app.json` 的 `window.navigationBarTitleText`
      —— **`BOOK_NAME` 不要动**，那是 CC BY 4.0 要求的书名署名
- [ ] 类目选择（内容/阅读类，按主体资质能选到的为准）
- [ ] 截图与简介
- [ ] 确认「关于」页的免责声明与 CC BY 4.0 三条件（署名 / 许可链接 / 标明改动）都在
- [ ] 首次提审建议先不接 AI 问答，减少内容安全审核面

---

## 附一：配置值对照

| 值 | 填在哪 | 内容 |
| --- | --- | --- |
| `appid` | `project.config.json` → `appid` | 你的小程序 AppID（现为 `touristappid`） |
| `CLOUD_ENV` | `miniprogram/config.js` → `CLOUD_ENV` | 云开发环境 ID（仅一个环境可留空） |
| `SOURCE_REPO` | 云函数 `syncIngest` 环境变量 | `<用户名>/<仓库名>`，即发 Release 的**公开**仓库 |
| `SYNC_TOKEN` | `syncIngest` 环境变量 + 仓库 Secrets | 同一串随机字符 |
| `SYNC_URL` | 仓库 Variables | `syncIngest` 的 HTTP 访问地址 |

---

## 附二：最容易踩的五个坑

1. **`touristappid` 开不了云开发** —— 这是最卡人的一条，必须先换真实 AppID 再往下走。
2. **Release 宿主仓库必须是 Public** —— `syncIngest` 用
   `https://github.com/<SOURCE_REPO>/releases/download/...` 匿名下载，私有仓库直接 404。
3. **默认分支必须叫 `main`** —— `push` 触发写死了 `branches: [main]`；叫 `master` 的话
   只有每天 05:17 的定时任务会跑，改 `build/**` 不会触发。
4. **`manifest` 集合要先建** —— `syncIngest` 翻转时写不进去会报错；权限设「所有人不可读写」。
5. **HTTP 访问服务与定时触发器都要手动加** —— 传完云函数不会自动带触发方式，
   少了它们 Actions 那边 `SYNC_URL` 没有可指向的地址。
