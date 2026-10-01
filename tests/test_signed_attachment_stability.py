"""Regression coverage for attachment signing under hostile input and concurrency."""
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

from src.backend_patches import signed_attachments as subject


class KeyInitializationTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.protect = patch.object(subject, "_PROTECT_SECRET", lambda raw: b"protected:" + raw)
        self.unprotect = patch.object(subject, "_UNPROTECT_SECRET", lambda raw: raw.removeprefix(b"protected:"))
        self.protect.start()
        self.unprotect.start()
        self.addCleanup(self.protect.stop)
        self.addCleanup(self.unprotect.stop)

    def test_overlapping_first_requests_return_the_same_persisted_key(self):
        first_writing = threading.Event()
        release_first = threading.Event()
        real_fsync = subject.os.fsync
        outcomes = {}

        def fsync(descriptor):
            real_fsync(descriptor)
            if threading.current_thread().name == "first-key-request":
                first_writing.set()
                if not release_first.wait(5):
                    raise TimeoutError("test did not release first writer")

        def initialize(label):
            try:
                outcomes[label] = subject.get_or_create_secret(self.root)
            except Exception as error:
                outcomes[label] = error

        with patch.object(subject.os, "fsync", fsync):
            first = threading.Thread(target=initialize, args=("first",), name="first-key-request")
            second = threading.Thread(target=initialize, args=("second",))
            first.start()
            try:
                self.assertTrue(first_writing.wait(5))
                second.start()
                second.join(5)
            finally:
                release_first.set()
                first.join(5)
                if second.ident is not None:
                    second.join(5)
        self.assertFalse(first.is_alive())
        self.assertFalse(second.is_alive())
        self.assertIsInstance(outcomes["first"], bytes)
        self.assertIsInstance(outcomes["second"], bytes)
        self.assertEqual(outcomes["first"], outcomes["second"])
        self.assertEqual(subject.get_or_create_secret(self.root), outcomes["first"])
        self.assertEqual(sorted(p.name for p in self.root.iterdir()), [subject._KEY_FILENAME])

    def test_abandoned_legacy_temporary_file_does_not_break_initialization(self):
        stale = self.root / (subject._KEY_FILENAME + ".tmp")
        stale.write_bytes(b"previous-writer-owned-content")
        try:
            result = subject.get_or_create_secret(self.root)
        except Exception as error:
            self.fail(f"unrelated temporary file blocked initialization: {type(error).__name__}")
        self.assertEqual(len(result), 32)
        self.assertEqual(stale.read_bytes(), b"previous-writer-owned-content")

    def test_corrupted_existing_key_is_not_silently_replaced(self):
        key = self.root / subject._KEY_FILENAME
        key.write_bytes(b"protected:broken")
        with self.assertRaises(ValueError):
            subject.get_or_create_secret(self.root)
        self.assertEqual(key.read_bytes(), b"protected:broken")


class InvalidSignatureLimitTests(unittest.TestCase):
    def setUp(self):
        subject._INVALID_ATTEMPTS.clear()
        self.addCleanup(subject._INVALID_ATTEMPTS.clear)

    def test_rejected_requests_do_not_grow_a_bucket(self):
        for _ in range(10000):
            subject._invalid_request_is_throttled("client", 1000)
        self.assertLessEqual(len(subject._INVALID_ATTEMPTS["client"]), subject._INVALID_LIMIT)

    def test_expired_inactive_clients_are_reclaimed(self):
        for index in range(1000):
            subject._invalid_request_is_throttled(f"client-{index}", 1000)
        self.assertFalse(subject._invalid_request_is_throttled("new-client", 1061))
        self.assertEqual(len(subject._INVALID_ATTEMPTS), 1)
        self.assertIn("new-client", subject._INVALID_ATTEMPTS)

    def test_global_capacity_is_bounded_without_evicting_live_clients(self):
        for index in range(1500):
            subject._invalid_request_is_throttled(f"client-{index}", 1000)
        self.assertLessEqual(len(subject._INVALID_ATTEMPTS), 1024)
        self.assertIn("client-0", subject._INVALID_ATTEMPTS)
        self.assertTrue(subject._invalid_request_is_throttled("overflow", 1000))
        self.assertFalse(subject._invalid_request_is_throttled("overflow", 1061))

    def test_sliding_window_recovers_when_oldest_allowed_attempt_expires(self):
        for now in (1000, 1010, 1020):
            self.assertFalse(subject._invalid_request_is_throttled("client", now))
        self.assertTrue(subject._invalid_request_is_throttled("client", 1059))
        self.assertFalse(subject._invalid_request_is_throttled("client", 1060))
        self.assertTrue(subject._invalid_request_is_throttled("client", 1061))

    def test_simultaneous_requests_allow_only_three(self):
        with ThreadPoolExecutor(max_workers=12) as executor:
            values = list(executor.map(lambda _: subject._invalid_request_is_throttled("client", 1000), range(100)))
        self.assertEqual(values.count(False), 3)
        self.assertLessEqual(len(subject._INVALID_ATTEMPTS["client"]), 3)


if __name__ == "__main__":
    unittest.main()
