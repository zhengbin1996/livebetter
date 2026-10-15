import base64
import hashlib
import json
import re
import shutil
from html import escape
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import BaseDocTemplate, Frame, PageBreak, PageTemplate, Paragraph, Spacer
from reportlab.platypus.tableofcontents import TableOfContents


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'output' / 'pdf' / 'reading-pack'
INK = colors.HexColor('#282923')
ACCENT = colors.HexColor('#B64C2C')
MUTED = colors.HexColor('#68685E')
PAPER = colors.HexColor('#FAF9F5')
THEMES = [
    ('家庭安全', [1, 13]),
    ('钱与保障', [5, 7]),
    ('求职与工作', [19]),
    ('租房生活', [15]),
    ('看病就医', [24]),
    ('账号安全', [14]),
]


def font_text(text):
    try:
        glyphs = pdfmetrics.getFont('Reader').face.charToGlyph
    except KeyError:
        return escape(text)
    return ''.join(escape(character) if glyphs.get(ord(character)) or character.isspace() else f'<font name="ReaderSymbols">{escape(character)}</font>' for character in text)


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8'))


def read_book():
    essentials = read_json(ROOT / 'dist' / 'essentials.json')
    sections = [read_json(ROOT / 'dist' / 'book' / f"{section['sec']:02d}.json") for section in essentials['sections']]
    docs = [read_json(ROOT / 'dist' / 'docs' / f"{article['sid']}.json") for article in essentials['docs'] if article.get('kind') == 'doc']
    return {'essentials': essentials, 'sections': sections, 'docs': docs}


class Blocks(HTMLParser):
    def __init__(self, resolve):
        super().__init__(convert_charrefs=True)
        self.resolve = resolve
        self.blocks = []
        self.tokens = []
        self.active = []
        self.kind = 'body'
        self.cell = 0

    def flush(self):
        content = ''.join(self.tokens)
        if re.sub('<[^>]*>', '', content).strip():
            self.blocks.append((self.kind, content + ''.join(close for _, _, close in reversed(self.active))))
        self.tokens = [opening for _, opening, _ in self.active]

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        if tag in ('p', 'div', 'blockquote', 'li', 'pre', 'tr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'):
            self.flush()
            self.kind = 'subhead' if re.fullmatch('h[1-6]', tag) else 'body'
            if tag == 'li':
                self.tokens.append('• ')
            if tag == 'tr':
                self.cell = 0
        elif tag in ('td', 'th'):
            if self.cell:
                self.tokens.append('　|　')
            self.cell += 1
        elif tag == 'br':
            self.tokens.append('<br/>')
        elif tag in ('b', 'strong', 'i', 'em', 'sup', 'sub', 'a'):
            name = {'strong': 'b', 'em': 'i'}.get(tag, tag)
            if tag == 'a':
                target = self.resolve(attrs.get('href', ''))
                opening = f'<a href="{escape(target, quote=True)}" color="#B64C2C">' if target else ''
                closing = '</a>' if target else ''
            else:
                opening, closing = f'<{name}>', f'</{name}>'
            self.active.append((tag, opening, closing))
            self.tokens.append(opening)
        elif tag == 'img':
            self.tokens.append(escape(attrs.get('alt', '')))

    def handle_endtag(self, tag):
        if tag in ('b', 'strong', 'i', 'em', 'sup', 'sub', 'a'):
            if self.active and self.active[-1][0] == tag:
                self.tokens.append(self.active.pop()[2])
        elif tag in ('p', 'div', 'blockquote', 'li', 'pre', 'tr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'):
            self.flush()
            self.kind = 'body'

    def handle_data(self, data):
        self.tokens.append(font_text(data))


def html_blocks(source, resolve):
    parser = Blocks(resolve)
    parser.feed(source)
    parser.close()
    parser.flush()
    return parser.blocks


