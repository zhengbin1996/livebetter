"""id 迁移表（prevIdMap）的行为测试。

**为什么必须有这个测试**：条目主键是「节号 + 标题哈希」，上游改一个字的标题
就会换 id，而用户收藏/打卡存的是 id。迁移表本来是为此设计的 —— 但它曾经
**长期静默失效**：parse.py 从 dist/ids.json 读「上一版」，而 dist/ 在同一个
流程里刚被清空过，于是读到的永远是空表，prevIdMap 恒为 {}。界面上完全看不
出来，只有用户发现收藏悄悄没了。

所以这里除了测匹配逻辑，还额外断言「上一版是从入库快照读的」这件事本身。

用法（仓库根目录）：python build/tests/test_idmap.py
"""

from __future__ import annotations

import hashlib
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import idmap  # noqa: E402

failed = 0


def ok(name: str, cond: bool, extra: object = "") -> None:
    global failed
    if cond:
        print("  PASS " + name)
    else:
        failed += 1
        print("  FAIL " + name + ("  -> " + str(extra) if extra != "" else ""))


def sid(sec: int, title: str) -> str:
    return f"s{sec:02d}-" + hashlib.sha1(title.encode()).hexdigest()[:10]


def snap(rows: list[tuple[int, int, str]]) -> dict:
    """rows: [(节, 条号, 标题)] → idmap 快照结构"""
    out = {}
    for sec, num, title in rows:
        out[sid(sec, title)] = {
            "sec": sec, "num": num, "title": title,
            "key": title.replace("，", ","),
        }
    return out


print("=== 1) 内容没变：不该有任何迁移（否则会把收藏乱搬）===")
base = snap([(1, 1, "系安全带，前排后排都系"), (1, 2, "骑车戴头盔并扣好")])
m, _ = idmap.build_map(base, base)
ok("无差异 → 空迁移表", m == {}, json.dumps(m, ensure_ascii=False))

print("\n=== 2) 上游改标题：旧 id 必须映射到新 id（这就是收藏不失效的保证）===")
old = snap([(1, 1, "系安全带，前排后排都系"), (1, 2, "骑车戴头盔并扣好")])
new = snap([(1, 1, "系安全带，前排后排都要系上"), (1, 2, "骑车戴头盔并扣好")])
m, _ = idmap.build_map(old, new)
ok("旧标题改了一版 → 建立迁移", sid(1, "系安全带，前排后排都系") in m,
   json.dumps(m, ensure_ascii=False))
ok("映射目标确实是新标题那条",
   m.get(sid(1, "系安全带，前排后排都系")) == sid(1, "系安全带，前排后排都要系上"))

print("\n=== 3) 标题被彻底换掉：不硬凑映射（迁错比不迁更糟）===")
old = snap([(1, 1, "系安全带，前排后排都系")])
new = snap([(1, 1, "把信用卡全部剪掉")])
m, _ = idmap.build_map(old, new)
ok("相似度过低 → 不迁移", m == {}, json.dumps(m, ensure_ascii=False))

print("\n=== 4) 条目被删 / 跨节：都不该误配 ===")
old = snap([(1, 1, "系安全带，前排后排都系"), (2, 1, "降压药按时吃")])
new = snap([(1, 1, "系安全带，前排后排都系")])  # 第 2 节那条被删了
m, _ = idmap.build_map(old, new)
ok("删掉的那条不产生映射", m == {}, json.dumps(m, ensure_ascii=False))

old = snap([(1, 1, "把信用卡全部剪掉")])
new = snap([(2, 1, "把信用卡全部剪掉")])  # 同样的标题，但换了节
m, _ = idmap.build_map(old, new)
ok("只在同一节内匹配（跨节不算同一件事）", m == {}, json.dumps(m, ensure_ascii=False))

print("\n=== 5) 快照读写往返 ===")
with tempfile.TemporaryDirectory() as td:
    p = Path(td) / "ids.json"
    idmap.save(base, p)
    got = idmap.load_prev(p)
    ok("写出去再读回来一致", got == base)
    ok("文件不存在时返回空表", idmap.load_prev(Path(td) / "nope.json") == {})

print("\n=== 6) 上一版必须来自入库快照，而不是 dist/（回归锁定）===")
parse_src = (Path(__file__).resolve().parent.parent / "parse.py").read_text(encoding="utf-8")
ok("parse.py 用 idmap.load_snapshot() 读上一版", "idmap.load_snapshot()" in parse_src)
ok("入库快照路径在 build/ 下（不是 dist/）",
   idmap.SNAPSHOT_FILE.parent.name == "build" and idmap.SNAPSHOT_FILE.name == "ids-latest.json",
   str(idmap.SNAPSHOT_FILE))

print("\n" + (f"{failed} 项失败" if failed else "全部通过"))
raise SystemExit(1 if failed else 0)
