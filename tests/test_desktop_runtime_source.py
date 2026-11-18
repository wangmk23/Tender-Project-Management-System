import unittest
from unittest.mock import Mock, patch
from src.project_manager import desktop_runtime as runtime

class DesktopRuntimeTests(unittest.TestCase):
    def setUp(self):
        for target in ('SourceScheduler',):
            patcher = patch.object(runtime, target)
            self.scheduler = patcher.start().return_value
            self.addCleanup(patcher.stop)
        patcher = patch.object(runtime.host, '_acquire_single_instance', return_value=True)
        patcher.start()
        self.addCleanup(patcher.stop)
        patcher = patch.object(runtime.host, '_release_single_instance')
        self.release = patcher.start()
        self.addCleanup(patcher.stop)

    def test_headless_serves_until_interrupted_and_closes(self):
        app = Mock(config={}, extensions={})
        server = Mock(server_port=23456)
        server.serve_forever.side_effect = KeyboardInterrupt
        with patch.object(runtime, 'make_server', return_value=server):
            self.assertEqual(runtime.run(Mock(return_value=app), ['--headless', '--port', '0', '--data-dir', 'scratch-test']), 0)
        server.serve_forever.assert_called_once()
        server.server_close.assert_called_once()
        self.scheduler.start.assert_called_once()
        self.scheduler.stop.assert_called_once()
        self.assertFalse(app.config['IS_DESKTOP'])
        self.assertEqual(app.config['LAN_URL'], '')

    def test_mutex_names_are_data_scoped(self):
        self.assertNotEqual(runtime.mutex_name('one'), runtime.mutex_name('two'))

    def test_desktop_tray_close_and_exit(self, fail_stop=False):
        import sys
        from types import SimpleNamespace
        class Event:
            def __iadd__(self, callback):
                self.callback = callback
                return self
        window = Mock(events=SimpleNamespace(closing=Event()))
        app = Mock(config={}, extensions={})
        server = Mock(server_port=12345)
        webview = Mock()
        webview.create_window.return_value = window
        tray_module = Mock()
        if fail_stop:
            tray_module.Icon.return_value.stop.side_effect = RuntimeError('tray failure')
        callbacks = {}
        def item(label, callback, **kwargs):
            callbacks[label] = callback
            return label
        tray_module.MenuItem.side_effect = item
        def start():
            self.assertFalse(window.events.closing.callback())
            window.hide.assert_called_once()
            callbacks['退出']()
            self.assertTrue(window.events.closing.callback())
        webview.start.side_effect = start
        with patch.dict(sys.modules, {'webview': webview, 'pystray': tray_module}), \
             patch.object(runtime.host, '_acquire_single_instance', return_value=True), \
             patch.object(runtime.host, '_release_single_instance') as release, \
             patch.object(runtime, 'make_server', return_value=server):
            if fail_stop:
                with self.assertRaisesRegex(RuntimeError, 'tray failure'):
                    runtime.run(Mock(return_value=app), ['--data-dir', 'isolated-gui'])
            else:
                self.assertEqual(runtime.run(Mock(return_value=app), ['--data-dir', 'isolated-gui']), 0)
        server.shutdown.assert_called_once()
        tray_module.Icon.return_value.stop.assert_called_once()
        release.assert_called_once()
        self.assertTrue(app.config['IS_DESKTOP'])
        self.assertIn('desktop_dialogs', app.extensions)

    def test_cleanup_continues_when_scheduler_stop_fails(self):
        app = Mock(config={}, extensions={})
        server = Mock(server_port=12345)
        server.serve_forever.side_effect = KeyboardInterrupt
        self.scheduler.stop.side_effect = RuntimeError('stop failure')
        with patch.object(runtime, 'make_server', return_value=server):
            with self.assertRaises(RuntimeError):
                runtime.run(Mock(return_value=app), ['--headless'])
        server.server_close.assert_called_once()
        self.release.assert_called_once()

    def test_headless_duplicate_does_not_create_factory_or_scheduler(self):
        factory = Mock()
        with patch.object(runtime.host, '_acquire_single_instance', return_value=False):
            self.assertEqual(runtime.run(factory, ['--headless']), 1)
        factory.assert_not_called()
        self.scheduler.start.assert_not_called()
        self.release.assert_not_called()

    def test_tray_failure_still_cleans_server_scheduler_and_mutex(self):
        self.test_desktop_tray_close_and_exit(fail_stop=True)
        self.scheduler.stop.assert_called_once()
