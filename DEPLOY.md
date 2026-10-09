# 部署操作清单

> 架构、数据分层、设计取舍看 [README.md](./README.md)。这个文件只有「点哪里、填什么」。  
> 已按你的选择固化：**企业/个体户主体** + **Release 放在公开仓库**（`syncIngest` 匿名下载，无需 PAT）。

---

## 阶段 0 · 建公开仓库并推送 ✅ 已完成

- [x] GitHub 新建公开仓库
- [x] 推送完成：`https://github.com/zhengbin1996/livebetter`，默认分支 `main`
- [x] 首次流水线已验证通过（Release `content-latest` 已发布 **182 个资产 / 8.04 MB**）

> **首次推送不会自动触发 Actions** —— 这是 GitHub 的规则：推送到**新分支**时，路径过滤只按  
> 最深提交的父提交做两点 diff（上限 300 文件），所以新建 `main` 的那一次推送，过滤看到的  
> 改动可能不含 `build/**`，工作流被**静默跳过**（不报错、Actions 页没有任何记录）。  
> 首次需到 **Actions → 同步上游内容 → Run workflow** 手动跑一次，或等次日 05:17 定时任务。  
> 此后每条推送都是 head 与 base SHA 直接比较，路径过滤正常工作。

---

## 阶段 1 · 微信侧

- [x] `project.config.json` → `appid` = `wx0bcbaa8e93eaefc5`
- [ ] ⚠️ **核对 `miniprogram/config.js` 的 `CLOUD_ENV`** —— 现在填的是 `wx0bcbaa8e93eaefc5`，  
  那是 **AppID**，不是环境 ID。环境 ID 在云开发控制台首页／设置里，**形如 `cloud1-xxxxxxxx`**  
  （`wx` 开头的一定是 AppID）。  
  填错的症状：不报错，但小程序端云调用全部静默失败，`syncState` 永远是 `offline`。
- [ ] 开发者工具打开项目 → 顶部「云开发」→ 开通（首次需同意协议；选按量付费，有免费额度）
- [ ] 云开发控制台 → 设置 → 复制**环境 ID** → 填回 `miniprogram/config.js` 的 `CLOUD_ENV`
- [ ] 开发者工具左侧 `cloudfunctions/` 右键 → 云开发环境 → 选中刚建的环境  
  （文件夹名显示「未指定环境」时必做，否则云函数列表为空）
- [ ] 云开发控制台 → 数据库 → 建集合 **`manifest`**，权限设 **「所有人不可读写」**  
  （`user_data` 不用建，`getUserData` 首次写入会自动创建）
- [ ] 右键上传并部署 **4 个**云函数，选「上传并部署：云端安装依赖」：  
  `getVersion`、`searchServer`、`getUserData`、`syncIngest`

---

## 阶段 2 · 打通每日同步

链路：**GitHub Actions 构建并发 Release → 云函数 `syncIngest` 把资产搬进云存储并翻转 manifest → 小程序启动时问 `getVersion` 切版本**。

下面 6 步，2.1～2.4 在云开发控制台，2.5 在 GitHub，2.6 回来验证。

### 2.1 先改云函数超时时间（**最容易漏，漏了必失败**）

云函数默认超时只有 **3 秒**，而 `syncIngest` 单次要搬 40 秒、`searchServer` 要下载 3.7 MB 语料建索引。  
不改的表现是「HTTP 500 或调用直接超时，点开云函数日志却什么都没有」。

云开发控制台 → 云函数 → 选中函数 → **配置** → **超时时间**：

| 云函数            | 改成       | 原因                                    |
| -------------- | -------- | ------------------------------------- |
| `syncIngest`   | **60 秒** | 单次时间预算 `BUDGET_MS=40000`，3 秒连一个分片都搬不完 |
| `searchServer` | **20 秒** | 首次要下载并解析 3.7 MB 语料                    |
| `getVersion`   | 默认（3 秒）  | 只读一个文档                                |
| `getUserData`  | 默认（3 秒）  | 只读写一个文档                               |

### 2.2 配 `syncIngest` 的环境变量

云开发控制台 → 云函数 → `syncIngest` → **配置** → **环境变量**：

| 变量            | 值                         | 说明                     |
| ------------- | ------------------------- | ---------------------- |
| `SOURCE_REPO` | `zhengbin1996/livebetter` | ✅ **必填**，Release 所在仓库  |
| `SYNC_TOKEN`  | 自己生成一串随机字符                | 可选但建议。只拦**公网 HTTP 调用** |
| `BUDGET_MS`   | 默认 `40000`                | 可选。若公网调用老超时就调成 `20000` |

> 定时触发器由平台内部调起，event 里没有 token，代码已做区分，**不会被 `SYNC_TOKEN` 拦住**。

### 2.3 开「HTTP 访问服务」（给 Actions 一个能调的公网地址）

云开发控制台 → **HTTP 访问服务** → **新建**：

