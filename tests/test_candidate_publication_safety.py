import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import tools.build_candidate as builder


class CandidatePublicationSafetyTests(unittest.TestCase):
    def build(self, root, source=None, destination=None, report=None, replace=None):
        source = source or root / 'source.exe'
        destination = destination or root / 'candidate.exe'
        report = report or root / 'report.json'
        def unpublished(candidate, integrity, **kwargs):
            candidate.write_bytes(b'new candidate')
            data = {'candidate_sha256': 'test'}
            integrity.write_text(json.dumps(data), encoding='utf-8')
            return data
        with patch.object(builder, 'resolve_source_executable', return_value=source), patch.object(builder, '_build_candidate_unpublished', side_effect=unpublished), patch.object(builder, 'verify_windows_icon'):
            if replace:
                with patch.object(builder, '_replace_with_retry', side_effect=replace):
                    return builder.build_candidate(destination, report, source=source, expected_source_sha256='0'*64)
            return builder.build_candidate(destination, report, source=source, expected_source_sha256='0'*64)

    def test_rejects_all_colliding_paths_before_mutation(self):
        for pair in ['source_destination', 'source_report', 'destination_report', 'alias']:
            with self.subTest(pair=pair), tempfile.TemporaryDirectory() as temp:
                root=Path(temp);source=root/'source.exe';source.write_bytes(b'original')
                dest=root/'candidate.exe';report=root/'report.json'
                if pair=='source_destination': dest=source
                if pair=='source_report': report=source
                if pair=='destination_report': report=dest
                if pair=='alias':
                    dest=root/'hardlink.exe';os.link(source,dest)
                with self.assertRaises(ValueError): self.build(root,source,dest,report)
                self.assertEqual(source.read_bytes(),b'original')

    def test_report_publish_failure_restores_both_previous_files(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);dest=root/'candidate.exe';report=root/'report.json'
            dest.write_bytes(b'previous exe');report.write_bytes(b'previous report')
            calls=0
            def replace(src,target):
                nonlocal calls
                calls+=1
                if calls==2: raise OSError('report publication failed')
                os.replace(src,target)
            with self.assertRaises(OSError): self.build(root,replace=replace)
            self.assertEqual(dest.read_bytes(),b'previous exe')
            self.assertEqual(report.read_bytes(),b'previous report')

    def test_failure_removes_new_exe_if_no_previous_pair(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);calls=0
            def replace(src,target):
                nonlocal calls
                calls+=1
                if calls==2: raise OSError('report failed')
                os.replace(src,target)
            with self.assertRaises(OSError):self.build(root,replace=replace)
            self.assertFalse((root/'candidate.exe').exists())
            self.assertFalse((root/'report.json').exists())

    def test_rollback_failure_keeps_recovery_backup_and_reports_it(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);dest=root/'candidate.exe';report=root/'report.json'
            dest.write_bytes(b'previous exe');report.write_bytes(b'previous report')
            calls=0
            def replace(src,target):
                nonlocal calls
                calls+=1
                if calls in (2,3):raise OSError('locked during publication and rollback')
                os.replace(src,target)
            with self.assertRaisesRegex(RuntimeError,'backups retained'):self.build(root,replace=replace)
            self.assertIn(b'previous exe',[p.read_bytes() for p in root.glob('.previous-*')])
            self.assertEqual(report.read_bytes(),b'previous report')

    def test_success_publishes_verified_pair(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);data=self.build(root)
            self.assertEqual((root/'candidate.exe').read_bytes(),b'new candidate')
            self.assertEqual(json.loads((root/'report.json').read_text()),data)
