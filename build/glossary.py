"""术语表的抽取，以及正文里的术语标注。

术语表来自 README「读懂数字（术语表）」一节里 `<details>` 包住的表格（41 条）。
渲染时把正文首次出现的术语包成 `[术语](gloss://术语)`，
客户端 mp-html 的 linktap 拿到 href 后弹释义气泡——释义已随 essentials 内置，不用联网。
"""

from __future__ import annotations

import re

from common import chars_for_search, strip_md

# 只对这三个字段做术语标注：出现统计名词的地方
MARK_FIELDS = ("plain", "benefit", "note")

# 太短或太泛，标了反而干扰阅读
SKIP_TERMS = {"r", "d、g", "队列", "混杂", "观察性", "风险差", "包年", "意向筛查分析"}

_PROTECT = re.compile(
    r"(<https?://[^>\s]+>|\[[^\]\n]*\]\([^)\n]*\)|https?://\S+)"
)
_CJK = r"\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff"


# ---------------------------------------------------------------- 抽取

def parse_readme_glossary(readme: str) -> list[dict]:
    """从 README 的 `<details>` 表格里抽术语表。"""
    m = re.search(r"<details>.*?</details>", readme, re.S)
    if not m:
        return []
    out = []
    for line in m.group(0).split("\n"):
        line = line.strip()
        if not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        if len(cells) < 2:
            continue
        term, meaning = cells[0], cells[1]
        if not term or term in ("术语", "---") or set(term) <= set("-: "):
            continue
        out.append({"term": term, "meaning": meaning})
    return out


# ---------------------------------------------------------------- 标注

def build_matcher(terms: list[dict]):
    """给出可标注的词表（按长度降序，长的先匹配，避免「风险」吃掉「风险差」）。"""
    keep = []
    for t in terms:
        term = t["term"]
        if term in SKIP_TERMS:
            continue
        core = term.replace(" ", "")
        if len(core) < 2:
            continue
        keep.append(term)
    keep.sort(key=len, reverse=True)
    return keep


def _term_regex(term: str) -> re.Pattern:
    parts = [re.escape(p) for p in term.split(" ") if p]
    body = r"\s*".join(parts) if len(parts) > 1 else re.escape(term)
    has_cjk = bool(re.search(f"[{_CJK}]", term))
    if has_cjk:
        return re.compile(body)
    return re.compile(rf"(?<![A-Za-z0-9]){body}(?![A-Za-z0-9])")


def mark_terms(text: str, matcher: list[dict], already: set[str]) -> tuple[str, list[str]]:
    """在文本里标注术语，每个字段内每个术语只标第一次出现。

    already 跨字段累积，避免同一术语在一条建议里标四次。
    """
    if not text:
        return text, []
    hits: list[str] = []
    # 切成「正文段 / 受保护段」，只在正文段里标注
    pieces = _PROTECT.split(text)
    for idx in range(0, len(pieces), 2):  # 偶数下标 = 正文段
        seg = pieces[idx]
        if not seg:
            continue
        for term in matcher:
            if term in already:
                continue
            rx = _term_regex(term)
            m = rx.search(seg)
            if not m:
                continue
            seg = f"{seg[:m.start()]}[{m.group(0)}](gloss://{term}){seg[m.end():]}"
            already.add(term)
            hits.append(term)
        pieces[idx] = seg
    if not hits:
        return text, []
    return "".join(pieces), hits


GLOSS_SCHEME = "gloss://"


def term_index(terms: list[dict]) -> dict[str, str]:
    """给客户端一份「去空白小写 → 术语」的索引，用于解答与反查。"""
    idx = {}
    for t in terms:
        idx[chars_for_search(t["term"])] = t["term"]
    return idx


def plain_first_sentence(text: str, limit: int = 120) -> str:
    t = strip_md(text)
    if len(t) <= limit:
        return t
    cut = t[:limit]
    for sep in ("。", "；", "，"):
        i = cut.rfind(sep)
        if i > limit * 0.5:
            return cut[: i + 1]
    return cut + "…"
