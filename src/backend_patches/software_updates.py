"""software-updates-v1: read-only update configuration and local browser opening."""
from __future__ import annotations

import json
from pathlib import Path
import re
import sys
import webbrowser
from urllib.parse import quote

# The builder embeds package.json's softwareUpdates value here. No token is supported.
BUNDLED_UPDATE_CONFIG = None
BUNDLED_CURRENT_CHANGELOG = None


def current_changelog():
    """The installed version's notes, usable without GitHub or business data."""
    if BUNDLED_CURRENT_CHANGELOG is not None:
        return BUNDLED_CURRENT_CHANGELOG
    if not getattr(sys, "frozen", False):
        try:
            root = Path(__file__).resolve().parents[2]
            version = json.loads((root / "package.json").read_text("utf-8"))["version"]
            if not isinstance(version, str) or not re.fullmatch(r"\d+\.\d+\.\d+", version):
                raise ValueError("invalid version")
            manifest = json.loads((root / f"docs/releases/v{version}-public.json").read_text("utf-8"))
            notes = (root / f"docs/releases/notes/v{version}-public.md").read_text("utf-8").strip()
            if not notes:
                raise ValueError("empty notes")
            return {"available": True, "version": "v" + version,
                    "date": manifest.get("release_date", ""), "body": notes[:30000]}
        except (OSError, ValueError, TypeError, KeyError):
            pass
    return {"available": False, "message": "当前版本更新日志暂不可用"}


def update_source(config=None):
    if config is None:
        config = BUNDLED_UPDATE_CONFIG
        if config is None and not getattr(sys, "frozen", False):
            try:
                config = json.loads((Path(__file__).resolve().parents[2] / "package.json").read_text("utf-8")).get("softwareUpdates", {})
            except (OSError, ValueError, TypeError):
                config = {}
    config = config if isinstance(config, dict) else {}
    owner, repo = config.get("owner", ""), config.get("repository", "")
    valid = (config.get("enabled") is True and isinstance(owner, str) and isinstance(repo, str)
             and re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})", owner)
             and re.fullmatch(r"[A-Za-z0-9_.-]{1,100}", repo) and repo not in {".", ".."})
    if not valid:
        return {"configured": False, "message": "尚未配置更新源"}
    return {"configured": True, "owner": owner, "repository": repo,
            "api_url": f"https://api.github.com/repos/{owner}/{repo}/releases",
            "releases_url": f"https://github.com/{owner}/{repo}/releases"}


def release_page(source, tag):
    if not source.get("configured") or not isinstance(tag, str) or not tag or len(tag) > 128:
        raise ValueError("无效的发布版本")
    if any(ord(c) < 32 or ord(c) == 127 for c in tag):
        raise ValueError("无效的发布版本")
    return source["releases_url"] + "/tag/" + quote(tag, safe="")


def register(app, login_required, *, config=None, browser_opener=None):
    from flask import jsonify, request
    if "software_update_source" in app.view_functions:
        return
    source = update_source(config)

    @login_required
    def source_info():
        return jsonify(source)

    @login_required
    def installed_changelog():
        return jsonify(current_changelog())

    @login_required
    def open_release():
        # Remote browsers open their own link; never open the server's desktop for a LAN visitor.
        if request.remote_addr not in {"127.0.0.1", "::1"}:
            return jsonify({"error": "请在当前浏览器中打开发布页面"}), 403
        if not source["configured"]:
            return jsonify({"error": "尚未配置更新源"}), 400
        payload = request.get_json(silent=True)
        try:
            url = release_page(source, payload.get("tag") if isinstance(payload, dict) else None)
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400
        try:
            opened = (browser_opener or webbrowser.open_new_tab)(url)
        except Exception:
            opened = False
        if not opened:
            return jsonify({"error": "无法打开默认浏览器，请复制发布链接后手动打开"}), 503
        return jsonify({"opened": True})

    app.add_url_rule("/api/software-updates/source", "software_update_source", source_info, methods=["GET"])
    app.add_url_rule("/api/software-updates/current-changelog", "software_update_current_changelog", installed_changelog, methods=["GET"])
    app.add_url_rule("/api/software-updates/open-release", "software_update_open_release", open_release, methods=["POST"])
