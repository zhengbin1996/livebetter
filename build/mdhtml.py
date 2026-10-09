"""把正文 markdown 渲染成 HTML，在**构建期**完成。

为什么不在客户端解析 markdown：
  * mp-html 的原生小程序版不带 markdown 插件，客户端要么自己写解析器、
    要么引入额外依赖，两条路都在运行时引入不确定性；
  * 构建期渲染可以顺便给交叉引用和术语挂上 class（样式见 app.wxss），
    客户端渲染层就退化成「只认 HTML」，风险面最小。

支持的语法就是上游实际用到的那些（已统计）：
  标题 # ~ ######、无序列表（含一层嵌套）、有序列表、引用块、表格、分隔线、
  粗体、行内代码、`[文字](链接)`、`<自动链接>`。
上游正文里没有代码围栏，所以不实现。
"""

from __future__ import annotations

import html as _html
import re

# 行内元素一次扫完：代码 → 自动链接 → 链接 → 粗体
INLINE = re.compile(
    r"(?P<code>`[^`\n]+`)"
    r"|(?P<auto><https?://[^>\s]+>)"
    r"|(?P<link>\[[^\]\n]*\]\([^)\n]+\))"
    r"|(?P<bold>\*\*[^*\n]+\*\*)"
)

RE_HEAD = re.compile(r"^(#{1,6})\s+(.*)$")
RE_UL = re.compile(r"^(\s*)[-*]\s+(.*)$")
RE_OL = re.compile(r"^(\s*)(\d+)\.\s+(.*)$")
RE_QUOTE = re.compile(r"^>\s?(.*)$")
RE_TABLE_SEP = re.compile(r"^\|[\s:|-]+\|$")
RE_HR = re.compile(r"^\s*([-*_])\s*(\1\s*){2,}$")

_SCHEME_CLASS = {"ref://": "ref", "gloss://": "gl"}

_CJK = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]")


def esc(t: str) -> str:
    return _html.escape(t, quote=False)


def _link(inner: str, url: str) -> str:
    cls = ""
    for scheme, name in _SCHEME_CLASS.items():
        if url.startswith(scheme):
            cls = f' class="{name}"'
            break
    else:
        if url.startswith("http"):
            cls = ' class="ext"'
    return f'<a{cls} href="{_html.escape(url, quote=True)}">{inner}</a>'


def inline(text: str) -> str:
    """行内渲染。逐段处理：普通段落转义，特殊语法原样处理，避免注入。"""
    out = []
    pos = 0
    for m in INLINE.finditer(text):
        if m.start() > pos:
            out.append(esc(text[pos:m.start()]))
        kind = m.lastgroup
        raw = m.group(0)
        if kind == "code":
            out.append(f"<code>{esc(raw[1:-1])}</code>")
        elif kind == "auto":
            url = raw[1:-1]
            out.append(_link(esc(url), url))
        elif kind == "link":
            mm = re.match(r"^\[([^\]]*)\]\(([^)\n]+)\)$", raw)
            label, url = mm.group(1), mm.group(2).strip()
            # 标题式写法 [x](url "title") —— 我们的产物里没有，保险起见去掉
            if " " in url and not url.startswith("ref://") and not url.startswith("gloss://"):
                url = url.split()[0]
            out.append(_link(esc(label), url))
        elif kind == "bold":
            out.append(f"<b>{inline(raw[2:-2])}</b>")
        pos = m.end()
    if pos < len(text):
        out.append(esc(text[pos:]))
    return "".join(out)


def _join_lines(lines: list[str]) -> str:
    """段内软换行合并：两侧都是中日韩字符就直接接上，否则补一个空格。"""
    s = ""
    for ln in lines:
        t = ln.strip()
        if not t:
            continue
        if s and not (_CJK.search(s[-1]) and _CJK.search(t[0])):
            s += " "
        s += t
    return s


def _table(rows: list[str]) -> str:
    def cells(line: str) -> list[str]:
        body = line.strip()
        if body.startswith("|"):
            body = body[1:]
        if body.endswith("|"):
            body = body[:-1]
        # 支持 \| 转义
        return [c.strip().replace("\\|", "|") for c in re.split(r"(?<!\\)\|", body)]

    if not rows:
        return ""
    head = cells(rows[0])
    body_rows = rows[2:] if len(rows) > 1 and RE_TABLE_SEP.match(rows[1].strip()) else rows[1:]
    thead = "".join(f"<th>{inline(c)}</th>" for c in head)
    tbody = ""
    for r in body_rows:
        if RE_TABLE_SEP.match(r.strip()):
            continue
        tbody += "<tr>" + "".join(f"<td>{inline(c)}</td>" for c in cells(r)) + "</tr>"
    return (
        '<table class="md-t"><thead><tr>' + thead + "</tr></thead>"
        + ("<tbody>" + tbody + "</tbody>" if tbody else "")
        + "</table>"
    )


