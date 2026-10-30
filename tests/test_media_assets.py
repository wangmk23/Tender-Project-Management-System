import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from tools import media_assets


class MediaAssetTests(unittest.TestCase):
    def test_official_player_is_complete_and_offline(self):
        assets = media_assets.player_assets()
        for name in ('video.js', 'audio.js', 'i18n.js', 'locales/zh-CN.js', 'media/hlsjs-video.js', 'LICENSE'):
            self.assertIn('static\\libs\\videojs\\10.2.0\\' + name.replace('/', '\\'), assets)
        self.assertEqual(len(assets), 1669)
        approved = media_assets.media_asset_hashes()
        self.assertEqual(set(approved), set(media_assets.media_assets()))
        for name, path in assets.items():
            self.assertEqual(approved[name], hashlib.sha256(path.read_bytes()).hexdigest())

    def test_changed_missing_extra_and_unapproved_manifest_fail_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); payload = root / 'player.js'; payload.write_bytes(b'approved')
            manifest = root / 'PROVENANCE.json'
            manifest.write_text(json.dumps({'files': {'player.js': hashlib.sha256(payload.read_bytes()).hexdigest()}}))
            pin = hashlib.sha256(manifest.read_bytes()).hexdigest()
            self.assertEqual(set(media_assets.pinned_tree(root, 'PROVENANCE.json', pin)), {'player.js', 'PROVENANCE.json'})
            for change in ('bytes', 'missing', 'extra', 'manifest'):
                with self.subTest(change=change):
                    payload.write_bytes(b'approved')
                    if change == 'bytes': payload.write_bytes(b'changed')
                    if change == 'missing': payload.unlink()
                    if change == 'extra': (root / 'injected.js').write_bytes(b'injected')
                    if change == 'manifest': manifest.write_text('{}')
                    with self.assertRaises(ValueError): media_assets.pinned_tree(root, 'PROVENANCE.json', pin)
                    (root / 'injected.js').unlink(missing_ok=True)


if __name__ == '__main__':
    unittest.main()
