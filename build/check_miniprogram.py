"""小程序静态完整性检查：编译前把「一类低错但必炸」的问题挡住。

检查项
  1. app.json 里的每个 page / subPackage page 是否三件套齐全（.js/.wxml/.json）
  2. tabBar 页面是否都在主包（这是硬约束：tabBar 页面不能放分包）
  3. 所有 usingComponents 的相对路径能否解析
  4. 所有 require('...') 的相对路径能否解析
  5. 页面/组件里对 utils/* 的调用，是否都在该模块的 module.exports 里
  6. 主包体积是否超 2 MB（分包是否超 2 MB）

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


def main() -> int:
    log(f"检查 {ROOT}")
    check_app_json()
    check_paths()
    check_calls()
    check_size()
    if problems:
        log(f"\n{len(problems)} 个问题")
        return 1
    log("\n全部通过")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