class ReadingPDF(BaseDocTemplate):
    def __init__(self, destination, subtitle):
        super().__init__(str(destination), pagesize=(420, 595), leftMargin=32, rightMargin=32, topMargin=45, bottomMargin=43, title=f'高性价比人生指南 · {subtitle}', author='原作：eternity4719；小程序阅读版排版整理')
        frame = Frame(self.leftMargin, self.bottomMargin, self.width, self.height, leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
        self.addPageTemplates(PageTemplate(id='reader', frames=frame, onPage=self.decorations))
        self.subtitle = subtitle

    def decorations(self, canvas, document):
        canvas.saveState()
        canvas.setFillColor(PAPER)
        canvas.rect(0, 0, 420, 595, fill=1, stroke=0)
        canvas.setStrokeColor(INK)
        canvas.setLineWidth(1)
        canvas.line(32, 563, 388, 563)
        canvas.setFillColor(MUTED)
        canvas.setFont('Reader', 8)
        canvas.drawString(32, 573, '高性价比人生指南')
        canvas.drawRightString(388, 573, self.subtitle)
        canvas.drawString(32, 23, '原作：eternity4719 · CC BY 4.0')
        canvas.drawRightString(388, 23, str(document.page))
        canvas.restoreState()

    def afterFlowable(self, flowable):
        marker = getattr(flowable, 'marker', None)
        if not marker:
            return
        title, key, level, in_contents = marker
        self.canv.bookmarkPage(key)
        self.canv.addOutlineEntry(title, key, level=level, closed=level > 0)
        if in_contents:
            self.notify('TOCEntry', (0, title, self.page, key))


def register_fonts():
    font = next((path for path in [Path('C:/Windows/Fonts/msyh.ttc'), Path('/usr/share/fonts/truetype/noto/NotoSansSC-Regular.ttf')] if path.exists()), None)
    if not font:
        raise RuntimeError('需要可嵌入的中文 TrueType 字体')
    pdfmetrics.registerFont(TTFont('Reader', str(font), subfontIndex=0))
    bold = Path('C:/Windows/Fonts/msyhbd.ttc')
    pdfmetrics.registerFont(TTFont('ReaderBold', str(bold if bold.exists() else font), subfontIndex=0))
    pdfmetrics.registerFontFamily('Reader', normal='Reader', bold='ReaderBold', italic='Reader', boldItalic='ReaderBold')
    symbols = next((path for path in [Path('C:/Windows/Fonts/seguisym.ttf'), Path('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')] if path.exists()), None)
    if not symbols:
        raise RuntimeError('需要用于保留原文数学符号的字体')
    pdfmetrics.registerFont(TTFont('ReaderSymbols', str(symbols)))


def styles():
    body = ParagraphStyle('body', fontName='Reader', fontSize=11, leading=19, textColor=INK, wordWrap='CJK', spaceAfter=9, splitLongWords=True, alignment=TA_LEFT)
    return {
        'body': body,
        'title': ParagraphStyle('title', parent=body, fontName='ReaderBold', fontSize=28, leading=39, spaceAfter=18),
        'chapter': ParagraphStyle('chapter', parent=body, fontName='ReaderBold', fontSize=23, leading=32, spaceAfter=18),
        'item': ParagraphStyle('item', parent=body, fontName='ReaderBold', fontSize=16, leading=25, spaceBefore=20, spaceAfter=13, keepWithNext=True),
        'subhead': ParagraphStyle('subhead', parent=body, fontName='ReaderBold', fontSize=13, leading=22, spaceBefore=16, keepWithNext=True),
        'label': ParagraphStyle('label', parent=body, fontName='ReaderBold', fontSize=9, leading=15, textColor=ACCENT, spaceBefore=10, spaceAfter=5, keepWithNext=True),
        'small': ParagraphStyle('small', parent=body, fontSize=9, leading=16, textColor=MUTED),
        'summary': ParagraphStyle('summary', parent=body, backColor=colors.HexColor('#EDEDE7'), borderPadding=10, leftIndent=10, rightIndent=10, spaceAfter=16),
        'toc': ParagraphStyle('toc', parent=body, fontSize=10, leading=18, spaceAfter=8),
    }


def glossary_key(term):
    return 'term-' + hashlib.sha1(term.encode('utf-8')).hexdigest()[:12]


def resolver(book, included):
    doc_names = {article['name']: article['sid'] for article in book['docs']}
    terms = {term['term'] for term in book['essentials'].get('glossary', [])}

    def resolve(href):
        if href.startswith(('ref://', 'doc://')):
            target = href.split('://', 1)[1].split('#')[0]
            return '#' + target if target in included else None
        if href.startswith('gloss://'):
            term = unquote(href[8:])
            key = glossary_key(term)
            return '#' + key if term in terms and key in included else None
        path = unquote(href).split('?')[0].split('#')[0]
        match = re.search(r'(?:^|/)docs/([^/]+)\.md$', path)
        if match and match[1] in doc_names:
            target = doc_names[match[1]]
            return '#' + target if target in included else None
        return href if re.match(r'^https?://', href) else None

    return resolve


def heading(story, title, key, style, level=0, contents=True):
    flowable = Paragraph(escape(title), style)
    flowable.marker = (title, key, level, contents)
    story.append(flowable)


def add_html(story, source, palette, resolve, summary=False):
    for kind, content in html_blocks(source, resolve):
        story.append(Paragraph(content, palette['summary' if summary else kind]))


def front(story, book, palette, subtitle, introduction):
    meta = book['essentials']['meta']
    story.extend([Spacer(1, 58), Paragraph('便携阅读包', palette['label']), Paragraph(escape(meta['book']), palette['title']), Paragraph(subtitle, palette['chapter']), Paragraph(introduction, palette['body']), Spacer(1, 22), Paragraph(f"内容日期：{meta['upstreamDate'][:10]}", palette['small']), Paragraph('原作：eternity4719 / HowToLiveBetter', palette['small'])])
    story.append(PageBreak())
    story.append(Paragraph('阅读与来源说明', palette['chapter']))
    for text in [
        '小程序内的原文阅读、检索、收藏和离线阅读免费。本阅读包提供便携文件的排版与索引整理；原文并非独家付费内容。',
        '本版为内容日期对应的快照。可点击目录或使用 PDF 书签查找内容；不同阅读器对内部跳转的支持可能不同。摘要、条件、数字和争议提示均保留，判断前请阅读完整原文和来源。',
        '作者署名：eternity4719。原作《高性价比人生指南》采用 CC BY 4.0 许可。原书文字与数字未作改写，本版仅调整排版、分页、导航与主题索引。技术核实过程材料和交叉引用维护表未收入阅读包。',
        '本内容为生活建议，不构成医疗建议或法律意见；就医请遵医嘱，涉诉请咨询律师。政策、法条和期限可能变化，请核对当期官方信息。',
    ]:
        story.append(Paragraph(text, palette['body']))
    for label, url in [('原作', meta['repo']), ('许可', meta['licenseUrl'])]:
        story.append(Paragraph(f'{label}：<a href="{escape(url, quote=True)}" color="#B64C2C">{escape(url)}</a>', palette['small']))
    story.append(PageBreak())
    story.append(Paragraph('目录', palette['chapter']))
    toc = TableOfContents()
    toc.levelStyles = [palette['toc']]
    story.extend([toc, PageBreak()])


def add_item(story, item, palette, resolve):
    heading(story, f"第 {item['num']} 条　{item['title']}", item['sid'], palette['item'], level=1, contents=False)
    labels = [label for flag, label in [('dispute', '争议'), ('todo', '待核实')] if item.get(flag)]
    if labels:
        story.append(Paragraph(' · '.join(labels), palette['label']))
    fields = item['fields']
    if fields.get('说人话'):
        story.append(Paragraph('原文摘要 · 说人话', palette['label']))
        add_html(story, fields['说人话'], palette, resolve, summary=True)
    for key, content in fields.items():
        if key == '说人话':
            continue
        story.append(Paragraph(escape(key), palette['label']))
        add_html(story, content, palette, resolve)


def full_pdf(book, palette):
    included = {item['sid'] for section in book['sections'] for item in section['items']}
    included.update(article['sid'] for article in book['docs'])
    included.update(glossary_key(term['term']) for term in book['essentials']['glossary'])
    resolve = resolver(book, included)
    story = []
    front(story, book, palette, '全书阅读版', '34 节建议与 9 篇专题长文。先看标题与原文摘要，再按需要查阅完整正文。')
    for section in book['sections']:
        heading(story, f"第 {section['sec']} 节　{section['secTitle']}", f"section-{section['sec']}", palette['chapter'])
        story.append(Paragraph('本节导读', palette['label']))
        add_html(story, ''.join(section['intro']), palette, resolve)
        for item in section['items']:
            add_item(story, item, palette, resolve)
        story.append(PageBreak())
    for article in book['docs']:
        heading(story, article['title'], article['sid'], palette['chapter'])
        add_html(story, article['body'], palette, resolve)
        story.append(PageBreak())
    heading(story, '术语表', 'glossary', palette['chapter'])
    for term in book['essentials']['glossary']:
        heading(story, term['term'], glossary_key(term['term']), palette['subhead'], level=1, contents=False)
        story.append(Paragraph(escape(term['meaning']), palette['body']))
    story.append(PageBreak())
    heading(story, '原书标注释义', 'legend', palette['chapter'])
    legend = book['essentials']['legend']
    for key, title in [('evidenceNote', '证据等级'), ('tierNote', '性价比档'), ('resourcesNote', '资源与收益口径')]:
        story.append(Paragraph(title, palette['subhead']))
        add_html(story, legend.get(key, ''), palette, resolve)
    if legend.get('tierRules'):
        story.append(Paragraph('性价比判断规则', palette['subhead']))
        for row in legend['tierRules']:
            story.append(Paragraph('　|　'.join(escape(str(cell)) for cell in row), palette['body']))
    ReadingPDF(OUTPUT / 'book.pdf', '全书阅读版').multiBuild(story)


def themes_pdf(book, palette):
    story = []
    front(story, book, palette, '主题查阅索引', '六个常用处境，按原书章节和条目标题查找。完整正文与来源见全书阅读版或免费小程序。')
    for index, (name, numbers) in enumerate(THEMES):
        heading(story, name, f'theme-{index}', palette['chapter'])
        for section in book['sections']:
            if section['sec'] not in numbers:
                continue
            heading(story, f"第 {section['sec']} 节　{section['secTitle']}", f"theme-section-{section['sec']}", palette['subhead'], level=1, contents=False)
            for item in section['items']:
                flags = ' · '.join(label for flag, label in [('dispute', '争议'), ('todo', '待核实')] if item.get(flag))
                story.append(Paragraph(f"{item['num']:02d}　{escape(item['title'])}" + (f'　[{flags}]' if flags else ''), palette['body']))
        story.append(PageBreak())
    heading(story, '专题长文索引', 'theme-docs', palette['chapter'])
    for article in book['docs']:
        story.append(Paragraph(escape(article['title']), palette['subhead']))
        for line in article.get('toc', []):
            if line['level'] == 2:
                story.append(Paragraph(escape(line['text']), palette['small']))
    ReadingPDF(OUTPUT / 'themes.pdf', '主题查阅索引').multiBuild(story)


def sample_pdf(book, palette):
    samples = book['sections'][0]['items'][:3]
    resolve = resolver(book, {item['sid'] for item in samples})
    story = []
    front(story, book, palette, '免费排版样张', '第 1 节前 3 条建议，完整保留原文摘要、收益、成本、证据、备注与来源。')
    heading(story, '第 1 节　不要早死', 'sample-section', palette['chapter'])
    for item in samples:
        add_item(story, item, palette, resolve)
    ReadingPDF(OUTPUT / 'sample.pdf', '免费样张').multiBuild(story)


def bundle_sample():
    sample = base64.b64encode((OUTPUT / 'sample.pdf').read_bytes()).decode('ascii')
    (ROOT / 'miniprogram' / 'data' / 'reading-pack-sample.js').write_text('module.exports = ' + json.dumps(sample) + '\n', encoding='utf-8', newline='\n')


def main():
    book = read_book()
    OUTPUT.mkdir(parents=True, exist_ok=True)
    register_fonts()
    palette = styles()
    full_pdf(book, palette)
    themes_pdf(book, palette)
    sample_pdf(book, palette)
    meta = book['essentials']['meta']
    manifest = {
        'title': '便携阅读包', 'priceFen': 100, 'paymentEnabled': False,
        'contentDate': meta['upstreamDate'][:10], 'version': meta['version'],
        'sections': len(book['sections']), 'items': sum(len(section['items']) for section in book['sections']),
        'docs': len(book['docs']), 'themeNames': [name for name, _ in THEMES],
        'samples': [{key: item[key] for key in ('num', 'title', 'fields', 'dispute', 'todo')} for item in book['sections'][0]['items'][:3]],
        'files': [{'name': name, 'bytes': (OUTPUT / name).stat().st_size, 'sha256': hashlib.sha256((OUTPUT / name).read_bytes()).hexdigest()} for name in ('book.pdf', 'themes.pdf', 'sample.pdf')],
    }
    (OUTPUT / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    module = 'module.exports = ' + json.dumps(manifest, ensure_ascii=False, separators=(',', ':')) + '\n'
    (ROOT / 'miniprogram' / 'data' / 'reading-pack.js').write_text(module, encoding='utf-8', newline='\n')
    demo = ROOT / 'design' / 'reading-pack'
    demo.mkdir(parents=True, exist_ok=True)
    for name in ('book.pdf', 'themes.pdf', 'sample.pdf'):
        shutil.copy2(OUTPUT / name, demo / name)
    bundle_sample()
    print(json.dumps({key: manifest[key] for key in ('contentDate', 'sections', 'items', 'docs', 'files')}, ensure_ascii=False))


if __name__ == '__main__':
    main()