- 关联资源类型：**云函数** → 选 `syncIngest`
- 域名：**默认域名**
- 触发路径：`/syncIngest`
- 鉴权方式：**免鉴权**（防护靠上面的 `SYNC_TOKEN`；选「云鉴权」会让 Actions 调不通）

完成后得到形如 `https://<环境ID>.service.tcloudbase.com/syncIngest` 的地址，**复制下来**。

### 2.4 定时触发器（兜底：GitHub 抖动 / Actions 失败时）

**已经写在 `cloudfunctions/syncIngest/config.json` 里**，部署云函数时会自动带上（每天北京时间 05:17）。

- 若控制台里没看到：云函数 → `syncIngest` → **触发方式** → 添加**定时触发器**，  
  cron 填 `0 17 5 * * * *`（**7 位**：秒 分 时 日 月 周 年，与 Linux 的 5 位不同）
- 定时触发器**不需要填 token 参数**

### 2.5 把地址与令牌回填到 GitHub

仓库 → **Settings → Secrets and variables → Actions**：

- **Variables** → New repository variable：`SYNC_URL` = 2.3 拿到的地址
- **Secrets** → New repository secret：`SYNC_TOKEN` = 2.2 里那一串（**必须完全一致**）

### 2.6 跑一次，确认打通

GitHub → **Actions** → 左侧「同步上游内容」→ **Run workflow** → **Run workflow**

期望日志（脚本会反复调用云函数，直到搬完）：

```
目标版本 v20261009-a994b6a → https://xxx.service.tcloudbase.com/syncIngest
  [第 1 轮] 已上传 46，累计 46，剩余 136，失败 0
  [第 2 轮] 已上传 48，累计 94，剩余 88，失败 0
  ...
  [第 N 轮] 翻转完成：版本 v20261009-a994b6a，分片 182，失败 0，状态 ok
```

**对照排错：**

| 日志 / 现象                | 原因                                    |
| ---------------------- | ------------------------------------- |
| `云函数报错：BAD_TOKEN`      | 仓库 Secrets 的 `SYNC_TOKEN` 与云函数环境变量不一致 |
| `云函数报错：NO_SOURCE_REPO` | 2.2 的 `SOURCE_REPO` 没填                |
| `云函数报错：FETCH_MANIFEST` | `SOURCE_REPO` 写错，或 Release 仓库不是公开的    |
| `HTTP 404`             | 触发路径没写对，或 HTTP 访问服务没生效                |
| `HTTP 502` / 调用超时      | 2.1 的超时时间没改大；或把 `BUDGET_MS` 调小        |
| 一直「已上传 0，剩余 N」         | 云存储写入或分片下载有问题，看云函数日志                  |

### 2.7 顺手确认小程序端

开发者工具重新编译 → 首页「版本条」应显示云上版本；「关于」页点「立即同步」也应能拿到版本。

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

| 值             | 填在哪                                   | 内容                                      |
| ------------- | ------------------------------------- | --------------------------------------- |
| `appid`       | `project.config.json` → `appid`       | `wx0bcbaa8e93eaefc5`（已填）                |
| `CLOUD_ENV`   | `miniprogram/config.js` → `CLOUD_ENV` | **云开发环境 ID**（形如 `cloud1-xxxx`，不是 AppID） |
| `SOURCE_REPO` | 云函数 `syncIngest` 环境变量                 | `zhengbin1996/livebetter`               |
| `SYNC_TOKEN`  | `syncIngest` 环境变量 + 仓库 Secrets        | 同一串随机字符                                 |
| `SYNC_URL`    | 仓库 Variables                          | `syncIngest` 的 HTTP 访问地址                |
| 超时时间          | 云函数配置                                 | `syncIngest` 60 秒、`searchServer` 20 秒   |

---

## 附二：最容易踩的六个坑

1. **云函数默认超时 3 秒** —— `syncIngest` / `searchServer` 必须手动改大（60s / 20s），  
   否则表现是「HTTP 500 或直接超时，云函数日志里什么都没有」，最难查。
2. **`CLOUD_ENV` 填成了 AppID** —— 环境 ID 形如 `cloud1-xxxx`，`wx` 开头的是 AppID。  
   填错不报错，只是云调用静默失败、`syncState` 永远是 `offline`。
3. **HTTP 访问服务的 event 结构与 `callFunction` 完全不同** —— 它把请求包成  
   `{path, httpMethod, headers, queryStringParameters, body}`，业务参数在 **body 字符串**里，  
   直接读 `event.token` 只会拿到 `undefined`。本项目已在 `cloudfunctions/syncIngest/adapt.js`  
   统一适配并有单测；自己写别的云函数时要留意。
4. **Release 宿主仓库必须是 Public** —— `syncIngest` 用  
   `https://github.com/<SOURCE_REPO>/releases/download/...` 匿名下载，私有仓库直接 404。
5. **默认分支必须叫 `main`** —— `push` 触发写死了 `branches: [main]`。
6. **`manifest` 集合要先建** —— `syncIngest` 翻转时写不进去会报错；权限设「所有人不可读写」。
