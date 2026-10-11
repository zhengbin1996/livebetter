import importlib.util
from pathlib import Path
import unittest


SOURCE = Path(__file__).resolve().parents[1] / 'reading_pack.py'


class ReadingPackTests(unittest.TestCase):
    def test_builder_and_content_boundaries(self):
        self.assertTrue(SOURCE.exists(), '需要提供阅读包构建器')
        spec = importlib.util.spec_from_file_location('reading_pack', SOURCE)
        builder = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(builder)
        book = builder.read_book()
        self.assertEqual(len(book['sections']), 34)
        self.assertEqual(sum(len(section['items']) for section in book['sections']), 676)
        self.assertEqual(len(book['docs']), 9)
        self.assertTrue(all(article['kind'] == 'doc' for article in book['docs']))
        blocks = builder.html_blocks('<p>风险降 45%，仅限前排。<a href="https://example.com">原始研究</a></p>', lambda href: href)
        self.assertIn('风险降 45%，仅限前排。', blocks[0][1])
        self.assertIn('href="https://example.com"', blocks[0][1])
        source = '<p><b>条件</b>与数字 12%。</p><table><tr><td>甲</td><td>乙</td></tr></table>'
        blocks = builder.html_blocks(source, lambda href: None)
        self.assertIn('12%', ''.join(content for _, content in blocks))
        self.assertIn('甲', ''.join(content for _, content in blocks))
        self.assertIn('乙', ''.join(content for _, content in blocks))
        builder.register_fonts()
        blocks = builder.html_blocks('<p>风险 10⁻⁴，条件仍保留。</p>', lambda href: None)
        self.assertIn('ReaderSymbols', blocks[0][1])
        self.assertIn('⁻', blocks[0][1])


if __name__ == '__main__':
    unittest.main()
