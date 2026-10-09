"""条目 ID 快照与迁移表（prevIdMap）。

条目主键是「节号 + 标题哈希」，所以标题被改写（哪怕只改一个字）就会换 id。
用户收藏和打卡存的是 id，直接换掉等于丢数据。
做法：每次构建产出 ids.json 快照；下一次构建把「这版消失、上一版存在」的 id
在**同一节内**用标题相似度找最可能的对应条目，写进 prevIdMap，客户端据此迁移。
"""

from __future__ import annotations

import difflib
import json
from pathlib import Path

from common import DIST, chars_for_search, log

IDS_FILE = DIST / "ids.json"
RATIO_FLOOR = 0.55


def load_prev(path: Path = IDS_FILE) -> dict:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def snapshot(sections: list[dict]) -> dict:
    out = {}
    for sec in sections:
        for it in sec["items"]:
            out[it["sid"]] = {
                "sec": sec["sec"],
                "num": it["num"],
                "title": it["title"],
                "key": chars_for_search(it["title"]),
            }
    return out


def build_map(prev: dict, cur: dict) -> tuple[dict[str, str], dict[str, str]]:
    """返回 (prevIdMap, newsid->oldsid)。

    prevIdMap: 旧 id → 新 id（客户端迁移收藏/打卡用）
    """
    prev_ids = set(prev)
    cur_ids = set(cur)
    gone = prev_ids - cur_ids
    added = cur_ids - prev_ids

    by_sec: dict[int, list[str]] = {}
    for sid in added:
        by_sec.setdefault(cur[sid]["sec"], []).append(sid)

    prev_map: dict[str, str] = {}
    newsid_old: dict[str, str] = {}
    used: set[str] = set()

    for old in sorted(gone):
        info = prev[old]
        pool = [s for s in by_sec.get(info["sec"], []) if s not in used]
        best, best_ratio = None, 0.0
        for cand in pool:
            ratio = difflib.SequenceMatcher(
                None, info["key"], cur[cand]["key"]
            ).ratio()
            if ratio > best_ratio:
                best, best_ratio = cand, ratio
        if best and best_ratio >= RATIO_FLOOR:
            prev_map[old] = best
            newsid_old[best] = old
            used.add(best)
    return prev_map, newsid_old


def save(cur: dict, path: Path = IDS_FILE) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(cur, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )


def report(prev: dict, cur: dict, prev_map: dict) -> None:
    gone = len(set(prev) - set(cur))
    added = len(set(cur) - set(prev))
    if not prev:
        log(f"    id 快照：首次构建，{len(cur)} 条")
        return
    log(
        f"    id 快照：新增 {added}、消失 {gone}，"
        f"其中 {len(prev_map)} 条已建立迁移映射，{gone - len(prev_map)} 条无对应（收藏会保留为失效项）"
    )
