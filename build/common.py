"""共享工具：路径、稳定 ID、文本清洗、哈希。

稳定 ID 的设计意图：条目主键不依赖条号。
上游规则是新增条目一律追加在节末，但删条目会让整节条号整体减一；
若用 `s08i17` 做主键，一次删条就会让用户的收藏和打卡串位。
所以主键取「节号 + 标题哈希」。
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

# ---------------------------------------------------------------- 路径

BUILD_DIR = Path(__file__).resolve().parent
ROOT = BUILD_DIR.parent
UPSTREAM = ROOT / "upstream"
DIST = ROOT / "dist"
BOOK_DIR = UPSTREAM / "book"
DOCS_DIR = UPSTREAM / "docs"
VERIFY_DIR = DOCS_DIR / "核实记录"

# 小程序主包内置的索引目录：essentials.json 要跟着构建一起更新，
# 否则「构建产物是新的、小程序里读的还是旧的」这种偏差很难查。
MINIPROGRAM = ROOT / "miniprogram"
BUNDLE_DATA = MINIPROGRAM / "data"

BOOK_NAME = "高性价比人生指南"
REPO_URL = "https://github.com/eternity4719/HowToLiveBetter"
LICENSE_NAME = "CC BY 4.0"
LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/"

# 字段顺序固定，但解析时不依赖顺序
FIELD_NAMES = ["成本", "说人话", "收益", "证据等级", "来源", "备注"]
FIELD_KEYS = {
    "成本": "cost",
    "说人话": "plain",
    "收益": "benefit",
    "证据等级": "evidence",
    "来源": "source",
    "备注": "note",
}

# 成本标签取值域（来自条目标题下的 HTML 注释）
TAG_MONEY = ("0", "少", "多")
TAG_TIME = ("少", "中", "多")
TAG_WILL = ("否", "些", "是")
TAG_BENEFIT = ("大", "中", "小")
TAG_CALIBER = ("死亡率", "金钱", "时间", "自由")

# 上游注释里是中文键，内部统一转成稳定英文键，避免下游到处写中文
TAG_KEY_MAP = {
    "钱": "money",
    "时间": "time",
    "毅力": "will",
    "收益": "benefit",
    "口径": "caliber",
}
TAG_FIELDS = ("money", "time", "will", "benefit", "caliber")


# ---------------------------------------------------------------- ID

def sha1_short(text: str, n: int = 10) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:n]


def make_sid(sec: int, title: str) -> str:
    """条目稳定主键：s{两位节号}-{标题 sha1 前 10 位}。"""
    return f"s{sec:02d}-{sha1_short(normalize_title(title))}"


def normalize_title(title: str) -> str:
    """标题归一化后再哈希，避免空白/全角括号差异造成 id 漂移。"""
    t = title.strip()
    t = re.sub(r"\s+", "", t)
    return t


def make_doc_sid(name: str) -> str:
    """长文/核实记录的稳定主键。"""
    return f"d-{sha1_short(name, 10)}"


# ---------------------------------------------------------------- 文本

_LINK_RE = re.compile(r"<((?:https?|mailto):[^>\s]+)>")
_MDLINK_RE = re.compile(r"\[([^\]]*)\]\(([^)]+)\)")
_BOLD_RE = re.compile(r"\*{1,3}([^*\n]+)\*{1,3}")
_CODE_RE = re.compile(r"`([^`\n]+)`")
_HTMLC_RE = re.compile(r"<!--.*?-->", re.S)
_SPACES_RE = re.compile(r"[ \t\u00a0\u3000]+")


def strip_md(text: str) -> str:
    """把 markdown 压成纯文本，供检索语料和列表摘要使用。

    只做无损替换：不改写任何数字、不改动词。渲染仍用原始 markdown。
    """
    if not text:
        return ""
    t = _HTMLC_RE.sub("", text)
    t = _LINK_RE.sub(r"\1", t)
    t = _MDLINK_RE.sub(r"\1", t)
    t = _BOLD_RE.sub(r"\1", t)
    t = _CODE_RE.sub(r"\1", t)
    t = _SPACES_RE.sub(" ", t)
    return t.strip()


_CJK = r"\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff"


def chars_for_search(text: str) -> str:
    """检索用归一化：小写、全角转半角、去掉所有空白。

    中文没有词边界，客户端子串扫描与服务端匹配都用「去空白」版本，
    这样用户输「低钠盐」能命中「低钠 盐」这类排版断行。
    """
    t = strip_md(text).lower()
    out = []
    for ch in t:
        code = ord(ch)
        if 0xFF01 <= code <= 0xFF5E:  # 全角 ASCII
            out.append(chr(code - 0xFEE0))
        elif code == 0x3000:
            out.append(" ")
        else:
            out.append(ch)
    t = "".join(out)
    return re.sub(r"\s+", "", t)


_LEAD_HEADING_RE = re.compile(r"^\s*#{1,6}\s*", re.M)
_LEAD_TABLE_RE = re.compile(r"^\s*\|.*\|\s*$", re.M)
_LEAD_HR_RE = re.compile(r"^\s*-{3,}\s*$", re.M)


def plain_lead(md: str, n: int = 400) -> str:
    """把一段 markdown 压成**可读**的纯文本摘要（保留大小写与句读）。

    用于检索结果里的「摘要」预览：去标题记号、去表格行、去分隔线，
    再把空白折成单空格，避免结果里冒出 `#` `|` 这类排版残留。
    """
    if not md:
        return ""
    t = strip_md(md)
    t = _LEAD_HR_RE.sub("", t)
    t = _LEAD_TABLE_RE.sub("", t)
    t = _LEAD_HEADING_RE.sub("", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t[:n]


# ---------------------------------------------------------------- IO

def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def write_json(path: Path, obj) -> int:
    """写出紧凑 JSON，返回文件字节数。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    data = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    raw = data.encode("utf-8")
    path.write_bytes(raw)
    return len(raw)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    h.update(path.read_bytes())
    return h.hexdigest()


def log(msg: str) -> None:
    print(msg, flush=True)
