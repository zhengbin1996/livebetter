import json
import sys
from pathlib import Path

from common import BOOK_DIR, BUNDLE_DATA, DIST, make_sid, strip_md
from parse import parse_book_file


def prepare():
    source = (BUNDLE_DATA / 'essentials.js').read_text(encoding='utf-8')
    essentials = json.loads(source.split('module.exports = ', 1)[1])
    picks = {item['sid'] for item in essentials['picks']}
    summaries = {}
    all_summaries = {}
    for filename in sorted(BOOK_DIR.glob('*.md')):
        section = parse_book_file(filename)
        for item in section['items']:
            sid = make_sid(section['sec'], item['title'])
            summary = strip_md(item['fields'].get('说人话', ''))
            all_summaries[sid] = summary
            if sid in picks:
                summaries[sid] = summary
    if summaries.keys() != picks:
        raise ValueError('内置推荐与指定版本原文不一致')
    items = []
    sections = []
    for entry in essentials['sections']:
        section = json.loads((DIST / 'book' / f"{entry['sec']:02d}.json").read_text(encoding='utf-8'))
        sections.append({**entry, 'intro': section.get('intro', []), 'guideGroups': section.get('groups', [])})
        items.extend({**item, 'sec': section['sec'], 'summary': all_summaries[item['sid']], 'summaryFull': True} for item in section['items'])
    docs = [json.loads((DIST / 'docs' / (entry['sid'] + '.json')).read_text(encoding='utf-8')) for entry in essentials['docs'] if entry['kind'] == 'doc']
    return {'summaries': {'version': essentials['meta']['version'], 'items': summaries}, 'demo': {'items': items, 'docs': docs, 'sections': sections, 'problems': essentials['problems'], 'problemGroups': essentials['problemGroups'], 'glossary': essentials['glossary'], 'legend': essentials['legend'], 'meta': essentials['meta']}}


if __name__ == '__main__':
    result = prepare()
    if '--write-demo' in sys.argv:
        destination = Path(__file__).resolve().parents[1] / 'design' / 'interaction-data.js'
        destination.write_text('window.interactionData = ' + json.dumps(result['demo'], ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
        print(f"Generated demo: {len(result['demo']['items'])} items, {len(result['demo']['docs'])} documents")
    else:
        print(json.dumps(result, ensure_ascii=False, separators=(',', ':')))
