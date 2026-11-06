import tempfile
import threading
import unittest
from pathlib import Path
from src.backend_patches.local_files_index import scan_directory

class IndexTests(unittest.TestCase):
    def test_real_metadata_budget_and_preservation(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t); (root/'sub').mkdir(); f=root/'sub'/'中文.txt'; f.write_bytes(b'original')
            before=f.stat().st_mtime_ns
            entries,scan=scan_directory(root, threading.Event())
            self.assertTrue(scan['complete']); self.assertEqual(scan['files'],1)
            self.assertEqual({e['path'] for e in entries},{'sub','sub/中文.txt'})
            self.assertEqual(f.read_bytes(),b'original'); self.assertEqual(f.stat().st_mtime_ns,before)
            self.assertFalse(scan_directory(root,threading.Event(),max_entries=1)[1]['complete'])
            self.assertFalse(scan_directory(root,threading.Event(),max_depth=0)[1]['complete'])
            self.assertFalse(scan_directory(root,threading.Event(),seconds=0)[1]['complete'])
    def test_real_junction_is_skipped_and_target_untouched(self):
        import os
        import subprocess
        if os.name!='nt': self.skipTest('Windows junction test')
        with tempfile.TemporaryDirectory() as t:
            root=Path(t)/'root'; root.mkdir(); outside=Path(t)/'outside'; outside.mkdir(); (outside/'secret').write_text('private')
            link=root/'junction'
            result=subprocess.run(['cmd','/c','mklink','/J',str(link),str(outside)],capture_output=True)
            self.assertEqual(result.returncode,0)
            try:
                entries,scan=scan_directory(root,threading.Event())
                self.assertEqual(entries,[]); self.assertEqual(scan['skipped_links'],['junction']); self.assertFalse(scan['complete'])
                self.assertEqual((outside/'secret').read_text(),'private')
            finally: os.rmdir(link)
    def test_cancellation_and_depth_limit(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t); p=root
            for i in range(34): p=p/'d'; p.mkdir()
            (p/'deep').write_text('preserve')
            entries,scan=scan_directory(root,threading.Event())
            self.assertFalse(scan['complete']); self.assertTrue(any(e['code']=='DEPTH_LIMIT' for e in scan['errors']))
            cancel=threading.Event(); cancel.set()
            self.assertEqual(scan_directory(root,cancel)[1]['state'],'cancelled')
    def test_real_ten_thousand_file_sample(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t)
            for i in range(10000): (root/f'f{i}.txt').touch()
            entries,scan=scan_directory(root,threading.Event())
            self.assertTrue(scan['complete'],scan); self.assertEqual(len(entries),10000)
    def test_actual_depth_never_exceeds_thirty_two(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t); p=root
            for i in range(34): p=p/'d'; p.mkdir()
            entries,scan=scan_directory(root,threading.Event())
            self.assertLessEqual(max(len(Path(e['path']).parts) for e in entries),32)
    def test_permission_error_is_partial_without_absolute_error_path(self):
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as t:
            root=Path(t); (root/'denied').mkdir(); (root/'ok.txt').write_text('ok')
            import os
            actual=os.scandir
            def access(path):
                if Path(path).name=='denied': raise PermissionError(str(path))
                return actual(path)
            with patch('os.scandir',side_effect=access): entries,scan=scan_directory(root,threading.Event())
            self.assertFalse(scan['complete']); self.assertIn({'path':'denied','code':'UNREADABLE'},scan['errors']); self.assertNotIn(str(root),str(scan))
