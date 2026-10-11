import json
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2] / "miniprogram"


def theme_tokens(source, selector):
    blocks = re.findall(re.escape(selector) + r"\s*\{([^}]+)\}", source)
    themes = [dict(re.findall(r"(--[\w-]+)\s*:\s*(#[0-9A-Fa-f]{6})", block)) for block in blocks]
    return themes[0], {**themes[0], **themes[1]}


def luminance(color):
    channels = [int(color[index:index + 2], 16) / 255 for index in (1, 3, 5)]
    linear = [channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4 for channel in channels]
    return sum(channel * weight for channel, weight in zip(linear, (0.2126, 0.7152, 0.0722)))


def contrast(foreground, background):
    values = sorted((luminance(foreground), luminance(background)))
    return (values[1] + 0.05) / (values[0] + 0.05)


class ThemeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.themes = theme_tokens((ROOT / "app.wxss").read_text(encoding="utf-8"), "page")

    def assert_readable(self, foreground, background):
        self.assertGreaterEqual(contrast(foreground, background), 4.5, f"{foreground} on {background} is unreadable")

    def test_normal_text_on_reading_surfaces(self):
        for theme in self.themes:
            for background in ("--paper", "--card"):
                for foreground in ("--ink", "--ink2", "--ink3"):
                    with self.subTest(background=background, foreground=foreground):
                        self.assert_readable(theme[foreground], theme[background])

    def test_actions_and_semantic_badges(self):
        for theme in self.themes:
            for foreground, background in (
                ("--accent", "--card"), ("--accent", "--accent-bg"),
                ("--on-highlight", "--highlight"), ("--on-action", "--action"),
                ("--on-green", "--green"), ("--on-amber", "--amber"),
                ("--green", "--green-bg"), ("--amber", "--amber-bg"),
                ("--gray", "--gray-bg"), ("--red", "--red-bg"),
            ):
                with self.subTest(foreground=foreground, background=background):
                    self.assertIn(foreground, theme)
                    self.assertIn(background, theme)
                    self.assert_readable(theme[foreground], theme[background])

    def test_system_navigation_matches_page_and_custom_tabbar(self):
        system = json.loads((ROOT / "theme.json").read_text(encoding="utf-8"))
        tabbar = theme_tokens((ROOT / "custom-tab-bar/index.wxss").read_text(encoding="utf-8"), ".tabbar")
        for index, name in enumerate(("light", "dark")):
            page, tabs = self.themes[index], tabbar[index]
            with self.subTest(theme=name):
                self.assertEqual(system[name]["navBgColor"].lower(), page["--paper"].lower())
                self.assertEqual(system[name]["tabBgColor"].lower(), page["--card"].lower())
                self.assertEqual(system[name]["tabSelectedColor"].lower(), page["--accent"].lower())
                for token in ("--line", "--ink3", "--accent", "--card", "--highlight", "--on-highlight"):
                    self.assertEqual(tabs[token].lower(), page[token].lower())


if __name__ == "__main__":
    unittest.main()
