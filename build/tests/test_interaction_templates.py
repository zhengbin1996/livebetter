import re
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2] / 'miniprogram'


class InteractionTemplates(unittest.TestCase):
    def test_changed_templates_are_balanced(self):
        paths = [
            'pages/index/index.wxml', 'pages/about/index.wxml', 'pages/search/index.wxml',
            'pages/favorites/index.wxml', 'pages/item-detail/index.wxml',
            'subpackages/read/pages/section-detail/index.wxml',
            'components/item-row/index.wxml',
            'pages/section-list/index.wxml', 'subpackages/mine/pages/version/index.wxml',
            'subpackages/mine/pages/glossary/index.wxml', 'subpackages/read/pages/doc-read/index.wxml',
            'pages/reading-pack/index.wxml',
        ]
        for name in paths:
            with self.subTest(template=name):
                source = (ROOT / name).read_text(encoding='utf-8')
                source = re.sub(r'<!--.*?-->', '', source, flags=re.S)
                source = re.sub(r'\{\{.*?\}\}', 'binding', source, flags=re.S)
                source = re.sub(r'\s+(wx:else|show-sec|highlight|scroll-y|detail|light|sm)(?=[\s/>])', r' \1="true"', source)
                ET.fromstring('<root xmlns:wx="urn:wx" xmlns:bind="urn:bind">' + source + '</root>')


if __name__ == '__main__':
    unittest.main()
