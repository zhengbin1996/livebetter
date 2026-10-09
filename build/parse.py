"""把上游 HowToLiveBetter 仓库解析成分层 JSON 数据产物。

用法（在仓库根目录）：
    python build/parse.py                 # 解析 upstream/ → dist/
    python build/parse.py --no-corpus     # 跳过检索语料（本地快速迭代）
    python build/parse.py --stats         # 只打印统计校验，不写文件

设计要点
--------
* 一律不改写上游文字。渲染用原始 markdown，只在两处做**增量包裹**：
  交叉引用包成 `[原文](ref://sid)`，术语包成 `[原文](gloss://术语)`。
* 性价比档直接复刻上游 `tools/lib/book.mjs` 的 COST_W / ratioOf，
  跑完用 README 公布的 A=438 / B=182 / C=55、极高=114 / 高=303 / 一般=258 自校验。
* 产物分层：essentials 进主包；book/ docs/ 走云存储按需下载；
  search/corpus.json 只给服务端。
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import glossary as gl  # noqa: E402
import idmap  # noqa: E402
import mdhtml as mh  # noqa: E402
import refs as rf  # noqa: E402
from common import (  # noqa: E402
    BOOK_DIR,
    BOOK_NAME,
    BUNDLE_DATA,
    DIST,
    DOCS_DIR,
    LICENSE_NAME,
    LICENSE_URL,
    REPO_URL,
    ROOT,
    TAG_KEY_MAP,
    UPSTREAM,
    VERIFY_DIR,
    chars_for_search,
    log,
    make_doc_sid,
    make_sid,
    plain_lead,
    read_text,
    sha256_file,
    strip_md,
    write_json,
)

CST = timezone(timedelta(hours=8))

# 复刻上游 tools/lib/book.mjs
COST_W = {
    "money": {"0": 0, "少": 1, "多": 2},
    "time": {"少": 0, "中": 1, "多": 2},
    "will": {"否": 0, "些": 1, "是": 2},
}


def ratio_of(cost_tag: dict) -> tuple[str, int]:
    cs = (
        COST_W["money"].get(cost_tag.get("money"), 0)
        + COST_W["time"].get(cost_tag.get("time"), 0)
        + COST_W["will"].get(cost_tag.get("will"), 0)
    )
    level = cost_tag.get("benefit")
    if level == "大":
        return ("极高" if cs == 0 else ("高" if cs <= 2 else "一般")), cs
    if level == "中":
        return ("高" if cs == 0 else "一般"), cs
    return "一般", cs


# ---------------------------------------------------------------- 版本

def resolve_commit() -> tuple[str, str]:
    """取上游 commit sha 与提交时间：环境变量 → 本地文件 → GitHub API。"""
    sha = os.environ.get("UPSTREAM_COMMIT", "").strip()
    date = os.environ.get("UPSTREAM_COMMIT_DATE", "").strip()
    subject = os.environ.get("UPSTREAM_COMMIT_SUBJECT", "").strip()
    cache = UPSTREAM / ".commit.json"
    if not sha and cache.exists():
        try:
            d = json.loads(cache.read_text(encoding="utf-8"))
            sha, date = d.get("sha", ""), d.get("date", "")
            subject = d.get("subject", "")
        except Exception:
            pass
    if not sha:
        try:
            import urllib.request

            req = urllib.request.Request(
                "https://api.github.com/repos/eternity4719/HowToLiveBetter/commits/main",
                headers={"User-Agent": "htb-build", "Accept": "application/vnd.github+json"},
            )
            with urllib.request.urlopen(req, timeout=20) as r:
                d = json.loads(r.read().decode("utf-8"))
            sha = d["sha"]
            date = d["commit"]["committer"]["date"]
            subject = d["commit"]["message"].splitlines()[0]
            log(f"    上游 commit：{sha[:7]}（来自 GitHub API）")
        except Exception as e:  # 离线构建时退化为「本地副本」
            sha, date = "0" * 40, ""
            log(f"    !! 拿不到上游 commit（{e}），退化为本地副本版本号")
    if sha and sha != "0" * 40 and not cache.exists():
        UPSTREAM.mkdir(exist_ok=True)
        cache.write_text(
            json.dumps({"sha": sha, "date": date, "subject": subject}, ensure_ascii=False),
            encoding="utf-8",
        )
    _COMMIT_SUBJECT["v"] = subject
    return sha, date


_COMMIT_SUBJECT: dict[str, str] = {"v": ""}


def version_of(sha: str, date: str) -> str:
    if date:
        try:
            dt = datetime.fromisoformat(date.replace("Z", "+00:00")).astimezone(CST)
            return f"v{dt:%Y%m%d}-{sha[:7]}"
        except Exception:
            pass
    return f"v{datetime.now(CST):%Y%m%d}-{sha[:7]}"


# ---------------------------------------------------------------- 正文章节

RE_SEC_TITLE = re.compile(r"^#\s*(\d+)\.\s*(.+)$")
RE_ITEM_TITLE = re.compile(r"^###\s*(\d+)\.\s*(.+)$")
RE_FIELD = re.compile(r"^-\s*([^：]{1,8})：\s*(.*)$")
RE_TAG = re.compile(r"<!--\s*成本标签:\s*([^>]*?)\s*-->")
RE_GROUP = re.compile(r"^\*\*(.+?)\*\*：\s*(.+)$")
RE_GROUP_ITEM = re.compile(r"(.+?)（第\s*(\d+)\s*条）")


def parse_tag(raw: str) -> dict:
    """`钱=0 时间=少 毅力=否 收益=大 口径=死亡率` → 英文键的字典。"""
    tag = {}
    for seg in raw.split():
        if "=" in seg:
            k, v = seg.split("=", 1)
            k = TAG_KEY_MAP.get(k.strip(), k.strip())
            tag[k] = v.strip()
    return tag


def parse_book_file(path: Path) -> dict:
    sec_no = int(path.name[:2])
    lines = read_text(path).split("\n")
    sec_title = path.stem[3:]
    intro_lines: list[str] = []
    items: list[dict] = []
    cur: dict | None = None

    def flush():
        # 字段以中文名为键（成本/说人话/收益/证据等级/来源/备注）；
        # 「说人话」是上游强制字段，缺了说明这不是一条完整建议，丢掉。
        nonlocal cur
        if cur and cur["fields"].get("说人话"):
            items.append(cur)
        cur = None

    for line in lines:
        s = line.rstrip()
        m = RE_SEC_TITLE.match(s)
        if m and m.group(1) == str(sec_no):
            sec_title = m.group(2).strip()
            continue
        mi = RE_ITEM_TITLE.match(s)
        if mi:
            flush()
            cur = {
                "num": int(mi.group(1)),
                "title": mi.group(2).strip(),
                "tag": {},
                "fields": {},
            }
            continue
        if cur is not None:
            mt = RE_TAG.search(s)
            if mt:
                cur["tag"] = parse_tag(mt.group(1))
                continue
            mf = RE_FIELD.match(s.strip())
            if mf:
                cur["fields"][mf.group(1).strip()] = mf.group(2).strip()
                continue
            continue
        st = s.strip()
        if st and not st.startswith("[←"):
            intro_lines.append(st)
    flush()

    # 分组导览（节首里以 **标签**：条目清单 形式出现的行）
    groups = []
    for line in intro_lines:
        mg = RE_GROUP.match(line)
        if not mg:
            continue
        label = mg.group(1).strip()
        entries = []
        for im in RE_GROUP_ITEM.finditer(mg.group(2)):
            entries.append({"num": int(im.group(2)), "label": im.group(1).strip()})
        groups.append({"label": label, "items": entries})

    return {
        "sec": sec_no,
        "secTitle": sec_title,
        "fileName": path.name,
        "intro": intro_lines,
        "groups": groups,
        "items": items,
    }


# ---------------------------------------------------------------- README

def parse_readme(readme: str) -> dict:
    out: dict = {}

    # 这本书想回答的问题
    problems = []
    m = re.search(r"^## 这本书想回答的问题\s*\n(.*?)(?=^## )", readme, re.S | re.M)
    if m:
        for line in m.group(1).split("\n"):
            if not line.strip().startswith("|"):
                continue
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if len(cells) < 2 or cells[0] in ("问题",) or set(cells[0]) <= set("-: "):
                continue
            link = cells[1]
            lm = re.search(r"\[([^\]]+)\]\(([^)]+)\)", link)
            if not lm:
                continue
            sec_m = re.match(r"(\d+)\.", lm.group(1).strip())
            problems.append({
                "q": cells[0],
                "sec": int(sec_m.group(1)) if sec_m else None,
                "title": re.sub(r"^\d+\.\s*", "", lm.group(1).strip()),
            })
    out["problems"] = problems

    # 目录（一节一行：节名 + 该节摘要）
    toc = {}
    m = re.search(r"^## 目录\s*\n(.*?)(?=^## )", readme, re.S | re.M)
    if m:
        for line in m.group(1).split("\n"):
            mm = re.match(r"^(\d+)\.\s*\[([^\]]+)\]\([^)]*\)(?:：(.*))?$", line.strip())
            if mm:
                toc[int(mm.group(1))] = {
                    "title": re.sub(r"^\d+\.\s*", "", mm.group(2).strip()),
                    "summary": (mm.group(3) or "").strip(),
                }
    out["toc"] = toc

    # 证据分级
    ev = []
    m = re.search(r"^## 证据分级\s*\n(.*?)(?=^## )", readme, re.S | re.M)
    if m:
        ev = _table_rows(m.group(1))
    out["evidence"] = [{"level": a, "meaning": b} for a, b, *_ in ev if a in ("A", "B", "C")]
    out["evidenceNote"] = _after_table(m.group(1), len(ev))

    # 性价比档
    m = re.search(r"^## 性价比档\s*\n(.*?)(?=^## )", readme, re.S | re.M)
    if m:
        out["tierRules"] = _table_rows(m.group(1))[0:4]
        rest = m.group(1)
        paras = [p.strip() for p in rest.split("\n\n") if p.strip() and not p.strip().startswith("|")]
        out["tierNote"] = " ".join(paras)

    # 四种资源
    m = re.search(r"^## 四种资源\s*\n(.*?)(?=^## )", readme, re.S | re.M)
    if m:
        out["resources"] = [
            {"name": x.group(1).strip(), "desc": x.group(2).strip()}
            for x in re.finditer(r"^-\s*\*\*(.+?)\*\*：(.+)$", m.group(1), re.M)
        ]
        out["resourcesNote"] = " ".join(
            p.strip() for p in m.group(1).split("\n\n")
            if p.strip() and not p.strip().startswith("-")
        )

    # 怎么读
    m = re.search(r"^## 怎么读\s*\n(.*?)(?=^## )", readme, re.S | re.M)
    if m:
        tips = []
        for line in m.group(1).split("\n"):
            t = line.strip()
            if t.startswith("- **"):
                mm = re.match(r"^-\s*\*\*(.+?)\*\*[：:]?\s*(.*)$", t)
                if mm:
                    tips.append({"head": mm.group(1).strip(), "body": strip_md(mm.group(2))})
        out["howto"] = tips

    out["statsClaim"] = {
        "A": _int_after(readme, r"A 级 (\d+) 条"),
        "B": _int_after(readme, r"B 级 (\d+) 条"),
        "C": _int_after(readme, r"C 级 (\d+) 条"),
        "dispute": _int_after(readme, r"另有 (\d+) 条标注了争议"),
        "TODO": _int_after(readme, r"(\d+) 处标注了 TODO"),
        "tier3": _int_after(readme, r"性价比极高 (\d+) 条"),
        # 前面「极高」里也含「高」字，必须用顿号锚住，否则抓到 114
        "tier2": _int_after(readme, r"、高 (\d+) 条"),
        "tier1": _int_after(readme, r"、一般 (\d+) 条"),
    }
    return out


def _table_rows(block: str) -> list[list[str]]:
    rows = []
    for line in block.split("\n"):
        t = line.strip()
        if not t.startswith("|"):
            continue
        cells = [c.strip() for c in t.strip("|").split("|")]
        if set("".join(cells)) <= set("-: "):
            continue
        rows.append(cells)
    return rows


def _after_table(block: str, skip: int) -> str:
    parts = block.split("\n\n")
    body = [p.strip() for p in parts if p.strip() and not p.strip().startswith("|")]
    return "\n\n".join(body)


def _int_after(text: str, pattern: str) -> int | None:
    m = re.search(pattern, text)
    return int(m.group(1)) if m else None


# ---------------------------------------------------------------- 长文 / 核实记录

def parse_doc_file(path: Path, kind: str) -> dict:
    raw = read_text(path)
    name = path.stem
    title = name
    mt = re.search(r"^#\s+(.+)$", raw, re.M)
    if mt:
        title = mt.group(1).strip()
    headings = [
        {"level": len(h.group(1)), "text": h.group(2).strip()}
        for h in re.finditer(r"^(#{1,4})\s+(.+)$", raw, re.M)
    ]
    # 去掉文件首行「回总目录」链接
    body = re.sub(r"^\[←[^\]]*\]\([^)]*\)\s*\n+", "", raw)
    return {
        "sid": make_doc_sid(name),
        "kind": kind,
        "name": name,
        "title": title,
        "body": body,
        "headings": headings,
        "chars": len(raw),
        "refs": [],
    }


# ---------------------------------------------------------------- 主流程

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-corpus", action="store_true", help="跳过检索语料生成")
    ap.add_argument("--no-bundle", action="store_true", help="不把 essentials 同步到小程序主包")
    ap.add_argument("--stats", action="store_true", help="只打印统计校验")
    ap.add_argument("--dist", default=str(DIST))
    args = ap.parse_args()
    dist = Path(args.dist)

    if not BOOK_DIR.exists():
        log(f"!! 找不到 {BOOK_DIR}，请先拉取上游仓库到 upstream/")
        return 2

    sha, cdate = resolve_commit()
    version = version_of(sha, cdate)
    now = datetime.now(CST)

    # ---- 1. 解析正文
    log("[1/7] 解析正文 book/")
    files = sorted(p for p in BOOK_DIR.glob("*.md"))
    sections = [parse_book_file(p) for p in files]
    sections.sort(key=lambda s: s["sec"])

    # 补 sid / 标签派生 / 文本派生
    total_items = 0
    for sec in sections:
        for it in sec["items"]:
            it["sid"] = make_sid(sec["sec"], it["title"])
            it["ratio"], it["costScore"] = ratio_of(it["tag"])
            note = it["fields"].get("备注", "")
            it["dispute"] = note.startswith("争议")
            blob = "".join(it["fields"].get(k, "") for k in ("来源", "收益", "备注", "成本"))
            it["todo"] = bool(re.search(r"待核实|TODO", blob))
            it["plainText"] = strip_md(it["fields"].get("说人话", ""))
            it["preview"] = gl.plain_first_sentence(it["fields"].get("说人话", ""), 62)
            it["evidenceLevel"] = (it["fields"].get("证据等级") or "C").strip()[:1]
            it["refs"] = []
            it["glossary"] = []
            it["refIn"] = []
            total_items += 1
        # 去重检查
        seen = {}
        for it in sec["items"]:
            if it["sid"] in seen:
                log(f"    !! 第 {sec['sec']} 节 id 冲突：{it['title']!r} / {seen[it['sid']]!r}")
            seen[it["sid"]] = it["title"]
    log(f"    {len(sections)} 节 / {total_items} 条")

    index = {s["sec"]: s["items"] for s in sections}

    # ---- 2. 交叉引用
    log("[2/7] 解析交叉引用")
    ref_total = ref_broken = ref_fuzzy = 0
    broken_list: list[dict] = []
    for sec in sections:
        for it in sec["items"]:
            for gkey, fkey in (("成本", "cost"), ("说人话", "plain"), ("收益", "benefit"),
                               ("来源", "source"), ("备注", "note")):
                text = it["fields"].get(gkey)
                if not text:
                    continue
                recs = rf.extract(text, sec["sec"])
                if not recs:
                    continue
                resolved = [rf.resolve(r, index) for r in recs]
                for r in resolved:
                    ref_total += 1
                    r["fromSid"] = it["sid"]
                    r["fromSec"] = sec["sec"]
                    r["field"] = gkey
                    if r["confidence"] == "broken":
                        ref_broken += 1
                        broken_list.append({
                            "fromSid": it["sid"], "fromSec": sec["sec"], "field": gkey,
                            "raw": r["raw"], "reason": r.get("reason", ""),
                        })
                    elif r["confidence"] == "anchor":
                        ref_fuzzy += 1
                    if r.get("targetSid"):
                        it["refs"].append({
                            "toSid": r["targetSid"], "toSec": r["toSec"], "toNum": r["toNum"],
                            "anchor": r.get("anchor"), "label": r["raw"],
                            "via": r["confidence"], "field": fkey,
                        })
                new_text, _ = rf.rewrite(text, resolved)
                it["fields"][gkey] = new_text

    # 节首「已经写在别处的，这里只指路」段也有引用，挂在这一节上（不属于任何一条）
    for sec in sections:
        sec["introRefs"] = []
        new_intro = []
        for para in sec["intro"]:
            recs = rf.extract(para, sec["sec"])
            if not recs:
                new_intro.append(para)
                continue
            resolved = [rf.resolve(r, index) for r in recs]
            for r in resolved:
                ref_total += 1
                r["fromSid"] = None
                r["fromSec"] = sec["sec"]
                r["field"] = "intro"
                if r["confidence"] == "broken":
                    ref_broken += 1
                    broken_list.append({
                        "fromSid": None, "fromSec": sec["sec"], "field": "intro",
                        "raw": r["raw"], "reason": r.get("reason", ""),
                    })
                elif r["confidence"] == "anchor":
                    ref_fuzzy += 1
                if r.get("targetSid"):
                    sec["introRefs"].append({
                        "toSid": r["targetSid"], "toSec": r["toSec"], "toNum": r["toNum"],
                        "anchor": r.get("anchor"), "label": r["raw"],
                        "via": r["confidence"], "field": "intro",
                    })
            para_new, _ = rf.rewrite(para, resolved)
            new_intro.append(para_new)
        sec["intro"] = new_intro
    log(f"    引用 {ref_total} 处：条号命中 {ref_total - ref_broken - ref_fuzzy}、"
        f"锚点兜底 {ref_fuzzy}、失效 {ref_broken}")

    # 反向引用索引：这条建议被哪些条目指到。
    # 存 {sid, sec, num} 而不是只存 sid —— 详情页要显示「第 5 节第 12 条」，
    # 只给 sid 的话客户端得为每条反查再下载一个分片。
    sid2item = {it["sid"]: it for s in sections for it in s["items"]}
    for s in sections:
        for it in s["items"]:
            for r in it["refs"]:
                t = sid2item.get(r["toSid"])
                if t is None:
                    continue
                if any(x["sid"] == it["sid"] for x in t["refIn"]):
                    continue
                t["refIn"].append({"sid": it["sid"], "sec": s["sec"], "num": it["num"]})

    # ---- 3. 术语标注
    log("[3/7] 抽取术语表并标注正文")
    readme = read_text(UPSTREAM / "README.md")
    terms = gl.parse_readme_glossary(readme)
    matcher = gl.build_matcher(terms)
    gloss_hits = 0
    for sec in sections:
        for it in sec["items"]:
            seen: set[str] = set()
            for gkey, fkey in (("说人话", "plain"), ("收益", "benefit"), ("备注", "note")):
                text = it["fields"].get(gkey)
                if not text:
                    continue
                new_text, hits = gl.mark_terms(text, matcher, seen)
                it["fields"][gkey] = new_text
                if hits:
                    it["glossary"] = list(seen)
                    gloss_hits += len(hits)
    log(f"    术语表 {len(terms)} 条，正文标注 {gloss_hits} 处")

    # ---- 4. README 元数据
    log("[4/7] 解析 README 元数据")
    meta = parse_readme(readme)
    log(f"    问题表 {len(meta['problems'])} 行 / 目录 {len(meta['toc'])} 节 / "
        f"术语 {len(terms)} 条 / 怎么读 {len(meta.get('howto', []))} 条")

    # ---- 5. 统计自校验
    log("[5/7] 统计自校验（对比 README 公布数字）")
    ev_count = {"A": 0, "B": 0, "C": 0}
    tier_count = {"极高": 0, "高": 0, "一般": 0}
    dispute = todo = 0
    for s in sections:
        for it in s["items"]:
            ev_count[it["evidenceLevel"]] = ev_count.get(it["evidenceLevel"], 0) + 1
            tier_count[it["ratio"]] = tier_count.get(it["ratio"], 0) + 1
            dispute += 1 if it["dispute"] else 0
            todo += 1 if it["todo"] else 0
    claim = meta["statsClaim"]
    checks = [
        ("总数", total_items, 675),
        ("A 级", ev_count["A"], claim.get("A")),
        ("B 级", ev_count["B"], claim.get("B")),
        ("C 级", ev_count["C"], claim.get("C")),
        ("争议", dispute, claim.get("dispute")),
        ("TODO", todo, claim.get("TODO")),
        ("性价比极高", tier_count["极高"], claim.get("tier3")),
        ("性价比高", tier_count["高"], claim.get("tier2")),
        ("性价比一般", tier_count["一般"], claim.get("tier1")),
        ("引用失效", ref_broken, 0),
    ]
    ok_all = True
    for label, got, want in checks:
        if want is None:
            mark = "?"
        elif got == want:
            mark = "OK"
        elif label == "引用失效":
            mark = "!!"
            ok_all = False
        else:
            mark = f"差异 {got - want:+d}"
            ok_all = False
        log(f"    {label:<12} 解析 {got:>5}   README {str(want):>5}   {mark}")

    if args.stats:
        return 0 if ok_all else 1

    # ---- 6. 长文与核实记录
    log("[6/7] 解析 docs/ 长文与核实记录")
    long_docs = []
    for p in sorted(DOCS_DIR.glob("*.md")):
        if p.name == "引用对照.md":
            d = parse_doc_file(p, "refsmap")
        else:
            d = parse_doc_file(p, "doc")
        long_docs.append(d)
    verify_docs = []
    if VERIFY_DIR.exists():
        for p in sorted(VERIFY_DIR.glob("*.md")):
            verify_docs.append(parse_doc_file(p, "verify"))
    log(f"    长文 {len([d for d in long_docs if d['kind'] == 'doc'])} 篇、"
        f"引用对照 {len([d for d in long_docs if d['kind'] == 'refsmap'])} 篇、"
        f"核实记录 {len(verify_docs)} 篇")

    # 长文里的交叉引用（指向正文条目）
    doc_ref_total = 0
    for d in long_docs + verify_docs:
        recs = rf.extract(d["body"], None)
        if not recs:
            continue
        resolved = [rf.resolve(r, index) for r in recs]
        d["refs"] = [
            {"toSid": r["targetSid"], "toSec": r["toSec"], "toNum": r["toNum"],
             "anchor": r.get("anchor"), "label": r["raw"], "via": r["confidence"]}
            for r in resolved if r.get("targetSid")
        ]
        d["body"], _ = rf.rewrite(d["body"], resolved)
        doc_ref_total += len(resolved)
    log(f"    长文内引用 {doc_ref_total} 处")

    # ---- 6.5 先取检索语料，再转 HTML
    # 语料必须来自 markdown（strip 掉标记后是可见文字）；一旦转成 HTML 就取不到了。
    # 语料只给服务端，不下发客户端，所以不进 shards。
    log("[6.5] 抽取检索语料（仅服务端）")
    corpus = None
    if not args.no_corpus:
        corpus = {
            "version": version,
            "items": [
                {
                    "sid": it["sid"], "s": s["sec"], "n": it["num"], "t": it["title"],
                    "e": it["evidenceLevel"], "r": it["ratio"],
                    "g": it["tag"].get("benefit", ""), "cal": it["tag"].get("caliber", ""),
                    # 三维成本筛选（钱/时间/毅力）
                    "tg": [it["tag"].get("money", ""), it["tag"].get("time", ""),
                           it["tag"].get("will", "")],
                    "d": 1 if it["dispute"] else 0,
                    # sn 是给检索结果做摘要/高亮的原文片段（未归一化，保留大小写）
                    "sn": gl.plain_first_sentence(it["fields"].get("说人话", ""), 110),
                    # px 是「说人话」的明文版（保留大小写与空格），检索端据此
                    # 还原可读片段；p 是去空白/小写的归一化版，只用来匹配。
                    "px": plain_lead(it["fields"].get("说人话", "")),
                    "p": chars_for_search(it["fields"].get("说人话", "")),
                    "b": chars_for_search(it["fields"].get("收益", "")),
                    "m": chars_for_search(it["fields"].get("备注", "")),
                    "u": chars_for_search(it["fields"].get("成本", "")),
                    "src": chars_for_search(it["fields"].get("来源", "")),
                }
                for s in sections for it in s["items"]
            ],
            "docs": [
                {"sid": d["sid"], "k": d["kind"], "t": d["title"],
                 # 长文只留正文前 400 字的明文做结果摘要，避免语料膨胀；
                 # 全文仍可在小程序里点开原文阅读。
                 "px": plain_lead(d["body"]),
                 "p": chars_for_search(d["body"])}
                for d in long_docs + verify_docs
            ],
        }
        log(f"    {len(corpus['items'])} 条 + {len(corpus['docs'])} 篇")

    # ---- 6.6 markdown → HTML
    log("[6.6] 渲染 markdown → HTML")
    for sec in sections:
        sec["intro"] = [mh.render(p) for p in sec["intro"]]
        for it in sec["items"]:
            it["fields"] = {k: mh.render(v) for k, v in it["fields"].items()}
    for d in long_docs + verify_docs:
        html, toc = mh.render_doc(d["body"])
        d["body"] = html
        d["toc"] = toc
    log("    正文与长文已转为 HTML，客户端不再解析 markdown")

    # ---- 7. 写产物
    log("[7/7] 写产物")
    # plainText 只在构建期用于引用锚点匹配，不进分片（省约 20% 体积）
    for sec in sections:
        for it in sec["items"]:
            it.pop("plainText", None)
    if dist.exists():
        for p in sorted(dist.rglob("*.json")):
            p.unlink()
    dist.mkdir(parents=True, exist_ok=True)
    shards: list[dict] = []

    def dump(rel: str, obj, kind: str):
        path = dist / rel
        size = write_json(path, obj)
        shards.append({
            "path": rel, "kind": kind, "size": size, "sha256": sha256_file(path),
        })
        return size

    # book/NN.json
    for sec in sections:
        dump(f"book/{sec['sec']:02d}.json", sec, "book")

    # docs
    for d in long_docs:
        kind = "refsmap" if d["kind"] == "refsmap" else "doc"
        dump(f"docs/{d['sid']}.json", d, kind)
    for d in verify_docs:
        dump(f"docs/verify/{d['sid']}.json", d, "verify")

    # essentials（内置主包）
    essentials = {
        "meta": {
            "book": BOOK_NAME,
            "repo": REPO_URL,
            "license": LICENSE_NAME,
            "licenseUrl": LICENSE_URL,
            "upstreamCommit": sha,
            "upstreamDate": cdate,
            "version": version,
            "generatedAt": now.isoformat(),
        },
        "counts": {
            "sections": len(sections),
            "items": total_items,
            "docs": len([d for d in long_docs if d["kind"] == "doc"]),
            "verify": len(verify_docs),
            "refs": ref_total,
            "brokenRefs": ref_broken,
        },
        "stats": {"evidence": ev_count, "tier": tier_count, "dispute": dispute,
                  "todo": todo, "claim": claim},
        "sections": [
            {
                "sec": s["sec"],
                "title": s["secTitle"],
                "items": len(s["items"]),
                # 目录摘要里混着 markdown 链接，压成纯文本再下发
                "summary": strip_md(meta["toc"].get(s["sec"], {}).get("summary", "")),
                "groups": [g["label"] for g in s["groups"]],
                "tier": _count(s["items"], "ratio", ("极高", "高", "一般")),
                "evidence": _count(s["items"], "evidenceLevel", ("A", "B", "C")),
            }
            for s in sections
        ],
        "problems": meta["problems"],
        "glossary": terms,
        "legend": {
            "evidence": meta["evidence"],
            "evidenceNote": mh.render(meta.get("evidenceNote", "")),
            "tierRules": meta.get("tierRules", []),
            "tierNote": mh.render(meta.get("tierNote", "")),
            "resources": meta.get("resources", []),
            "resourcesNote": mh.render(meta.get("resourcesNote", "")),
            "howto": [
                {"head": h["head"], "body": mh.render(h["body"])}
                for h in meta.get("howto", [])
            ],
            "tags": {
                "money": ["0", "少", "多"], "time": ["少", "中", "多"],
                "will": ["否", "些", "是"], "benefit": ["大", "中", "小"],
                "caliber": ["死亡率", "金钱", "时间", "自由"],
            },
            "tagLabels": {
                "money": {"0": "不花钱", "少": "花一点", "多": "花不少"},
                "time": {"少": "不占时间", "中": "占一些", "多": "占很多"},
                "will": {"否": "不用毅力", "些": "要一点", "是": "很吃毅力"},
                "benefit": {"大": "收益大", "中": "收益中", "小": "收益小"},
                "caliber": {
                    "死亡率": "换寿命", "金钱": "换钱",
                    "时间": "换时间精力", "自由": "换人身自由",
                },
            },
        },
        "docs": [
            {"sid": d["sid"], "title": d["title"], "name": d["name"],
             "kind": d["kind"], "chars": d["chars"],
             "headings": [h["text"] for h in d["headings"] if h["level"] <= 2]}
            for d in long_docs
        ],
        "verify": [
            {"sid": d["sid"], "title": d["title"], "name": d["name"], "chars": d["chars"]}
            for d in verify_docs
        ],
        "license": {
            "name": LICENSE_NAME,
            "url": LICENSE_URL,
            "repo": REPO_URL,
            "attribution": f"《{BOOK_NAME}》，原作者，{REPO_URL}",
            "modifications": (
                "本程序对原文做了以下改动：结构化拆分（把每节拆成条目对象）、"
                "抽取条目标题下的成本标签、把交叉引用与术语转成可点击链接、"
                "重新排版与分页。文字内容与数字未做修改。"
            ),
        },
    }
    size_e = dump("essentials.json", essentials, "essentials")

    # 顺手同步一份到小程序主包：essentials 是「安装即有」的首屏索引，
    # 必须和构建产物同源。放在这里做，省掉一次手工拷贝，也就不会漏。
    if not args.no_bundle:
        try:
            BUNDLE_DATA.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(dist / "essentials.json", BUNDLE_DATA / "essentials.json")
            log(f"    已同步内置索引 → {BUNDLE_DATA / 'essentials.json'}")
        except Exception as e:
            log(f"    !! 同步内置索引失败（不影响在线产物）：{e}")

    # search/corpus.json（仅服务端，见 6.5 节）
    if corpus is not None:
        dump("search/corpus.json", corpus, "corpus")

    # ---- id 快照与迁移表
    cur_ids = idmap.snapshot(sections)
    prev_ids = idmap.load_prev(dist / "ids.json")
    prev_map, _ = idmap.build_map(prev_ids, cur_ids)
    idmap.save(cur_ids, dist / "ids.json")
    idmap.report(prev_ids, cur_ids, prev_map)

    # ---- manifest
    manifest = {
        "version": version,
        "commit": sha,
        "commitDate": cdate,
        "commitSubject": _commit_subject(),
        "generatedAt": now.isoformat(),
        "repo": REPO_URL,
        "book": BOOK_NAME,
        "license": LICENSE_NAME,
        "licenseUrl": LICENSE_URL,
        "prevVersion": None,
        "prevIdMap": prev_map,
        "counts": essentials["counts"],
        "stats": essentials["stats"],
        "shards": shards,
        "brokenRefs": broken_list,
        "essentialsSize": size_e,
    }
    write_json(dist / "manifest.json", manifest)

    total = sum(s["size"] for s in shards)
    log("")
    log(f"  版本 {version}（上游 {sha[:7]}，提交于 {cdate}）")
    log(f"  分片 {len(shards)} 个，共 {total / 1024:.1f} KB；essentials {size_e / 1024:.1f} KB")
    log(f"  产物目录 {dist}")
    if not ok_all:
        log("  !! 统计自校验存在差异，请先核对再继续（可能上游改了格式或公布数字未同步）")
    return 0 if ok_all else 1


def _count(items: list[dict], key: str, order: tuple) -> dict:
    d = {k: 0 for k in order}
    for it in items:
        v = it.get(key)
        if v in d:
            d[v] += 1
    return d


def _commit_subject() -> str:
    return _COMMIT_SUBJECT["v"]


if __name__ == "__main__":
    sys.exit(main())
