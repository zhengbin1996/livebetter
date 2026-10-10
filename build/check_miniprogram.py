"""小程序静态完整性检查：编译前把「一类低错但必炸」的问题挡住。

检查项
  1. app.json 里的每个 page / subPackage page 是否三件套齐全（.js/.wxml/.json）
  2. tabBar 页面是否都在主包（这是硬约束：tabBar 页面不能放分包）
  3. 所有 usingComponents 的相对路径能否解析
  4. 所有 require('...') 的相对路径能否解析（并拦住 require JSON 这种不支持的写法）
  5. 页面/组件里对 utils/* 的调用，是否都在该模块的 module.exports 里
  6. 主包体积是否超 2 MB（分包是否超 2 MB）
  7. 云函数 config.json 的定时触发器 cron 是否为合法的 7 段（markdown 里抄给用户的示例也一起查）
  8. WXSS 的选择器里是否混入了非 ASCII 字符（中文类名会让解析器直接崩）
  9. 自定义 tabBar 的 wxss 里 var(--x) 引用的变量是否都在组件内定义
     （tabBar 节点不挂在 page 下，继承不到 page 变量，暗色模式会「暗底黑字」）

**为什么需要它**：小程序的相对路径是按「文件所在目录」算的，
子包页面比主包页面深两层，从主包文件拷过去的 `../../` 会**静默少一层** ——
不报语法错，真机点进去才崩。这个脚本把这类问题提前到命令行。

用法（仓库根目录）：
    python build/check_miniprogram.py
退出码非 0 表示有问题。
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import MINIPROGRAM, log  # noqa: E402

ROOT = MINIPROGRAM
MAIN_LIMIT = 2 * 1024 * 1024  # 主包 / 单个分包上限
REQUIRE_RE = re.compile(r"""require\(\s*['"]([^'"]+)['"]\s*\)""")
# 负向后顾：没有它，`wx.cloud.init(` 会被当成 `cloud.init(` 误报
CALL_RE = re.compile(r"(?<![\w.])(\w+)\.(\w+)\s*\(")
# 绑定 `const x = require('.../mod')` 到模块名 mod，以便校验 x 上调用的方法是否存在。
# 同时匹配 '../utils/content' 与 './cloud'（utils 之间的互相引用也要查）。
REQ_BIND_RE = re.compile(r"const\s+(\w+)\s*=\s*require\([^)]*/(\w+)[^)]*\)")

problems: list[str] = []


def fail(msg: str) -> None:
    problems.append(msg)
    log("  ✗ " + msg)


def ok(msg: str) -> None:
    log("  ✓ " + msg)


def rel(p: Path) -> str:
    return str(p.relative_to(ROOT)).replace("\\", "/")


def resolves(base: Path, spec: str) -> bool:
    if spec.startswith("/"):
        target = ROOT / spec.lstrip("/")
    else:
        target = (base / spec)
    target = Path(str(target))
    return any(
        (target.parent / (target.name + ext)).exists()
        for ext in ("", ".js", ".json")
    ) or (target / "index.js").exists()


# ---------------------------------------------------------------- 1/2 app.json

def check_app_json() -> None:
    log("[1] app.json 页面齐全性")
    app_path = ROOT / "app.json"
    app = json.loads(app_path.read_text(encoding="utf-8"))

    pages = list(app.get("pages") or [])
    for p in pages:
        for ext in (".js", ".wxml", ".json"):
            f = ROOT / (p + ext)
            if not f.exists():
                fail(f"缺文件 {rel(f)}")
    ok(f"主包页面 {len(pages)} 个")

    sub_pages: dict[str, list[str]] = {}
    for sp in app.get("subPackages") or []:
        root = sp.get("root", "")
        sub_pages[root] = []
        for p in sp.get("pages") or []:
            full = f"{root}/{p}"
            sub_pages[root].append(full)
            for ext in (".js", ".wxml", ".json"):
                f = ROOT / (full + ext)
                if not f.exists():
                    fail(f"缺文件 {rel(f)}")
    ok(f"分包 {len(sub_pages)} 个，页面 {sum(len(v) for v in sub_pages.values())} 个")

    # tabBar 页面必须在主包
    log("[2] tabBar 页面必须在主包")
    for t in (app.get("tabBar") or {}).get("list") or []:
        page = t.get("pagePath")
        if page not in pages:
            fail(f"tabBar 页面 {page} 不在主包 pages 里（硬约束）")
    ok("tabBar 页面均在主包")


# ---------------------------------------------------------------- 3/4 路径

def check_paths() -> None:
    log("[3] usingComponents 路径")
    n = 0
    for f in ROOT.rglob("*.json"):
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            continue
        for name, spec in (d.get("usingComponents") or {}).items():
            n += 1
            if not resolves(f.parent, spec):
                fail(f"{rel(f)} 的组件 {name} → {spec} 无法解析")
    ok(f"组件引用 {n} 处全部可解析")

    log("[4] require 相对路径")
    n = 0
    for f in list(ROOT.rglob("*.js")):
        if "components/mp-html" in rel(f):
            continue  # 第三方内联组件，不查
        for spec in REQUIRE_RE.findall(f.read_text(encoding="utf-8")):
            if not spec.startswith("."):
                continue
            n += 1
            if spec.endswith(".json"):
                # 小程序不支持 require JSON：工具会给它补 .js 后缀，
                # 报 `module 'xxx.json.js' is not defined`；若包在 try/catch 里
                # 就会静默失败（典型症状：首屏整页没数据）。
                fail(
                    f"{rel(f)} 用 require 引入 JSON（小程序不支持）：require('{spec}')"
                    " —— 改成 .js 并用 module.exports 导出"
                )
                continue
            if not resolves(f.parent, spec):
                fail(f"{rel(f)} 的 require('{spec}') 无法解析")
    ok(f"相对 require {n} 处全部可解析")


# ---------------------------------------------------------------- 5 导出一致性

def module_exports(path: Path) -> set[str]:
    """从 `module.exports = {...}` 里取名字，兼容单行与多行。

    刻意按逗号切，而不是用「名字+分隔符」的正则：单行写法
    `module.exports = { call, download }` 的**最后一个成员后面没有分隔符**，
    正则法会把它漏掉，进而误报「没有导出」。
    """
    src = path.read_text(encoding="utf-8")
    m = re.search(r"module\.exports\s*=\s*\{(.*?)\}", src, re.S)
    if not m:
        return set()
    names: set[str] = set()
    for part in m.group(1).split(","):
        key = part.split(":")[0].strip()
        if re.fullmatch(r"[A-Za-z_$][\w$]*", key):
            names.add(key)
    return names


def check_calls() -> None:
    log("[5] utils 调用与导出一致")
    exports = {p.stem: module_exports(p) for p in (ROOT / "utils").glob("*.js")}
    for k, v in exports.items():
        if not v:
            log(f"    （{k}.js 未解析到 exports，跳过）")

    bad = 0
    for f in ROOT.rglob("*.js"):
        if "components/mp-html" in rel(f) or "/utils/" in rel(f):
            continue
        src = f.read_text(encoding="utf-8")
        binding = {m.group(1): m.group(2) for m in REQ_BIND_RE.finditer(src)}
        if not binding:
            continue
        for var, fn in CALL_RE.findall(src):
            mod = binding.get(var)
            if mod in exports and exports[mod] and fn not in exports[mod]:
                # 只报「看起来像本模块方法」的调用，避开 this.xxx / wx.xxx 之类
                fail(f"{rel(f)} 调用了 {var}.{fn}()，但 {mod}.js 没有导出它")
                bad += 1
    if not bad:
        ok("调用与导出一致")


# ---------------------------------------------------------------- 6 体积

def size_of(prefix: str) -> int:
    n = 0
    for p in ROOT.rglob("*"):
        if not p.is_file():
            continue
        r = rel(p)
        if r.startswith(prefix):
            n += p.stat().st_size
    return n


def check_size() -> None:
    log("[6] 包体积")
    main = 0
    for p in ROOT.rglob("*"):
        if p.is_file() and not rel(p).startswith("subpackages/"):
            main += p.stat().st_size
    log(f"    主包 {main / 1024:.1f} KB / 上限 {MAIN_LIMIT / 1024:.0f} KB")
    if main > MAIN_LIMIT:
        fail("主包超 2 MB")

    sub_total = 0
    seen = set()
    for p in ROOT.rglob("*"):
        if not p.is_file():
            continue
        r = rel(p)
        if not r.startswith("subpackages/"):
            continue
        name = r.split("/")[1]
        seen.add(name)
    for name in sorted(seen):
        s = size_of(f"subpackages/{name}/")
        sub_total += s
        log(f"    分包 {name}: {s / 1024:.1f} KB")
        if s > MAIN_LIMIT:
            fail(f"分包 {name} 超 2 MB")
    log(f"    分包合计 {sub_total / 1024:.1f} KB / 上限 {30 * 1024:.0f} KB")
    if sub_total > 30 * 1024 * 1024:
        fail("分包合计超 30 MB")
    ok("体积在限制内")


# ---------------------------------------------------------------- 7 云函数触发器

REPO = ROOT.parent
# 微信云开发的 cron 是 7 个**必需**字段：秒 分 时 日 月 周 年。
# 少写一位（例如把 `0 */10 * * * * *` 写成 6 段）不会在本地报错，
# 但部署到云端会让定时触发器配置不合法、函数卡在中间态，
# 表现是所有调用都返回 `ret:-3 system error` —— 极难定位，所以在这里挡住。
CRON_FIELDS = 7


def check_cloudfunction_triggers() -> None:
    log("[7] 云函数定时触发器 cron")
    before = len(problems)
    cf_dir = REPO / "cloudfunctions"
    if not cf_dir.exists():
        ok("没有 cloudfunctions/，跳过")
        return
    n = 0
    for cfg in sorted(cf_dir.glob("*/config.json")):
        try:
            d = json.loads(cfg.read_text(encoding="utf-8"))
        except Exception as e:
            fail(f"{cfg.name} 不是合法 JSON：{e}")
            continue
        triggers = d.get("triggers")
        if triggers is None:
            continue
        if not isinstance(triggers, list):
            fail(f"{cfg.parent.name}/config.json 的 triggers 必须是数组")
            continue
        if len(triggers) > 1:
            fail(f"{cfg.parent.name} 配了 {len(triggers)} 个触发器（微信云开发只支持 1 个）")
        for t in triggers:
            n += 1
            where = f"{cfg.parent.name}/config.json 触发器 {t.get('name')!r}"
            if t.get("type") != "timer":
                fail(f"{where} 的 type 必须是 'timer'")
            name = str(t.get("name") or "")
            if not re.fullmatch(r"[A-Za-z][\w-]{0,59}", name):
                fail(f"{where} 的 name 不合法（字母开头，仅字母数字 - _，≤60 字符）")
            fields = str(t.get("config") or "").split()
            if len(fields) != CRON_FIELDS:
                fail(
                    f"{where} 的 cron 有 {len(fields)} 段，微信要求 {CRON_FIELDS} 段"
                    f"（秒 分 时 日 月 周 年）：{' '.join(fields)!r}"
                )
            elif not fields[0].isdigit() or not fields[1]:
                fail(f"{where} 的 cron 第一段（秒）应写具体值，如 0")
    if len(problems) == before:
        ok(f"触发器 {n} 个，cron 段数与字段检查通过")

    # 文档里抄给用户的 cron 也要查 —— DEPLOY.md 里那串是要被**手工填进控制台**的，
    # 它写成 6 段，用户照着抄就会把函数再搞挂一次（已经真实发生过）。
    # 匹配两种写法：JSON 里的 `"config": "..."`，以及反引号包起来的 cron 片段。
    doc_files = sorted(REPO.glob("*.md")) + sorted(REPO.glob("build/*.md"))
    seen = 0
    doc_before = len(problems)
    for md in doc_files:
        text = md.read_text(encoding="utf-8")
        samples = [m.group(1) for m in re.finditer(r'"config"\s*:\s*"([^"]+)"', text)]
        for m in re.finditer(r"`([0-9*/,?\-\s]+)`", text):
            s = m.group(1).strip()
            fields = s.split()
            # 只认「至少 5 段、每段都是 cron 字符」的，避免把 `40000`、`60 秒` 之类误判
            if len(fields) >= 5 and all(re.fullmatch(r"[0-9*/,?\-]+", f) for f in fields):
                samples.append(s)
        for s in samples:
            seen += 1
            fields = s.split()
            if len(fields) != CRON_FIELDS:
                fail(f"{md.name} 里的示例 cron 只有 {len(fields)} 段（应为 {CRON_FIELDS} 段）：{s!r}")
    if seen and len(problems) == doc_before:
        ok(f"文档里 {seen} 处示例 cron 段数正确")


# ---------------------------------------------------------------- 8 wxss 选择器

COMMENT_RE = re.compile(r"/\*.*?\*/", re.S)
# 取每个 `{` 之前、且不含花括号的那段文本 —— 那就是选择器（或 @media 之类的参数）。
SELECTOR_RE = re.compile(r"([^{}]*)\{")


def check_wxss_selectors() -> None:
    """WXSS 的选择器必须是纯 ASCII。

    实测：`.tier--极高 { ... }` 会让开发者工具在小程序**编译期**直接报
    `unexpected ... (13:8)` —— 行列正好指向那个中文字符，而错误信息
    （说遇到了 `>`）**完全对不上实际内容**，极难反推。中文放在注释和
    声明值里都没问题，只有选择器不行，所以这里按选择器检查。
    """
    log("[8] WXSS 选择器必须是 ASCII")
    n = 0
    bad = 0
    for f in sorted(ROOT.rglob("*.wxss")):
        if "components/mp-html" in rel(f):
            continue  # 第三方内联组件，不查
        src = COMMENT_RE.sub("", f.read_text(encoding="utf-8"))
        for m in SELECTOR_RE.finditer(src):
            sel = m.group(1).strip()
            if not sel:
                continue
            n += 1
            chars = sorted({c for c in sel if ord(c) > 127})
            if chars:
                line = src[: m.start()].count("\n") + 1
                fail(
                    f"{rel(f)} 第 {line} 行选择器含非 ASCII {''.join(chars)[:12]!r}"
                    f"：{sel[:50]!r}（类名改用 ASCII，中文只放注释/文案）"
                )
                bad += 1
    if not bad:
        ok(f"检查 {n} 个选择器，全部为 ASCII")


# ---------------------------------------------------------------- 9 tabBar 变量自给

VAR_USE_RE = re.compile(r"var\((--[\w-]+)")
VAR_DEF_RE = re.compile(r"(--[\w-]+)\s*:")


def strip_media_blocks(src: str) -> str:
    """删掉 @media ... { ... } 整段（花括号配对，支持一层以上嵌套）。

    用途：CSS 变量的「兜底定义」必须在**基础块**里（@media 只是按主题覆盖），
    所以检查定义够不够时，要把 @media 里的覆盖定义排除掉再数。
    """
    out = []
    i = 0
    while True:
        j = src.find("@media", i)
        if j < 0:
            out.append(src[i:])
            break
        out.append(src[i:j])
        k = src.find("{", j)
        if k < 0:
            break
        depth = 1
        p = k + 1
        while p < len(src) and depth:
            if src[p] == "{":
                depth += 1
            elif src[p] == "}":
                depth -= 1
            p += 1
        i = p
    return "".join(out)


def check_tabbar_vars() -> None:
    """自定义 tabBar 用到的 CSS 变量必须在组件自己的 wxss 里定义。

    自定义 tabBar 的节点**不挂在 page 下面**，继承不到 app.wxss 里
    `page { --ink3: ... }` 定义的变量 —— var() 静默落空、文字掉回默认黑色。
    浅色下「白底黑字」不易察觉；暗色下背景被 @media 转暗就成了「暗底黑字」，
    真机上完全看不清（已真实发生）。页面内组件没有这个问题（节点在 page 下），
    所以只查 custom-tab-bar 目录。

    判定口径：定义必须出现在**基础块**（非 @media）里 —— @media 只是按主题
    覆盖，基础块没定义的话，对应主题下 var() 照样落空。
    """
    log("[9] 自定义 tabBar 的 CSS 变量自给")
    tb_dir = ROOT / "custom-tab-bar"
    files = sorted(tb_dir.glob("*.wxss")) if tb_dir.is_dir() else []
    if not files:
        ok("没有自定义 tabBar，跳过")
        return
    n = 0
    bad = 0
    for f in files:
        src = COMMENT_RE.sub("", f.read_text(encoding="utf-8"))
        used = set(VAR_USE_RE.findall(src))
        defined = set(VAR_DEF_RE.findall(strip_media_blocks(src)))
        n += len(used)
        for name in sorted(used - defined):
            fail(
                f"{rel(f)} 引用了 var({name}) 但基础块里没有定义 —— "
                f"自定义 tabBar 继承不到 page 变量，必须在组件 wxss 的基础块里自己定义"
            )
            bad += 1
    if not bad:
        ok(f"检查 {n} 个变量引用，全部在基础块有定义")


def main() -> int:
    log(f"检查 {ROOT}")
    check_app_json()
    check_paths()
    check_calls()
    check_size()
    check_cloudfunction_triggers()
    check_wxss_selectors()
    check_tabbar_vars()
    if problems:
        log(f"\n{len(problems)} 个问题")
        return 1
    log("\n全部通过")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
