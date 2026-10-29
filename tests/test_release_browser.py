import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

from tools.release_browser import launch_browser, require_windows_candidate


class ReleaseBrowserTests(unittest.TestCase):
    def test_explicit_missing_browser_fails_without_silent_fallback(self):
        pw = Mock()
        with self.assertRaisesRegex(RuntimeError, 'browser executable'):
            launch_browser(pw, 'missing-browser.exe')
        pw.chromium.launch.assert_not_called()

    def test_environment_override_is_used(self):
        with tempfile.TemporaryDirectory() as directory:
            browser = Path(directory) / 'browser.exe'
            browser.touch()
            pw = Mock()
            pw.chromium.launch.return_value.version = 'test-version'
            with patch.dict(os.environ, {'PM_BROWSER_EXECUTABLE': str(browser)}):
                _, metadata = launch_browser(pw)
            self.assertEqual(metadata['source'], 'environment')
            self.assertEqual(pw.chromium.launch.call_args.kwargs['executable_path'], str(browser.resolve()))

    def test_linux_cannot_report_windows_exe_acceptance(self):
        with patch('tools.release_browser.sys.platform', 'linux'):
            with self.assertRaisesRegex(RuntimeError, 'Windows EXE'):
                require_windows_candidate(Path('candidate.exe'), '0' * 64)


if __name__ == '__main__':
    unittest.main()
