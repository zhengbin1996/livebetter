import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
font_paths = [
    Path(os.environ.get('WINDIR', 'C:/Windows')) / 'Fonts/msyh.ttc',
    Path('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'),
]
font_path = next((path for path in font_paths if path.exists()), None)
if font_path is None:
    raise SystemExit('生成分享封面需要微软雅黑或 Noto Sans CJK 字体')

image = Image.new('RGB', (1000, 800), '#FAF9F5')
draw = ImageDraw.Draw(image)
draw.rectangle((0, 0, 1000, 12), fill='#25251F')
draw.text((64, 56), '高性价比人生指南', font=ImageFont.truetype(str(font_path), 32), fill='#55554D')
draw.rectangle((730, 48, 936, 110), fill='#FBE7D8')
draw.text((760, 60), '原文阅读', font=ImageFont.truetype(str(font_path), 28), fill='#B3440C')
draw.text((60, 156), '高性价比', font=ImageFont.truetype(str(font_path), 92), fill='#25251F', stroke_width=1)
draw.text((60, 276), '人生指南', font=ImageFont.truetype(str(font_path), 92), fill='#25251F', stroke_width=1)
draw.rectangle((64, 430, 936, 672), fill='#EDEDE7')
draw.rectangle((64, 430, 70, 672), fill='#B3440C')
draw.text((96, 456), '从需要的内容开始', font=ImageFont.truetype(str(font_path), 28), fill='#B3440C')
draw.text((96, 516), '看标题与原文摘要', font=ImageFont.truetype(str(font_path), 42), fill='#55554D')
draw.text((96, 582), '按需读全文，收藏以后再读', font=ImageFont.truetype(str(font_path), 42), fill='#55554D')
draw.text((64, 720), '生活建议，请结合自身情况阅读原文', font=ImageFont.truetype(str(font_path), 28), fill='#6C6C61')
draw.text((764, 718), '打开阅读 →', font=ImageFont.truetype(str(font_path), 30), fill='#B3440C')

for destination in [ROOT / 'miniprogram/assets/share-cover.png', ROOT / 'design/share-cover.png']:
    destination.parent.mkdir(parents=True, exist_ok=True)
    image.save(destination, optimize=True)
print('Generated share cover: 1000 × 800')
