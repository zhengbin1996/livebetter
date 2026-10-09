"""交叉引用（含锚点词）的解析、定位与转写。

上游正文里到处是「见第 8 节第 17 条（借条和担保）」这种指路。三类写法：
  1. 见第 N 节第 M 条（锚点词）   —— 跨节
  2. 见本节第 M 条（锚点词）      —— 同节
  3. 见第 M 条（锚点词）          —— 同节，省略「本节」
第 1 类必须先匹配并去掉，否则第 3 类正则会把它吃到。

定位策略与上游 tools/check-refs.mjs 同思路：先按条号定位；
条号越界时用锚点词在该节内做连续汉字模糊匹配兜底；仍失败标 broken。
"""

from __future__ import annotations

import re

from common import chars_for_search, strip_md

# 引用正文的两类正则（按优先级）
RE_CROSS = re.compile(r"见第\s*(\d+)\s*节第\s*(\d+)\s*条")
RE_SAME = re.compile(r"见(?:本节)?第\s*(\d+)\s*条")
RE_ANCHOR = re.compile(r"^（([^）\n。；，]{1,24})）")

# 「第 N 节」单独出现（暂未发现，保留探测）
RE_SEC_ONLY = re.compile(r"见第\s*(\d+)\s*节(?!第)")

_CJK_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff]")


def _longest_cjk_run(a: str, b: str) -> int:
    """两串的最长连续汉字公共长度，用于锚点词模糊匹配。"""
    if not a or not b:
        return 0
    prev = [0] * (len(b) + 1)
    best = 0
    for i in range(1, len(a) + 1):
        cur = [0] * (len(b) + 1)
        for j in range(1, len(b) + 1):
            if a[i - 1] == b[j - 1] and _CJK_RE.match(a[i - 1]):
                cur[j] = prev[j - 1] + 1
                if cur[j] > best:
                    best = cur[j]
        prev = cur
    return best


def extract(text: str, from_sec: int | None, sid_for_anchor: str | None = None) -> list[dict]:
    """从一段文本里抽出全部引用（保留出现位置，供转写用）。"""
    if not text:
        return []
    spans: list[tuple[int, int, dict]] = []

    def anchor_at(pos: int):
        m = RE_ANCHOR.match(text, pos)
        return m.group(1).strip() if m else None

    # 1) 跨节
    for m in RE_CROSS.finditer(text):
        end = m.end()
        a = anchor_at(end)
        if a:
            end = RE_ANCHOR.match(text, m.end()).end()
        spans.append((m.start(), end, {
            "toSec": int(m.group(1)),
            "toNum": int(m.group(2)),
            "anchor": a,
            "kind": "cross",
        }))

    taken = [(s, e) for s, e, _ in spans]

    def overlaps(s: int, e: int) -> bool:
        return any(not (e <= ts or s >= te) for ts, te in taken)

    # 2) 同节（本节第 M 条 / 第 M 条）
    for m in RE_SAME.finditer(text):
        if overlaps(m.start(), m.end()):
            continue
        end = m.end()
        a = anchor_at(end)
        if a:
            end = RE_ANCHOR.match(text, m.end()).end()
        spans.append((m.start(), end, {
            "toSec": from_sec,
            "toNum": int(m.group(1)),
            "anchor": a,
            "kind": "same",
        }))

    spans.sort()
    out = []
    for s, e, meta in spans:
        rec = dict(meta)
        rec["raw"] = text[s:e].strip()
        out.append(rec)
    return out


def resolve(rec: dict, sections: dict[int, list[dict]]) -> dict:
    """把一条引用定位到目标条目，产出 targetSid 与置信度。"""
    sec = rec.get("toSec")
    num = rec.get("toNum")
    anchor = rec.get("anchor")
    items = sections.get(sec) or []

    if not items:
        rec["confidence"] = "broken"
        rec["reason"] = "节不存在"
        return rec

    # ① 按条号
    if num and 1 <= num <= len(items):
        tgt = items[num - 1]
        rec["targetSid"] = tgt["sid"]
        rec["targetTitle"] = tgt["title"]
        rec["confidence"] = "num"
        rec["anchorOk"] = _anchor_matches(anchor, tgt)
        return rec

    # ② 条号越界 → 锚点词模糊匹配（挑最长连续汉字公共段最长的）
    if anchor:
        best, best_score = None, 0
        needle = strip_md(anchor)
        for it in items:
            score = max(
                _longest_cjk_run(needle, it["title"]),
                _longest_cjk_run(needle, it.get("plainText", "")),
            )
            if score > best_score:
                best, best_score = it, score
        if best is not None and best_score >= 3:
            rec["targetSid"] = best["sid"]
            rec["targetTitle"] = best["title"]
            rec["confidence"] = "anchor"
            rec["anchorOk"] = True
            rec["reason"] = f"条号 {num} 越界，按锚点词匹配（公共汉字 {best_score}）"
            return rec

    rec["confidence"] = "broken"
    rec["reason"] = f"条号 {num} 越界且锚点词无法定位" if anchor else f"条号 {num} 越界"
    return rec


def _anchor_matches(anchor: str | None, item: dict) -> bool:
    if not anchor:
        return True
    needle = chars_for_search(anchor)
    hay = chars_for_search(item["title"]) + chars_for_search(item.get("plainText", ""))
    if needle and needle in hay:
        return True
    return _longest_cjk_run(strip_md(anchor), item["title"]) >= 3


# 渲染层用的自定义协议：mp-html 的 linktap 拿到 href 后由客户端路由
REF_SCHEME = "ref://"


def rewrite(text: str, recs: list[dict]) -> tuple[str, int]:
    """把已定位的引用在原 markdown 里转写成 markdown 链接。

    返回 (新文本, 转写条数)。broken 的引用保持纯文本、不可点。
    """
    if not text or not recs:
        return text, 0
    out = []
    cursor = 0
    n = 0
    for rec in recs:
        raw = rec["raw"]
        start = text.find(raw, cursor)
        if start < 0:
            continue
        out.append(text[cursor:start])
        if rec.get("confidence") in ("num", "anchor") and rec.get("targetSid"):
            label = raw.replace("[", "\\[").replace("]", "\\]")
            out.append(f"[{label}]({REF_SCHEME}{rec['targetSid']})")
            n += 1
        else:
            out.append(raw)
        cursor = start + len(raw)
    out.append(text[cursor:])
    return "".join(out), n
