from pathlib import Path
from xml.sax.saxutils import escape

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'design' / 'branding'
SCALE = 2
CREAM = '#F5F1E7'
ORANGE = '#B64C2C'
INK = '#282923'


class Artwork:
    def __init__(self, background):
        self.image = Image.new('RGB', (1024 * SCALE, 1024 * SCALE), background)
        self.draw = ImageDraw.Draw(self.image)
        self.elements = [f'<rect width="1024" height="1024" fill="{background}"/>']

    def rect(self, box, fill, radius=0):
        self.draw.rounded_rectangle(tuple(value * SCALE for value in box), radius=radius * SCALE, fill=fill)
        left, top, right, bottom = box
        self.elements.append(f'<rect x="{left}" y="{top}" width="{right-left}" height="{bottom-top}" rx="{radius}" fill="{fill}"/>')

    def polygon(self, points, fill):
        self.draw.polygon([(horizontal * SCALE, vertical * SCALE) for horizontal, vertical in points], fill=fill)
        coordinates = ' '.join(f'{horizontal},{vertical}' for horizontal, vertical in points)
        self.elements.append(f'<polygon points="{coordinates}" fill="{fill}"/>')

    def line(self, points, fill, width):
        self.draw.line([(horizontal * SCALE, vertical * SCALE) for horizontal, vertical in points], fill=fill, width=width * SCALE, joint='curve')
        for horizontal, vertical in (points[0], points[-1]):
            half = width * SCALE / 2
            self.draw.ellipse((horizontal * SCALE-half, vertical * SCALE-half, horizontal * SCALE+half, vertical * SCALE+half), fill=fill)
        coordinates = ' '.join(f'{horizontal},{vertical}' for horizontal, vertical in points)
        self.elements.append(f'<polyline points="{coordinates}" fill="none" stroke="{fill}" stroke-width="{width}" stroke-linecap="round" stroke-linejoin="round"/>')

    def circle(self, center, radius, fill):
        horizontal, vertical = center
        self.draw.ellipse(tuple(value * SCALE for value in (horizontal-radius, vertical-radius, horizontal+radius, vertical+radius)), fill=fill)
        self.elements.append(f'<circle cx="{horizontal}" cy="{vertical}" r="{radius}" fill="{fill}"/>')

    def glyph(self, text, center, size, fill):
        font = ImageFont.truetype('C:/Windows/Fonts/msyhbd.ttc', size * SCALE)
        self.draw.text(tuple(value * SCALE for value in center), text, font=font, fill=fill, anchor='mm')
        horizontal, vertical = center
        self.elements.append(f'<text x="{horizontal}" y="{vertical}" text-anchor="middle" dominant-baseline="central" font-family="Microsoft YaHei" font-weight="700" font-size="{size}" fill="{fill}">{escape(text)}</text>')

    def save(self, filename):
        image = self.image.resize((1024, 1024), Image.Resampling.LANCZOS)
        image.save(OUTPUT / f'{filename}.png', optimize=True)
        image.resize((256, 256), Image.Resampling.LANCZOS).save(OUTPUT / f'{filename}-256.png', optimize=True)
        svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">' + ''.join(self.elements) + '</svg>'
        (OUTPUT / f'{filename}.svg').write_text(svg, encoding='utf-8')


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    reference = Artwork(CREAM)
    reference.rect((280, 214, 744, 794), ORANGE, 38)
    reference.rect((280, 214, 340, 794), INK, 26)
    reference.rect((324, 214, 354, 794), INK)
    reference.rect((354, 714, 712, 760), CREAM, 10)
    reference.polygon([(578, 214), (658, 214), (658, 397), (618, 366), (578, 397)], CREAM)
    reference.line([(404, 488), (648, 488)], CREAM, 32)
    reference.line([(404, 564), (565, 564)], CREAM, 32)
    reference.save('a-life-reference')

    everyday = Artwork(ORANGE)
    everyday.circle((512, 302), 70, CREAM)
    everyday.polygon([(246, 408), (368, 394), (449, 410), (499, 446), (499, 744), (431, 709), (346, 694), (246, 706)], CREAM)
    everyday.polygon([(778, 408), (656, 394), (575, 410), (525, 446), (525, 744), (593, 709), (678, 694), (778, 706)], CREAM)
    everyday.line([(302, 500), (369, 492), (433, 514)], ORANGE, 20)
    everyday.line([(302, 568), (369, 560), (433, 582)], ORANGE, 20)
    everyday.line([(591, 514), (655, 492), (722, 500)], ORANGE, 20)
    everyday.line([(591, 582), (655, 560), (722, 568)], ORANGE, 20)
    everyday.save('b-clear-living')

    original = Artwork(INK)
    original.glyph('读', (492, 491), 536, CREAM)
    original.rect((678, 236, 766, 360), ORANGE, 6)
    original.polygon([(678, 358), (722, 323), (766, 358)], INK)
    original.save('c-original-guide')
    print(f'Created 3 avatar directions (1024px, 256px and SVG) in {OUTPUT}')


if __name__ == '__main__':
    main()
