"""Deterministic HTML transforms for the login/theme and sidebar shell fixes."""
from __future__ import annotations

import re


THEME_MARKER = "login-theme-bootstrap"

THEME_BOOTSTRAP = f"""<script id=\"{THEME_MARKER}\">
(() => {{
  const allowedThemes = ['default', 'blue', 'green', 'dark'];
  let theme = 'default';
  try {{
    const savedTheme = localStorage.getItem('pm_theme');
    if (allowedThemes.includes(savedTheme)) theme = savedTheme;
  }} catch (_) {{}}
  document.documentElement.dataset.theme = theme;
}})();
</script>
"""

THEME_TOKENS = """
:root {
  color-scheme:light;
  --login-page-bg:#f6f8fb; --login-card-bg:#fff; --login-text:rgba(15,23,42,.9);
  --login-muted:#64748b; --login-label:#475569; --login-field-bg:#fff;
  --login-field-text:#0f172a; --login-field-border:rgba(15,23,42,.14);
  --login-placeholder:#a8b1c1; --login-primary:#2563eb; --login-primary-hover:#1d4ed8;
  --login-focus:rgba(37,99,235,.12); --login-card-border:rgba(15,23,42,.08);
  --login-shadow:0 18px 45px rgba(15,23,42,.08),0 2px 8px rgba(15,23,42,.04);
}
:root[data-theme="blue"] { --login-page-bg:#eef5ff; --login-primary:#1677ff; --login-primary-hover:#0958d9; --login-focus:rgba(22,119,255,.16); }
:root[data-theme="green"] { --login-page-bg:#f0f7f3; --login-primary:#168a5b; --login-primary-hover:#0f7048; --login-focus:rgba(22,138,91,.16); }
:root[data-theme="dark"] {
  color-scheme:dark; --login-page-bg:#0f1726; --login-card-bg:#172135; --login-text:#f3f6fb;
  --login-muted:#94a3b8; --login-label:#cbd5e1; --login-field-bg:#202c42;
  --login-field-text:#f8fafc; --login-field-border:rgba(255,255,255,.13);
  --login-placeholder:#7f8da3; --login-primary:#3b82f6; --login-primary-hover:#60a5fa;
  --login-focus:rgba(96,165,250,.20); --login-card-border:rgba(255,255,255,.09);
  --login-shadow:0 22px 60px rgba(0,0,0,.32),0 2px 8px rgba(0,0,0,.20);
}
"""


def patch_workspace_template(html: str) -> str:
    """Hide decorative/browser versions while retaining the About version."""
    pattern = r'(<div class="logo"[^>]*>.*?)(?:\s*<span[^>]*>v\d+\.\d+\.\d+</span>)(\s*</div>)'
    html = re.sub(pattern, r'\1\2', html, count=1, flags=re.DOTALL)
    return re.sub(r'<title>[^<]*</title>', '<title>项目管理系统</title>', html, count=1)


def patch_login_template(html: str) -> str:
    """Make the standalone login page inherit the saved application theme."""
    if THEME_MARKER in html:
        return html
    html = html.replace('<style>', f'<style>{THEME_TOKENS}', 1)
    replacements = {
        'background:#f6f8fb;': 'background:var(--login-page-bg);',
        'color:rgba(15,23,42,.9);': 'color:var(--login-text);',
        'background:#fff;': 'background:var(--login-card-bg);',
        'border:1px solid rgba(15,23,42,.08);': 'border:1px solid var(--login-card-border);',
        'box-shadow:0 18px 45px rgba(15,23,42,.08), 0 2px 8px rgba(15,23,42,.04);': 'box-shadow:var(--login-shadow);',
        'color:#64748b;': 'color:var(--login-muted);',
        'color:#475569;': 'color:var(--login-label);',
        'border:1px solid rgba(15,23,42,.14);': 'border:1px solid var(--login-field-border);',
        'color:#0f172a;': 'color:var(--login-field-text);',
        'color:#a8b1c1;': 'color:var(--login-placeholder);',
        'border-color:#2563eb; box-shadow:0 0 0 3px rgba(37,99,235,.12);': 'border-color:var(--login-primary); box-shadow:0 0 0 3px var(--login-focus);',
        'background:#2563eb;': 'background:var(--login-primary);',
        'background:#1d4ed8;': 'background:var(--login-primary-hover);',
    }
    for old, new in replacements.items():
        html = html.replace(old, new)
    html = html.replace(
        'background:var(--login-card-bg);\n  color:var(--login-field-text);',
        'background:var(--login-field-bg);\n  color:var(--login-field-text);',
    )
    return html.replace('<style>', THEME_BOOTSTRAP + '<style>', 1)


def _bump_asset_cache_versions(html: str) -> str:
    pattern = r'(/static/(?:app\.js|style\.css)\?v=)(\d+)'
    return re.sub(
        pattern,
        lambda match: f"{match.group(1)}{int(match.group(2)) + 1}",
        html,
    )


def prepare_release_templates(
    workspace_html: str,
    login_html: str,
    release_version: str,
) -> tuple[str, str]:
    """Apply all tracked shell transforms to templates extracted from a source EXE."""
    if not re.fullmatch(r'v\d+\.\d+\.\d+', release_version):
        raise ValueError('release_version must use vMAJOR.MINOR.PATCH')
    workspace = patch_workspace_template(workspace_html)
    workspace = _bump_asset_cache_versions(workspace)
    login = re.sub(r'<title>[^<]*</title>', '<title>项目管理系统 - 登录</title>', login_html, count=1)
    return workspace, patch_login_template(login)
