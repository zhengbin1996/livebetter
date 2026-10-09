# 高性价比人生指南 · 微信小程序

把开源电子书 **[eternity4719/HowToLiveBetter](https://github.com/eternity4719/HowToLiveBetter)**（《高性价比人生指南》）
做成了一个微信小程序：**浏览、阅读、全文检索、理解**，并且**每天自动同步上游最新内容**。

> 内容版权归原作者所有，采用 **CC BY 4.0** 许可。本程序只做结构化与排版呈现，
> **不改写任何原文与数字**。署名、许可链接、改动说明见小程序「关于」页。
> 仓库目录 `HowToLiveBetter/`（本项目）与上游 `upstream/`（只读快照）是两件事。

---

## 一、它长什么样

| 页面 | 做什么 |
| --- | --- |
| 首页 | 版本条（含上游提交日期）、按「问题」入口、34 节目录、长文入口、**下载全书** |
| 检索 | 全文检索 + 三维成本（钱/时间/毅力）+ 证据等级 + 性价比 + 口径 + 章节筛选 |
| 清单 | 收藏夹 + 打卡清单（「要做的」/「收藏」两个 tab），本地优先、多端合并 |
| 关于 | 版本与同步历史、许可与署名、下载全书、清理缓存、免责声明 |
| 条目详情 | 六个字段分层呈现（成本标签 / 说人话 / 收益 / 证据等级 / 来源 / 备注）、交叉引用可点、术语可弹释义 |
| 单节阅读 | 节导语 + 分组目录 + 条目列表，可按条号滚动定位 |
| 长文 / 核实记录 | 长文带大纲跳转；135 篇核实记录带本地筛选 |

---

## 二、目录结构

```
build/                 构建期：把上游 markdown 解析成分层 JSON
  common.py            路径、稳定 ID、文本归一化（检索口径的唯一来源）
  parse.py             主流程（含 README 统计自校验）
  refs.py              交叉引用解析与重写
  glossary.py          术语表抽取与正文标注
  mdhtml.py            markdown → HTML（构建期渲染）
  idmap.py             条目 ID 迁移表（标题改动后收藏不丢）
  fetch_upstream.py    拉上游 tarball（先定 commit 再下载）
  stage_release.py     按 Release 资产命名规则摊平 dist/
  trigger_sync.py      反复调云函数直到入云完成
  check_miniprogram.py 小程序静态完整性检查（路径/导出/体积）
  tests/               Node 自测（检索 / 合并逻辑）

cloudfunctions/        云函数（Node）
  getVersion/          返回当前 manifest（客户端启动时调一次）
  searchServer/        全文检索（语料只在服务端）
  getUserData/         收藏与打卡（openid 隔离，LWW 合并）
  syncIngest/          把 Release 资产搬进云存储并原子翻转 manifest

miniprogram/           小程序主体
  data/essentials.json 主包内置索引（构建时自动同步，必须入库）
  utils/               config / cloud / content / store / fmt / refs
  components/          成本标签、证据徽章、性价比刻度、条目行、术语弹层、mp-html
  custom-tab-bar/      自定义 tabBar
  pages/               首页 / 检索 / 清单 / 关于 / 分节列表 / 条目详情
  subpackages/read/    单节阅读、长文阅读、核实记录
  subpackages/mine/    术语表、版本与同步

.github/workflows/sync.yml   每日同步流水线
dist/                        构建产物（.gitignore，由 Actions 发布 Release）
```

---

## 三、数据分层：为什么不能全塞进主包

微信小程序主包上限 **2 MB**，`wx.setStorage` 单 key 上限约 **1 MB**，
而全书正文约 **8 MB**。所以按「多常读 / 多大」分层：

| 层 | 内容 | 体积 | 位置 | 何时到达客户端 |
| --- | --- | --- | --- | --- |
| essentials | 34 节目录、问题表、术语表、图例、长文目录 | ~67 KB | **主包内置** | 安装即有 |
| book/NN.json | 34 个节分片（含条目 HTML） | 共 ~4 MB | 云存储 | 点开该节时下载 |
| docs/*.json | 9 篇长文 + 引用对照 | ~1 MB | 云存储 | 打开该篇时下载 |
| docs/verify/*.json | 135 篇核实记录 | ~2 MB | 云存储 | 打开该篇时下载 |
| search/corpus.json | 检索语料（含归一化全文） | ~3.7 MB | 云存储 | **不下发**，仅供云函数检索 |

「下载全书」会把所有可下发的分片落到 `wx.env.USER_DATA_PATH` 的文件系统里
（不用 `setStorage`，避开单 key 1 MB 上限），之后完全离线可读。
缓存按**版本号分目录**隔离，上游更新后旧版仍在，正在读的页面不会突然变样。

---

## 四、每天是怎么同步的

```
GitHub Actions（每天 05:17 北京时间 / build/ 变更时）
  1. fetch_upstream.py   定住上游 commit → 下载该 commit 的 tarball → upstream/
  2. parse.py            解析成 dist/，并用 README 公布的数字自校验
                         （675 条 / A438 B182 C55 / 极高114 高303 一般258 / 失效引用 0）
  3. node tests/*.js     检索与合并逻辑单测
  4. stage_release.py    校验 sha256，按资产命名规则摊平到 release/
  5. gh release upload   发布到固定标签 content-latest
  6. trigger_sync.py     反复调 syncIngest 直到入云完成（**配了 HTTP 访问服务才走这一步**）
        ↓
云函数 syncIngest
    由定时触发器每 10 分钟叫醒一次（不依赖公网入口）：
    下载资产 → 校验 sha256 → 上传云存储 → 写进度 → 全部就位后**原子翻转** manifest/current
        ↓
小程序启动
    getVersion 拿 manifest → 版本变了就切到新分片（无需发版）
```

几个刻意的设计：

- **云函数当 GitHub 的中继**。正式版小程序的 `wx.request` 合法域名必须已 ICP 备案，
  `github.com` / `raw.githubusercontent.com` 配不进白名单；云函数出站不受此限，
  既省事又不用自购备案域名。
- **解析放在 Actions，不放云函数**。构建脚本有单测、可回滚、不受云函数 60 秒超时限制；
  云函数只做「下载 → 校验 → 上传 → 翻转」，职责单一。
- **断点续传**。180+ 个分片一次搬不完，每次调用干到时间预算用完就返回 `remaining`，
  调用方反复调到 0。
- **先写暂存、后翻指针**。只有全部分片就位才更新线上 manifest，中途失败线上完全不受影响。
- **partial 会被重试**。个别分片始终失败时仍翻转（避免永远同步不上），
  但标 `syncStatus: partial`；下次调用会重新尝试，因为「跳过」的条件是 `syncStatus === 'ok'`。
- **每天一份版本，而不是「覆盖」**。版本号形如 `v20261009-a994b6a`，权威键是完整 commit sha
  （上游一天可能提交多次，用日期当键会撞）。

---

## 五、部署步骤

> 逐步操作清单见 **[DEPLOY.md](./DEPLOY.md)**（含配置值对照表与最容易踩的坑）。

### 1. 建云开发环境

微信开发者工具里开通云开发，拿到环境 ID，填进 `miniprogram/config.js` 的 `CLOUD_ENV`
（只有一个环境可以留空）。

### 2. 建数据库集合

在云开发控制台建一个集合：**`manifest`**（单文档，`_id = current`，由 `syncIngest` 自己写）。

`user_data` 集合**不用手建**：`getUserData` 首次写入时会自动创建
（并在文档 `_id` 上使用 openid 做天然隔离，所以没有登录页、没有授权弹窗）。

集合权限建议设为「仅创建者可读写」或「所有人不可读写」——所有访问都经云函数，
客户端不直连数据库。

### 3. 部署四个云函数

在开发者工具里右键 `cloudfunctions/` 下的每个目录 → 「上传并部署：云端安装依赖」。

| 云函数 | 需要的环境变量 |
| --- | --- |
| `getVersion` | 无 |
| `searchServer` | 无 |
| `getUserData` | 无 |
| `syncIngest` | `SOURCE_REPO`（**必填**，你发布 Release 的仓库，形如 `yourname/HowToLiveBetter`）、`RELEASE_TAG`（默认 `content-latest`）、`BUDGET_MS`（默认 40000）、`SYNC_TOKEN`（可选，设了就要跟 Actions 里一致） |

### 4. 给 `syncIngest` 加触发方式

- **定时触发器（默认，已配好，不用操作）**：`cloudfunctions/syncIngest/config.json` 里声明了
  `0 */10 * * * *` = **每 10 分钟**查一次上游 Release，有新版本就入云，没有就直接跳过。
  所以**入云不依赖任何公网入口**，不配下面的 HTTP 访问服务也能全自动同步。
  （每 10 分钟而不是每天一次，是因为云函数单次 60 秒只能搬约 45 个分片，
  一次同步要搬 183 个 ⇒ 需要多轮才能追平。）
- **HTTP 访问服务（可选）**：想让 GitHub Actions 一构建完就入云、并在 Actions 日志里看到全过程时再加。
  云开发控制台 → 环境管理 → HTTP 访问服务 → 开启页面顶部总开关 → 路由管理 → 新建
  （资源类型 = 云函数、资源 = `syncIngest`、域名 = 默认域名、触发路径 = `/syncIngest`、
  身份认证 = 关闭）。拿到形如 `https://<env-id>.service.tcloudbase.com/syncIngest` 的地址。

### 5. 配仓库 Actions（**只有加了 HTTP 访问服务才需要**）

仓库 Settings → Secrets and variables → Actions：

| 类型 | 名称 | 值 |
| --- | --- | --- |
| Variables | `SYNC_URL` | 上一步那个 HTTP 地址 |
| Secrets | `SYNC_TOKEN` | 与云函数 `SYNC_TOKEN` 一致（没设就留空） |

然后手动跑一次 `同步上游内容` 工作流（`workflow_dispatch`），确认 Release 资产发布
且 `syncIngest` 把内容搬完。之后每天北京时间 05:17 会自动构建。
不配也没关系：`SYNC_URL` 为空时工作流只打印一条 warning 跳过入云，内容由定时触发器搬。

> 工作流的 `push` 触发只监听 `build/**` 与工作流文件本身，所以改前端不会误触发内容同步。

### 6. 配 AppID 与小程序名称

- `project.config.json` 的 `appid` 目前是 `touristappid`（占位），换成你自己的。
- 名称待定，改名只动两处：`miniprogram/config.js` 的 `APP_NAME`
  与 `miniprogram/app.json` 的 `window.navigationBarTitleText`。
  **`BOOK_NAME` 不要跟着改**——它是 CC BY 4.0 要求的书名署名。

---

## 六、本地开发

```bash
# 需要 Python 3.11+ 与 Node 20+

# 1) 拉上游内容到 upstream/
python build/fetch_upstream.py

# 2) 解析成 dist/，同时把 essentials 同步进 miniprogram/data/
python build/parse.py
python build/parse.py --stats        # 只跑统计自校验
python build/parse.py --no-corpus    # 跳过 3.7 MB 的检索语料，快速迭代

# 3) 小程序静态完整性检查（页面齐全 / 相对路径 / 导出 / 体积）
python build/check_miniprogram.py

# 4) 逻辑单测
node build/tests/test_search.js
node build/tests/test_merge.js

# 5) 本地检查 Release 资产命名与 sha256（不写盘）
python build/stage_release.py --check
```

**改了 `parse.py` 之后一定要重跑一次**，并确认第 5 步的自校验全部 `OK` ——
它是唯一能证明「我们算的性价比档和作者公布的一致」的手段。

---

## 七、几个关键实现选择

- **条目主键不用条号**。上游规则是新增追加在节末，但**删条目会让整节条号整体减一**。
  所以主键取 `s{两位节号}-{标题 sha1 前 10 位}`；标题被改动时，`manifest.prevIdMap`
  给出「旧 id → 新 id」，客户端据此把收藏和打卡迁过去，用户数据不会凭空消失。
- **构建期渲染 HTML**。客户端从不解析 markdown，`mp-html` 只负责显示。
  交叉引用在构建期包成 `ref://<sid>`，术语包成 `gloss://<术语>`，渲染层不需要认识业务。
- **检索归一化口径只有一份**。`build/common.py` 的 `chars_for_search`
  与 `cloudfunctions/searchServer/search.js` 的 `normalize` 必须一致
  （小写、全角转半角、去空白），否则「搜低钠盐」就匹配不上排版成「低钠 盐」的原文。
- **检索不建倒排索引**。675 + 145 条线性扫描只要 1–6 ms，不值得为此维护一份索引结构。
  语料按版本在云函数内存里缓存，热实例上后续查询都是内存操作。
- **收藏用 tombstone 表达删除**。直接抹掉记录的话，「A 端删了、B 端还留着」时
  B 端下次上报会把它复活。
- **不用 web-view 打开外链**。DOI / GitHub 链接走复制到剪贴板，
  避免业务域名备案的麻烦。

---

## 八、合规与审核注意

- 内容含健康类表述，小程序内已显著位置放免责声明
  （`config.js` 的 `DISCLAIMER`）：**不构成医疗建议或法律意见**。
- CC BY 4.0 的三个条件都在「关于」页落实：**署名**、**许可链接**、
  **标明改动**（结构化拆分、抽取成本标签、引用与术语转链接、重新排版；文字数字未改）。
- 首次提审建议先不接 AI 问答（本项目第一版也不包含），减少内容安全审核面。

---

## 九、已知边界

- 检索默认只覆盖**条目**；长文与核实记录在没有任何筛选条件时会附带返回，
  带条目筛选时不返回（它们没有节号/成本这些维度）。
- 长文只在语料里保留前 400 字明文做结果摘要，命中位置在正文深处时摘要展示的是开篇。
- 上游若新增**节**（超过 34 节），`essentials.json` 的节索引会跟着变，
  需要重新发一次小程序版本才能让新节进入首页目录（分片本身是自动同步的）。

---

## 许可

- 内容：**CC BY 4.0**，原作者，[上游仓库](https://github.com/eternity4719/HowToLiveBetter)，
  [许可全文](https://creativecommons.org/licenses/by/4.0/)。
- 本仓库的程序代码可自行决定许可方式（建议同样宽松，便于他人复用）。
