"""Native Tk styling checks; no device probe, key file, or visible window."""
import tkinter as tk
from tkinter import ttk
from pathlib import Path
import sys
import unittest
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "authorization"))
import license_theme as theme
from license_layout import Card


class ThemeTests(unittest.TestCase):
    def setUp(self):
        self.root = tk.Tk()
        self.root.withdraw()
        self.addCleanup(self.root.destroy)
        self.style = theme.apply(self.root)

    def test_native_bevels_stay_dark_in_all_control_states(self):
        for name in ('TButton', 'Primary.TButton', 'Nav.TButton', 'NavActive.TButton',
                     'Mode.TButton', 'ModeActive.TButton', 'TEntry', 'TCombobox',
                     'Vertical.TScrollbar'):
            for state in ((), ('active',), ('pressed',), ('focus',),
                          ('disabled',), ('readonly',), ('readonly', 'focus')):
                for option in ('lightcolor', 'darkcolor', 'bordercolor', 'background'):
                    with self.subTest(style=name, state=state, option=option):
                        rgb = self.root.winfo_rgb(self.style.lookup(name, option, state))
                        luminance = rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722
                        self.assertLess(luminance, 46000, 'native clam light bevel leaked')

    def test_rounded_card_body_leaves_corners_exposed(self):
        card = Card(self.root)
        card._size(SimpleNamespace(width=500, height=200))
        x, y = card.coords(card.window)
        self.assertGreaterEqual(x, 10)
        self.assertGreaterEqual(y, 10)
        self.assertLessEqual(float(card.itemcget(card.window, 'width')), 480)

    def test_entry_and_combobox_keep_native_text_and_state_behavior(self):
        value = tk.StringVar(value='before')
        entry = ttk.Entry(self.root, textvariable=value)
        entry.delete(0, 'end')
        entry.insert(0, 'after')
        self.assertEqual(value.get(), 'after')
        combo = ttk.Combobox(self.root, values=('local', 'remote'), state='readonly')
        combo.current(1)
        self.assertEqual(combo.get(), 'remote')
        self.assertTrue(combo.instate(['readonly']))


if __name__ == '__main__':
    unittest.main()