def render(md: str) -> str:
    """块级渲染。输入一段 markdown，输出 HTML 片段。"""
    if not md:
        return ""
    lines = md.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    out: list[str] = []
    heads: list[dict] = []
    i = 0
    n = len(lines)

    while i < n:
        line = lines[i]
        s = line.strip()

        if not s:
            i += 1
            continue

        # 分隔线
        if RE_HR.match(s):
            out.append('<hr class="md-hr">')
            i += 1
            continue

        # 标题：带 id，供长文页的目录跳转
        m = RE_HEAD.match(s)
        if m:
            lvl = len(m.group(1))
            hid = f"h{len(heads)}"
            heads.append({"id": hid, "level": lvl, "text": _strip_inline(m.group(2))})
            out.append(f'<h{lvl} id="{hid}">{inline(m.group(2))}</h{lvl}>')
            i += 1
            continue

        # 表格
        if s.startswith("|"):
            block = []
            while i < n and lines[i].strip().startswith("|"):
                block.append(lines[i])
                i += 1
            out.append(_table(block))
            continue

        # 引用块
        if RE_QUOTE.match(s):
            block = []
            while i < n and RE_QUOTE.match(lines[i].strip()):
                block.append(RE_QUOTE.match(lines[i].strip()).group(1))
                i += 1
            out.append(f"<blockquote>{inline(_join_lines(block))}</blockquote>")
            continue

        # 列表（含一层嵌套）
        mo = RE_UL.match(line) or RE_OL.match(line)
        if mo:
            ordered = bool(RE_OL.match(line))
            out.append(_list(lines, i, ordered)[0])
            i = _list(lines, i, ordered)[1]
            continue

        # 段落：连续的普通行合成一段
        block = []
        while i < n:
            t = lines[i].strip()
            if not t:
                break
            if (
                RE_HEAD.match(t)
                or t.startswith("|")
                or RE_QUOTE.match(t)
                or RE_HR.match(t)
                or RE_UL.match(lines[i])
                or RE_OL.match(lines[i])
            ):
                break
            block.append(lines[i])
            i += 1
        if block:
            out.append(f"<p>{inline(_join_lines(block))}</p>")

    return "".join(out)


def render_doc(md: str) -> tuple[str, list[dict]]:
    """长文渲染：返回 (HTML, 大纲)。大纲供长文页的目录跳转用。"""
    html = render(md)
    heads = re.findall(r'<h([1-4]) id="(h\d+)">(.*?)</h\1>', html)
    toc = [
        {"id": hid, "level": int(lvl), "text": _strip_inline(txt)}
        for lvl, hid, txt in heads
    ]
    return html, toc


def _strip_inline(t: str) -> str:
    """把已渲染的行内 HTML 压成纯文本（用于标题大纲）。"""
    return _html.unescape(re.sub(r"<[^>]+>", "", t)).strip()


def _list(lines: list[str], start: int, ordered: bool) -> tuple[str, int]:
    """渲染一个列表块，返回 (html, 下一行下标)。支持按缩进的一层嵌套。"""
    items: list[tuple[int, str]] = []
    i = start
    n = len(lines)
    while i < n:
        line = lines[i]
        m = RE_OL.match(line) if ordered else RE_UL.match(line)
        if not m:
            if not line.strip():
                break
            # 续行（缩进的普通行）接到上一条
            if items and line.startswith("  "):
                items[-1] = (items[-1][0], items[-1][1] + line.strip())
                i += 1
                continue
            break
        indent = len(m.group(1))
        text = m.group(3) if ordered else m.group(2)
        items.append((indent, text))
        i += 1

    if not items:
        return "", i

    tag = "ol" if ordered else "ul"
    base = min(ind for ind, _ in items)
    out = [f"<{tag}>"]
    depth = 0
    for indent, text in items:
        want = 1 if indent - base >= 2 else 0
        while depth < want:
            out.append(f"<{tag}>")
            depth += 1
        while depth > want:
            out.append(f"</{tag}>")
            depth -= 1
        out.append(f"<li>{inline(text)}</li>")
    while depth > 0:
        out.append(f"</{tag}>")
        depth -= 1
    out.append(f"</{tag}>")
    return "".join(out), i
