"""Portable headless browser selection shared by release acceptance tools."""
from __future__ import annotations

import hashlib
import os
from pathlib import Path
import shutil
import sys


def require_windows_candidate(candidate: Path, sha256: str) -> str:
    if sys.platform != 'win32':
        raise RuntimeError('Windows EXE acceptance requires Windows. Ubuntu may run source/browser tests, but cannot pass this packaged EXE gate.')
    candidate = Path(candidate)
    if not candidate.is_file() or candidate.suffix.lower() != '.exe':
        raise ValueError('Candidate must be an existing Windows .exe')
    with candidate.open('rb') as stream:
        actual = hashlib.file_digest(stream, 'sha256').hexdigest()
    if actual.lower() != sha256.lower():
        raise ValueError(f'Candidate hash mismatch: expected {sha256}, actual {actual}')
    return actual


def launch_browser(playwright, browser_executable=None, **kwargs):
    """Return (Browser, JSON metadata); explicit overrides never silently fall back."""
    override = browser_executable or os.environ.get('PM_BROWSER_EXECUTABLE')
    source = 'argument' if browser_executable else 'environment'
    options = {'headless': True, **kwargs}
    if override:
        executable = Path(override).expanduser().resolve()
        if not executable.is_file():
            raise RuntimeError(f'Configured browser executable does not exist: {executable}')
        try:
            browser = playwright.chromium.launch(executable_path=str(executable), **options)
        except Exception as error:
            raise RuntimeError(f'Configured browser executable could not launch: {executable}: {error}') from error
        return browser, {'source': source, 'executable': str(executable), 'browser_version': browser.version, 'platform': sys.platform}
    candidates = []
    if sys.platform == 'win32':
        for variable in ('PROGRAMFILES(X86)', 'PROGRAMFILES', 'LOCALAPPDATA'):
            base = os.environ.get(variable)
            if base:
                candidates.extend(Path(base) / name for name in ('Microsoft/Edge/Application/msedge.exe', 'Google/Chrome/Application/chrome.exe'))
    for name in ('msedge', 'google-chrome', 'chromium', 'chromium-browser'):
        found = shutil.which(name)
        if found:
            candidates.append(Path(found))
    errors = []
    for executable in dict.fromkeys(candidates):
        if not executable.is_file():
            continue
        try:
            browser = playwright.chromium.launch(executable_path=str(executable), **options)
            return browser, {'source': 'detected', 'executable': str(executable), 'browser_version': browser.version, 'platform': sys.platform}
        except Exception as error:
            errors.append(f'{executable}: {error}')
    try:
        browser = playwright.chromium.launch(**options)
        return browser, {'source': 'playwright', 'executable': playwright.chromium.executable_path, 'browser_version': browser.version, 'platform': sys.platform}
    except Exception as error:
        raise RuntimeError('No usable Chromium browser. Set --browser-executable or PM_BROWSER_EXECUTABLE, or run python -m playwright install chromium. ' + '; '.join([*errors, str(error)])) from error
