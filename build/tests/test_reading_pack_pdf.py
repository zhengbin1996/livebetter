import importlib.util
from pathlib import Path
import unittest

import reportlab
from reportlab.pdfbase.ttfonts import TTFont


SOURCE = Path(__file__).resolve().parents[1] / 'reading_pack.py'


class ReadingPackTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location('reading_pack', SOURCE)
        cls.builder = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.builder)

    def test_content_boundaries_match_current_build(self):
        book = self.builder.read_book()
        counts = book['essentials']['counts']
        # 上游会持续增删条目；核对当前构建清单，不绑定某一天的快照数量。
        for key in ('sections', 'items', 'docs'):
            self.assertGreater(counts[key], 0)
        self.assertEqual(len(book['sections']), counts['sections'])
        self.assertEqual(sum(len(section['items']) for section in book['sections']), counts['items'])
        self.assertEqual(len(book['docs']), counts['docs'])
        self.assertEqual(
            {section['sec']: len(section['items']) for section in book['sections']},
            {section['sec']: section['items'] for section in book['essentials']['sections']},
        )
        self.assertEqual(
            {article['sid'] for article in book['docs']},
            {article['sid'] for article in book['essentials']['docs'] if article.get('kind') == 'doc'},
        )
        self.assertTrue(all(article['kind'] == 'doc' for article in book['docs']))

    def test_html_preserves_text_links_and_tables(self):
        builder = self.builder
        blocks = builder.html_blocks('<p>风险降 45%，仅限前排。<a href="https://example.com">原始研究</a></p>', lambda href: href)
        self.assertIn('风险降 45%，仅限前排。', blocks[0][1])
        self.assertIn('href="https://example.com"', blocks[0][1])
        source = '<p><b>条件</b>与数字 12%。</p><table><tr><td>甲</td><td>乙</td></tr></table>'
        blocks = builder.html_blocks(source, lambda href: None)
        self.assertIn('12%', ''.join(content for _, content in blocks))
        self.assertIn('甲', ''.join(content for _, content in blocks))
        self.assertIn('乙', ''.join(content for _, content in blocks))

    def test_missing_glyphs_use_symbol_font(self):
        builder = self.builder
        # HTML 字体回退使用 ReportLab 自带的固定字体，避免依赖操作系统中文字体。
        font = Path(reportlab.__file__).parent / 'fonts' / 'Vera.ttf'
        builder.pdfmetrics.registerFont(TTFont('Reader', str(font)))
        self.assertEqual(builder.font_text('risk 10%'), 'risk 10%')
        blocks = builder.html_blocks('<p>风险 10⁻⁴，条件仍保留。</p>', lambda href: None)
        self.assertIn('<font name="ReaderSymbols">⁻</font>', blocks[0][1])
        self.assertIn('<font name="ReaderSymbols">⁴</font>', blocks[0][1])


if __name__ == '__main__':
    unittest.main()
