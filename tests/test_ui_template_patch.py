import unittest

from tools.ui_template_patch import (
    patch_login_template,
    patch_workspace_template,
    prepare_release_templates,
)


class UiTemplatePatchTests(unittest.TestCase):
    def test_workspace_hides_only_the_sidebar_version(self):
        html = (
            '<title>项目管理系统 v5.8.11</title>'
            '<div class="logo">项目管理系统 '
            '<span style="font-size:10px;opacity:0.5">v5.8.11</span></div>'
        )

        patched = patch_workspace_template(html)

        self.assertIn('<title>项目管理系统</title>', patched)
        self.assertNotIn('opacity:0.5', patched)
        self.assertNotIn('>v5.8.11</span>', patched)

    def test_login_reads_and_whitelists_the_saved_theme(self):
        html = '<head><style>body { background:#f6f8fb; }</style></head><body></body>'

        patched = patch_login_template(html)

        self.assertIn("localStorage.getItem('pm_theme')", patched)
        self.assertIn("['default', 'blue', 'green', 'dark']", patched)
        self.assertIn('document.documentElement.dataset.theme = theme', patched)
        self.assertIn(':root[data-theme="dark"]', patched)
        self.assertIn(':root[data-theme="green"]', patched)
        self.assertIn(':root[data-theme="blue"]', patched)
        self.assertIn('background:var(--login-page-bg)', patched)

        real_login = '<head><style>.form-group input {\n  background:#fff;\n  color:#0f172a;\n}</style></head>'
        self.assertIn('background:var(--login-field-bg)', patch_login_template(real_login))

    def test_login_patch_is_idempotent(self):
        html = '<head><style>body { background:#f6f8fb; }</style></head><body></body>'
        once = patch_login_template(html)
        self.assertEqual(patch_login_template(once), once)

    def test_release_templates_unify_version_and_bump_asset_cache(self):
        workspace = (
            '<title>项目管理系统 v5.8.11</title>'
            '<link rel="stylesheet" href="/static/style.css?v=20">'
            '<script src="/static/app.js?v=68"></script>'
            '<div class="logo">项目管理系统 '
            '<span style="opacity:.5">v5.8.11</span></div>'
        )
        login = '<head><title>项目管理系统 v5.8.11 - 登录</title><style>body { background:#f6f8fb; }</style></head>'

        patched_workspace, patched_login = prepare_release_templates(
            workspace,
            login,
            release_version='v5.8.12',
        )

        self.assertIn('<title>项目管理系统</title>', patched_workspace)
        self.assertIn('/static/style.css?v=21', patched_workspace)
        self.assertIn('/static/app.js?v=69', patched_workspace)
        self.assertNotIn('<span style="opacity:.5">', patched_workspace)
        self.assertIn('<title>项目管理系统 - 登录</title>', patched_login)
        self.assertIn('login-theme-bootstrap', patched_login)

    def test_release_template_cache_bump_is_deterministic(self):
        workspace = '<link href="/static/style.css?v=20"><script src="/static/app.js?v=68"></script>'
        first, _ = prepare_release_templates(workspace, '<style></style>', 'v5.8.12')
        second, _ = prepare_release_templates(workspace, '<style></style>', 'v5.8.12')
        self.assertEqual(first, second)


if __name__ == '__main__':
    unittest.main()
