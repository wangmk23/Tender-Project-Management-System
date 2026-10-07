"""Original colorful desktop glyphs, rendered without external image dependencies.

Soft cyan, amber, mint and violet accents match the system's dark theme.
The application logo remains the existing ICO asset.
"""
import base64
import math
import struct
import zlib
from tkinter import PhotoImage

BLUE = '#70c4ff'
CYAN = '#80e1dc'
GOLD = '#ffcd77'
VIOLET = '#c3abff'
WHITE = '#edf5ff'


def _rect(x, y, w, h, color, radius=1.5):
    def inside(px, py):
        dx = max(x + radius - px, 0, px - (x + w - radius))
        dy = max(y + radius - py, 0, py - (y + h - radius))
        return x <= px <= x + w and y <= py <= y + h and dx * dx + dy * dy <= radius * radius
    return inside, color


def _circle(x, y, radius, color):
    return lambda px, py: (px - x) ** 2 + (py - y) ** 2 <= radius ** 2, color


def _polygon(points, color):
    def inside(px, py):
        result = False
        previous = points[-1]
        for current in points:
            ax, ay = previous
            bx, by = current
            if (ay > py) != (by > py) and px < (bx - ax) * (py - ay) / (by - ay) + ax:
                result = not result
            previous = current
        return result
    return inside, color


def _line(ax, ay, bx, by, color, width=1.6):
    def inside(px, py):
        length = (bx - ax) ** 2 + (by - ay) ** 2
        t = max(0, min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / length)) if length else 0
        return math.hypot(px - ax - t * (bx - ax), py - ay - t * (by - ay)) <= width / 2
    return inside, color


def _shapes(name):
    if name == 'shield':
        return [_polygon([(10, 1.5), (17, 4.5), (16, 12), (10, 18.5), (4, 12), (3, 4.5)], BLUE),
                _polygon([(10, 4), (14, 6), (13.5, 11), (10, 15.5), (6.5, 11), (6, 6)], CYAN),
                _line(7, 9.8, 9.2, 12, WHITE), _line(9.2, 12, 13, 7.8, WHITE)]
    if name == 'key':
        return [_circle(6, 6.5, 4, GOLD), _line(8.5, 9, 16, 16.5, GOLD, 3),
                _line(12.5, 13, 14.5, 11, GOLD, 2.5), _circle(5.5, 6, 1.4, '#765b2d')]
    if name == 'lock':
        return [_rect(5, 2, 10, 12, VIOLET, 5), _rect(7, 4, 6, 9, '#172033', 3),
                _rect(3.5, 8, 13, 10, BLUE, 2.5), _circle(10, 12, 1.5, WHITE),
                _line(10, 13, 10, 15, WHITE, 1.6)]
    if name == 'copy':
        return [_rect(3, 2, 10, 12, VIOLET, 2), _rect(6, 5, 11, 13, BLUE, 2),
                _line(9, 9, 14, 9, WHITE), _line(9, 12, 14, 12, WHITE)]
    if name == 'export':
        return [_rect(3, 3, 11, 15, BLUE, 2), _line(6, 7, 10, 7, WHITE),
                _line(9, 12, 17, 12, CYAN, 2), _line(14, 9, 17, 12, CYAN, 2),
                _line(14, 15, 17, 12, CYAN, 2)]
    if name == 'folder':
        return [_rect(2, 4, 8, 6, GOLD, 2), _rect(2, 7, 16, 11, GOLD, 2),
                _rect(3, 9, 14, 7.5, '#ffe0a3', 1.5)]
    if name == 'device':
        return [_rect(1.5, 2.5, 17, 12, BLUE, 2), _rect(3.5, 4.5, 13, 8, '#254971', 1),
                _line(10, 14, 10, 17, BLUE, 2), _line(6, 17, 14, 17, BLUE, 2),
                _circle(13, 7.5, 2, CYAN)]
    if name == 'remote':
        return [_line(5, 6, 15, 6, VIOLET, 2), _line(5, 6, 10, 15, VIOLET, 2),
                _line(15, 6, 10, 15, VIOLET, 2), _circle(5, 6, 3.5, BLUE),
                _circle(15, 6, 3.5, CYAN), _circle(10, 15, 3.5, GOLD)]
    raise ValueError(f'Unknown issuer icon: {name}')


def _png(name, size=20):
    shapes = [(test, bytes.fromhex(color[1:])) for test, color in _shapes(name)]
    pixels = bytearray()
    # Four samples per pixel keep the rounded contours clear at desktop scale.
    for y in range(size):
        pixels.append(0)
        for x in range(size):
            samples = []
            for dy, dx in ((.25, .25), (.25, .75), (.75, .25), (.75, .75)):
                color = None
                for test, fill in shapes:
                    if test((x + dx) * 20 / size, (y + dy) * 20 / size):
                        color = fill
                if color is not None:
                    samples.append(color)
            if samples:
                pixels.extend(sum(color[i] for color in samples) // len(samples) for i in range(3))
                pixels.append(round(255 * len(samples) / 4))
            else:
                pixels.extend(b'\0\0\0\0')

    def chunk(kind, data):
        return struct.pack('!I', len(data)) + kind + data + struct.pack('!I', zlib.crc32(kind + data) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!2I5B', size, size, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(bytes(pixels))) + chunk(b'IEND', b''))


def load(master):
    """Return owned Tk images; retain this mapping for the window lifetime."""
    return {name: PhotoImage(master=master, data=base64.b64encode(_png(name)), format='png')
            for name in ('shield', 'key', 'lock', 'copy', 'export', 'folder', 'device', 'remote')}
