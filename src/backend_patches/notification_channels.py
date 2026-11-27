"""Multi-channel instant notifications: in-app inbox, Windows tray alerts, and WeCom/DingTalk/Feishu webhooks.

notification-channels-v1
"""
from __future__ import annotations

import base64
from datetime import date, datetime, timedelta
import hashlib
import html
import re
import hmac
import http.client
import ipaddress
import json
import os
from pathlib import Path
import socket
import ssl
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from typing import Any

from flask import jsonify, request, session
from sqlalchemy import text


NOTIFICATION_CHANNELS_SIGNATURE = "notification-channels-v1"
VALID_CHANNEL_TYPES = ("wecom", "dingtalk", "feishu")
VALID_CATEGORIES = (
    "stage_due",
    "guarantee",
    "deadline",
    "supplier_shortage",
)
CATEGORY_LABELS = {
    "stage_due": "阶段节点提醒",
    "guarantee": "保证金退还与复核",
    "deadline": "法定业务期限",
    "supplier_shortage": "供应商数量不足预警",
}
OFFICIAL_WEBHOOK_HOSTS = {
    "wecom": ("qyapi.weixin.qq.com",),
    "dingtalk": ("oapi.dingtalk.com",),
    "feishu": ("open.feishu.cn", "open.larksuite.com"),
}
_SECRETS_FILENAME = "notification_channel_secrets.dpapi"
MAX_WEBHOOK_RESPONSE_BYTES = 65536

_SCHEMA_SQL = (
    """
    CREATE TABLE IF NOT EXISTS in_app_notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_key TEXT NOT NULL UNIQUE,
        category TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'info',
        title TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        project_id INTEGER,
        target_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        expires_at TEXT
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_in_app_notifications_created ON in_app_notifications (created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS idx_in_app_notifications_project ON in_app_notifications (project_id)",
    """
    CREATE TABLE IF NOT EXISTS in_app_notification_reads (
        notification_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        read_at TEXT NOT NULL,
        PRIMARY KEY (notification_id, user_id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS notification_channel_deliveries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        delivery_key TEXT NOT NULL UNIQUE,
        channel_id TEXT NOT NULL,
        channel_type TEXT NOT NULL,
        event_key TEXT NOT NULL,
        category TEXT NOT NULL,
        project_id INTEGER,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT,
        last_error TEXT NOT NULL DEFAULT '',
        sent_at TEXT,
        created_at TEXT NOT NULL
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_notification_deliveries_status ON notification_channel_deliveries (status, next_attempt_at)",
)


def _normalize_ctx(ctx: Any) -> Any:
    """Accept dict, AppContextRegistry, module (legacy server_app), or SimpleNamespace."""
    if ctx is None:
        return {}
    if hasattr(ctx, "get") and callable(ctx.get):
        return ctx
    try:
        import runtime_context
    except ModuleNotFoundError:
        from src.backend_patches import runtime_context
    return runtime_context.get_runtime_context(ctx)


def _session_from(db_or_session: Any):
    if db_or_session is None:
        return None
    return getattr(db_or_session, "session", db_or_session)


def _has_tables(db_or_session: Any) -> bool:
    sess = _session_from(db_or_session)
    if sess is None or not callable(getattr(sess, "execute", None)):
        return False
    try:
        rows = sess.execute(
            text(
                "SELECT name FROM sqlite_master WHERE type='table' "
                "AND name IN ('in_app_notifications','in_app_notification_reads','notification_channel_deliveries')"
            )
        ).fetchall()
        return len(rows) == 3
    except Exception:
        return False


def _ensure_delivery_project_id_column(sess: Any) -> None:
    try:
        import schema_models
    except ModuleNotFoundError:
        from src.backend_patches import schema_models
    try:
        cols = schema_models.table_columns(sess, "notification_channel_deliveries", text)
        if cols and "project_id" not in cols:
            sess.execute(text("ALTER TABLE notification_channel_deliveries ADD COLUMN project_id INTEGER"))
    except Exception:
        pass


def ensure_schema(db_or_session: Any, *, allow_create: bool = True) -> bool:
    sess = _session_from(db_or_session)
    if sess is None or not callable(getattr(sess, "execute", None)):
        return False
    if _has_tables(sess):
        if allow_create:
            _ensure_delivery_project_id_column(sess)
        return True
    if not allow_create:
        return False
    for stmt in _SCHEMA_SQL:
        sess.execute(text(stmt))
    _ensure_delivery_project_id_column(sess)
    return True


def cleanup_deleted_project_notifications(db_or_session: Any, project_id: int) -> None:
    """Remove in-app notifications & read records and cancel pending deliveries for a permanently deleted project."""
    sess = _session_from(db_or_session)
    if sess is None or not callable(getattr(sess, "execute", None)):
        return
    pid = int(project_id)
    try:
        tables = {
            str(r[0])
            for r in sess.execute(
                text(
                    "SELECT name FROM sqlite_master WHERE type='table' "
                    "AND name IN ('in_app_notifications','in_app_notification_reads','notification_channel_deliveries')"
                )
            ).fetchall()
        }
        if "in_app_notifications" in tables:
            if "in_app_notification_reads" in tables:
                sess.execute(
                    text(
                        "DELETE FROM in_app_notification_reads "
                        "WHERE notification_id IN (SELECT id FROM in_app_notifications WHERE project_id=:pid)"
                    ),
                    {"pid": pid},
                )
            sess.execute(
                text("DELETE FROM in_app_notifications WHERE project_id=:pid"),
                {"pid": pid},
            )
        if "notification_channel_deliveries" in tables:
            try:
                if __package__:
                    from . import schema_models
                else:
                    import schema_models
                cols = schema_models.table_columns(sess, "notification_channel_deliveries", text)
            except Exception:
                cols = set()
            if "project_id" in cols:
                sess.execute(
                    text(
                        "UPDATE notification_channel_deliveries "
                        "SET status='skipped', last_error='所属项目已彻底删除' "
                        "WHERE project_id=:pid AND status='pending'"
                    ),
                    {"pid": pid},
                )
    except Exception:
        pass


# ---------------------------------------------------------------------------
# DPAPI-protected Webhook secrets storage (fail-closed on Windows)
# ---------------------------------------------------------------------------

def _protect_bytes(raw: bytes, ctx: Any) -> bytes:
    if os.name == "nt":
        if __package__:
            from . import public_licensing
        else:
            import public_licensing
        try:
            return public_licensing._dpapi_protect(raw)
        except Exception as exc:
            raise RuntimeError("Windows 本机 DPAPI 凭据加密失败，已中止保存（原凭据未改动）") from exc
    # Non-Windows authenticated envelope
    key = _fallback_key(ctx)
    sig = hmac.new(key, raw, hashlib.sha256).digest()
    return b"PMSEC1:" + sig + base64.urlsafe_b64encode(raw)


def _unprotect_bytes(blob: bytes, ctx: Any) -> bytes:
    if blob.startswith(b"PMSEC1:"):
        sig = blob[7:39]
        raw = base64.urlsafe_b64decode(blob[39:])
        key = _fallback_key(ctx)
        if not hmac.compare_digest(sig, hmac.new(key, raw, hashlib.sha256).digest()):
            raise ValueError("凭据校验失败")
        return raw
    if os.name == "nt":
        if __package__:
            from . import public_licensing
        else:
            import public_licensing
        return public_licensing._dpapi_unprotect(blob)
    raise ValueError("无法解密本机通知凭据")


def _fallback_key(ctx: Any) -> bytes:
    runtime = _normalize_ctx(ctx)
    master = runtime.get("MASTER_KEY") if hasattr(runtime, "get") else None
    if isinstance(master, (bytes, bytearray)) and master:
        return hashlib.sha256(bytes(master) + b":notification_channels").digest()
    return hashlib.sha256(b"pm-notification-channels-fallback").digest()


def _secrets_path(ctx: Any) -> Path:
    runtime = _normalize_ctx(ctx)
    data_dir = runtime.get("DATA_DIR") if hasattr(runtime, "get") else getattr(ctx, "DATA_DIR", None)
    return Path(data_dir) / _SECRETS_FILENAME


_CONFIG_LOCKS_GUARD = threading.Lock()
_CONFIG_LOCKS: dict[str, threading.RLock] = {}


def _config_lock_for(ctx: Any) -> threading.RLock:
    """Serialize read-modify-write-rollback across app_settings.json and .dpapi secrets per data directory."""
    key = str(_secrets_path(ctx).resolve())
    with _CONFIG_LOCKS_GUARD:
        lock = _CONFIG_LOCKS.get(key)
        if lock is None:
            lock = threading.RLock()
            _CONFIG_LOCKS[key] = lock
        return lock


def load_channel_secrets(ctx: Any) -> dict[str, dict[str, str]]:
    path = _secrets_path(ctx)
    if not path.is_file():
        return {}
    try:
        raw = _unprotect_bytes(path.read_bytes(), ctx)
        parsed = json.loads(raw.decode("utf-8"))
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def _encrypt_channel_secrets_bytes(ctx: Any, secrets_map: dict[str, dict[str, str]]) -> bytes:
    payload = json.dumps(secrets_map, ensure_ascii=False).encode("utf-8")
    return _protect_bytes(payload, ctx)


def _write_encrypted_secrets_bytes(ctx: Any, encrypted: bytes) -> None:
    path = _secrets_path(ctx)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        with tmp.open("wb") as stream:
            stream.write(encrypted)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(tmp, path)
    except Exception:
        try:
            tmp.unlink(missing_ok=True)
        except Exception:
            pass
        raise


def save_channel_secrets(ctx: Any, secrets_map: dict[str, dict[str, str]]) -> None:
    encrypted = _encrypt_channel_secrets_bytes(ctx, secrets_map)
    _write_encrypted_secrets_bytes(ctx, encrypted)


def read_committed_config_and_secrets(ctx: Any) -> tuple[dict[str, Any], dict[str, dict[str, str]]]:
    """Atomically read a consistent committed snapshot of notification_channels config + DPAPI secrets under lock."""
    runtime = _normalize_ctx(ctx)
    load_app_settings = runtime.get("load_app_settings", lambda: {})
    with _config_lock_for(runtime):
        settings = load_app_settings() if callable(load_app_settings) else {}
        cfg = normalize_notification_config(settings.get("notification_channels"))
        raw_secrets = load_channel_secrets(runtime)
        secrets_copy = {str(k): dict(v) for k, v in raw_secrets.items() if isinstance(v, dict)}
    return cfg, secrets_copy


def mask_url(url: str) -> str:
    value = str(url or "").strip()
    if not value:
        return ""
    try:
        parsed = urllib.parse.urlparse(value)
        tail = value[-4:] if len(value) > 8 else "****"
        return f"{parsed.scheme}://{parsed.netloc}{parsed.path[:18]}…****{tail}"
    except Exception:
        return "****"


# ---------------------------------------------------------------------------
# Webhook validation, signing & payload formatting
# ---------------------------------------------------------------------------

def validate_webhook_url(url: str, channel_type: str, *, allow_custom_host: bool = False) -> str:
    value = str(url or "").strip()
    if not value:
        raise ValueError("Webhook 地址不能为空")
    if len(value) > 1024:
        raise ValueError("Webhook 地址长度不能超过 1024 个字符")
    parsed = urllib.parse.urlparse(value)
    if parsed.scheme != "https":
        raise ValueError("Webhook 地址必须使用 HTTPS 协议")
    host = (parsed.hostname or "").strip().lower()
    if not host:
        raise ValueError("Webhook 地址缺少有效域名")
    if host in ("localhost", "localhost.localdomain") or host.endswith(".local"):
        raise ValueError("不允许将本地回环地址设为 Webhook")
    try:
        ip = ipaddress.ip_address(host)
        if ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_unspecified:
            raise ValueError("不允许使用回环或链路本地 IP 作为 Webhook 地址")
        if ip.is_private and not allow_custom_host:
            raise ValueError("内网私有地址须勾选「允许自定义私有化域名」后才能保存")
    except ValueError as exc:
        if "不允许" in str(exc) or "内网" in str(exc):
            raise
    if not allow_custom_host:
        allowed_hosts = OFFICIAL_WEBHOOK_HOSTS.get(channel_type, ())
        if host not in allowed_hosts:
            raise ValueError(
                f"当前通道类型仅默认允许官方域名（{', '.join(allowed_hosts)}）；"
                "若为私有化部署，请勾选「允许自定义私有化域名」"
            )
    return value


def build_webhook_request(
    channel_type: str,
    url: str,
    title: str,
    body: str,
    *,
    secret: str = "",
    timestamp: float | None = None,
    group: dict | None = None,
) -> tuple[str, dict[str, Any]]:
    """Build signed URL and JSON payload for WeCom, DingTalk, or Feishu bot webhooks."""
    now_ts = time.time() if timestamp is None else float(timestamp)
    safe_title = str(title or "项目管理系统提醒").strip()
    safe_body = str(body or "").strip()

    if channel_type == "wecom":
        content = f"### {safe_title}\n{safe_body}" if safe_body else f"### {safe_title}"
        return url, {"msgtype": "markdown", "markdown": {"content": content.encode("utf-8")[:4000].decode("utf-8", "ignore")}}

    if channel_type == "dingtalk":
        target_url = url
        if secret:
            ts_ms = str(int(now_ts * 1000))
            string_to_sign = f"{ts_ms}\n{secret}".encode("utf-8")
            digest = hmac.new(secret.encode("utf-8"), string_to_sign, hashlib.sha256).digest()
            sign = urllib.parse.quote_plus(base64.b64encode(digest).decode("utf-8"))
            sep = "&" if "?" in target_url else "?"
            target_url = f"{target_url}{sep}timestamp={ts_ms}&sign={sign}"
        text_md = f"### {safe_title}\n\n{safe_body}" if safe_body else f"### {safe_title}"
        return target_url, {"msgtype": "markdown", "markdown": {"title": safe_title[:128], "text": text_md[:4000]}}

    if channel_type == "feishu":
        payload: dict[str, Any] = {
            "msg_type": "interactive",
            "card": {
                "header": {
                    "title": {"tag": "plain_text", "content": safe_title[:128]},
                    "template": "blue",
                },
                "elements": [
                    {"tag": "markdown", "content": safe_body[:4000] or safe_title},
                ],
            },
        }
        if group and group["meta"]:
            # Feishu cards support a distinct footer, unlike the Markdown webhook formats.
            body_only = group_message_markdown({**group, "meta": []})
            elements = [{"tag": "markdown", "content": body_only[:4000]}] if body_only else []
            elements.extend([{"tag": "hr"}, {"tag": "note", "elements": [
                {"tag": "plain_text", "content": " · ".join(group["meta"])}]}])
            payload["card"]["elements"] = elements
        if secret:
            ts_sec = str(int(now_ts))
            string_to_sign = f"{ts_sec}\n{secret}".encode("utf-8")
            digest = hmac.new(string_to_sign, b"", hashlib.sha256).digest()
            payload["timestamp"] = ts_sec
            payload["sign"] = base64.b64encode(digest).decode("utf-8")
        return url, payload

    raise ValueError(f"不支持的通道类型：{channel_type}")


class _NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Block all HTTP 3xx redirects so allowlisted webhook endpoints cannot bounce to internal hosts."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise urllib.error.HTTPError(req.full_url, code, "Webhook 禁止 HTTP 重定向", headers, fp)


class _PinnedHTTPSConnection(http.client.HTTPSConnection):
    """Connect strictly to pre-validated IP(s) while preserving original hostname SNI & TLS certificate verification."""

    def __init__(self, host, port=None, *, pinned_ips=(), expected_host="", **kwargs):
        self._pinned_ips = list(pinned_ips or ())
        self._expected_host = str(expected_host or host)
        super().__init__(host, port=port, **kwargs)

    def connect(self):
        if not self._pinned_ips:
            raise OSError("未提供已验证的目标 IP 地址")
        last_err = None
        raw_sock = None
        for ip in self._pinned_ips:
            try:
                raw_sock = socket.create_connection((ip, self.port), self.timeout, self.source_address)
                break
            except OSError as exc:
                last_err = exc
        if raw_sock is None:
            raise last_err or OSError(f"无法连接已验证目标地址：{self._expected_host}")
        self.sock = self._context.wrap_socket(raw_sock, server_hostname=self._expected_host)


class _PinnedHTTPSHandler(urllib.request.HTTPSHandler):
    """HTTPSHandler that pins socket connections to verified IPs with strict hostname certificate checking."""

    def __init__(self, pinned_ips: list[str], expected_host: str, context: ssl.SSLContext | None = None):
        ssl_ctx = context or ssl.create_default_context()
        super().__init__(context=ssl_ctx)
        self._pinned_ips = list(pinned_ips)
        self._expected_host = expected_host

    def https_open(self, req):
        pinned_ips = self._pinned_ips
        expected_host = self._expected_host

        def _factory(host, **kwargs):
            return _PinnedHTTPSConnection(
                host,
                pinned_ips=pinned_ips,
                expected_host=expected_host,
                **kwargs,
            )

        return self.do_open(_factory, req, context=self._context)


def build_pinned_webhook_opener(pinned_ips: list[str], expected_host: str) -> urllib.request.OpenerDirector:
    """Build an opener with ambient proxies disabled, redirects blocked, and TCP pinned to verified IPs."""
    return urllib.request.build_opener(
        urllib.request.ProxyHandler({}),
        _NoRedirectHandler,
        _PinnedHTTPSHandler(pinned_ips, expected_host),
    )


def verify_webhook_target_at_connect(
    url: str,
    channel_type: str,
    *,
    allow_custom_host: bool = False,
    resolver: Any = None,
) -> list[str]:
    """Re-validate URL and verify resolved DNS IP addresses right before connecting."""
    clean_url = validate_webhook_url(url, channel_type, allow_custom_host=allow_custom_host)
    parsed = urllib.parse.urlparse(clean_url)
    host = (parsed.hostname or "").strip().lower()
    port = parsed.port or 443
    resolve_fn = resolver or socket.getaddrinfo
    try:
        infos = resolve_fn(host, port, type=socket.SOCK_STREAM)
    except OSError as exc:
        raise ValueError(f"无法解析目标域名 {host}：{exc}") from exc
    resolved_ips: list[str] = []
    for info in infos or ():
        sockaddr = info[4] if len(info) > 4 else ()
        if not sockaddr:
            continue
        ip_str = str(sockaddr[0]).split("%", 1)[0]
        try:
            ip = ipaddress.ip_address(ip_str)
        except ValueError:
            continue
        if ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_unspecified or ip.is_reserved:
            raise ValueError(f"目标地址解析到受限 IP（{ip}），已拒绝发送")
        if ip.is_private and not allow_custom_host:
            raise ValueError(f"目标地址解析到内网私有 IP（{ip}），请开启私有化域名模式后再试")
        if ip_str not in resolved_ips:
            resolved_ips.append(ip_str)
    if not resolved_ips:
        raise ValueError(f"目标域名 {host} 未返回可用 IP 地址")
    return resolved_ips


def send_webhook(
    channel_type: str,
    url: str,
    title: str,
    body: str,
    *,
    secret: str = "",
    allow_custom_host: bool = False,
    group: dict | None = None,
    timeout: float = 5.0,
    transport: Any = None,
    opener: Any = None,
    resolver: Any = None,
) -> tuple[bool, str]:
    target_url, payload = build_webhook_request(channel_type, url, title, body, secret=secret, group=group)
    encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    if callable(transport):
        return transport(channel_type, target_url, payload)
    try:
        resolved_ips = verify_webhook_target_at_connect(
            target_url,
            channel_type,
            allow_custom_host=allow_custom_host,
            resolver=resolver,
        )
    except ValueError as exc:
        return False, str(exc)[:200]
    expected_host = (urllib.parse.urlparse(target_url).hostname or "").strip().lower()
    req = urllib.request.Request(
        target_url,
        data=encoded,
        headers={"Content-Type": "application/json; charset=utf-8", "User-Agent": "ProjectManagementSystem/5.10"},
        method="POST",
    )
    active_opener = opener or build_pinned_webhook_opener(resolved_ips, expected_host)
    try:
        with active_opener.open(req, timeout=timeout) as resp:
            raw_bytes = resp.read(MAX_WEBHOOK_RESPONSE_BYTES + 1)
            if len(raw_bytes) > MAX_WEBHOOK_RESPONSE_BYTES:
                return False, "服务端响应体超过 64KB 限制，已中止读取"
            raw = raw_bytes.decode("utf-8", errors="replace")
            status = getattr(resp, "status", 200)
            if status >= 400:
                return False, f"HTTP {status}"
            try:
                parsed = json.loads(raw or "{}")
                errcode = parsed.get("errcode", parsed.get("code", 0))
                if errcode not in (0, "0", None):
                    errmsg = str(parsed.get("errmsg") or parsed.get("msg") or f"错误码 {errcode}")
                    return False, errmsg[:200]
            except Exception:
                pass
            return True, ""
    except urllib.error.HTTPError as exc:
        if 300 <= int(getattr(exc, "code", 0) or 0) < 400:
            return False, f"HTTP {exc.code}（Webhook 禁止重定向）"
        return False, f"HTTP {exc.code}"
    except urllib.error.URLError as exc:
        return False, f"网络请求失败：{getattr(exc, 'reason', exc)}"[:200]
    except Exception as exc:
        return False, str(exc)[:200]


# ---------------------------------------------------------------------------
# Settings normalization & quiet hours
# ---------------------------------------------------------------------------

def default_notification_config() -> dict[str, Any]:
    return {
        "in_app_enabled": True,
        "desktop_popup_enabled": True,
        "quiet_hours_enabled": False,
        "quiet_start": "22:00",
        "quiet_end": "08:00",
        "webhooks": [],
    }


def _valid_hhmm(value: Any, fallback: str) -> str:
    s = str(value or "").strip()
    if len(s) == 5 and s[2] == ":" and s[:2].isdigit() and s[3:].isdigit():
        hh, mm = int(s[:2]), int(s[3:])
        if 0 <= hh <= 23 and 0 <= mm <= 59:
            return s
    return fallback


SEVERITY_RANK = {"info": 0, "warning": 1, "urgent": 2}
MESSAGE_EXAMPLES = {
    "stage_due": ("【明日到期】银行卡空白卡采购 · 开标", "项目编号：示例-001｜采购人：示例银行｜计划时间：明日 09:30"),
    "guarantee": ("投标保证金待退还", "项目编号：示例-002｜供应商：示例制卡公司｜应退金额：10,000 元"),
    "deadline": ("质疑答复即将到期", "项目编号：示例-003｜事项：采购文件质疑｜答复期限：明日 17:00"),
    "supplier_shortage": ("报名供应商数量不足", "项目编号：示例-004｜已报名：2 家｜要求：3 家"),
}


def webhook_preferences(item):
    def choice(key, allowed, default):
        value = item.get(key)
        return value if isinstance(value, str) and value in allowed else default
    return {
        "message_style": choice("message_style", ("detail", "compact"), "detail"),
        "title_prefix": " ".join(str(item.get("title_prefix") or "").split())[:24],
        "show_category": bool(item.get("show_category", True)),
        "show_time": bool(item.get("show_time", True)),
        "min_severity": choice("min_severity", SEVERITY_RANK, "info"),
        "delivery_days": choice("delivery_days", ("daily", "weekdays", "weekends"), "daily"),
    }


def next_delivery_day(days, moment):
    day = moment
    while ((days == "weekdays" and day.weekday() >= 5)
           or (days == "weekends" and day.weekday() < 5)):
        day = (day + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return day


def group_message(options, category, title, summary, created):
    prefs = webhook_preferences(options)
    heading = " · ".join(part for part in (prefs["title_prefix"], title) if part)
    details = [v.strip() for v in re.split(r"[｜\n]", summary) if v.strip()]
    meta = []
    if prefs["show_category"]:
        meta.append(CATEGORY_LABELS.get(category, "通道测试"))
    if prefs["show_time"]:
        meta.append(str(created).replace("T", " ")[:16])
    return dict(title=heading, details=details, meta=meta, style=prefs["message_style"])


def group_message_markdown(message):
    def literal(value):
        value = html.escape(value, quote=False)
        return re.sub(r"([\\*`_\[\]])", lambda m: chr(92) + m[0], value)
    rows = [literal(v) for v in message["details"]]
    if message["style"] == "compact":
        body = " · ".join(rows)
    else:
        lines = []
        for row in rows:
            label, separator, value = row.partition("：")
            lines.append(f"**{label}**　{value}" if separator and len(label) <= 12 else row)
        body = "\n\n".join(lines)
    footer = " · ".join(map(literal, message["meta"]))
    return "\n\n".join(v for v in (body, ("> " + footer) if footer else "") if v)


def normalize_notification_config(raw: Any) -> dict[str, Any]:
    base = default_notification_config()
    if not isinstance(raw, dict):
        return base
    base["in_app_enabled"] = bool(raw.get("in_app_enabled", True))
    base["desktop_popup_enabled"] = bool(raw.get("desktop_popup_enabled", True))
    base["quiet_hours_enabled"] = bool(raw.get("quiet_hours_enabled", False))
    base["quiet_start"] = _valid_hhmm(raw.get("quiet_start"), "22:00")
    base["quiet_end"] = _valid_hhmm(raw.get("quiet_end"), "08:00")
    webhooks = []
    seen_ids = set()
    for item in raw.get("webhooks") or []:
        if not isinstance(item, dict):
            continue
        cid = str(item.get("id") or "").strip() or f"wh-{uuid.uuid4().hex[:8]}"
        if cid in seen_ids:
            continue
        seen_ids.add(cid)
        ctype = str(item.get("type") or "").strip().lower()
        if ctype not in VALID_CHANNEL_TYPES:
            continue
        events = [e for e in (item.get("event_types") or []) if e in VALID_CATEGORIES]
        if not events:
            events = ["stage_due", "guarantee", "deadline", "supplier_shortage"]
        webhooks.append({
            "id": cid,
            "name": str(item.get("name") or "").strip()[:60] or f"{ctype} 机器人",
            "type": ctype,
            "enabled": bool(item.get("enabled", True)),
            "allow_custom_host": bool(item.get("allow_custom_host", False)),
            "event_types": events,
            **webhook_preferences(item),
        })
    base["webhooks"] = webhooks
    return base


def is_in_quiet_hours(cfg: dict[str, Any], now: datetime) -> bool:
    if not cfg.get("quiet_hours_enabled"):
        return False
    start = _valid_hhmm(cfg.get("quiet_start"), "22:00")
    end = _valid_hhmm(cfg.get("quiet_end"), "08:00")
    cur = now.strftime("%H:%M")
    if start == end:
        return False
    if start < end:
        return start <= cur < end
    return cur >= start or cur < end


# ---------------------------------------------------------------------------
# Event creation, channel queueing & delivery engine
# ---------------------------------------------------------------------------

def record_notification(
    ctx: Any,
    *,
    event_key: str,
    category: str,
    severity: str,
    title: str,
    summary: str,
    project_id: int | None = None,
    target: dict[str, Any] | None = None,
    now: datetime | None = None,
) -> bool:
    """Idempotently store in-app notification and enqueue desktop & matching webhook deliveries."""
    runtime = _normalize_ctx(ctx)
    db = runtime.get("db")
    load_app_settings = runtime.get("load_app_settings", lambda: {})
    if db is None:
        return False
    ensure_schema(db, allow_create=True)
    dt = now or datetime.now()
    now_iso = dt.isoformat(timespec="seconds")
    expires_iso = (dt + timedelta(days=90)).isoformat(timespec="seconds")
    settings = load_app_settings() if callable(load_app_settings) else {}
    cfg = normalize_notification_config(settings.get("notification_channels"))
    pid_val = int(project_id) if project_id is not None else None
    norm_sev = severity if severity in ("info", "warning", "urgent") else "info"
    norm_cat = category if category in VALID_CATEGORIES else "stage_due"

    in_app_inserted = False
    if cfg["in_app_enabled"]:
        res = db.session.execute(
            text(
                "INSERT OR IGNORE INTO in_app_notifications ("
                "event_key, category, severity, title, summary, project_id, target_json, created_at, expires_at"
                ") VALUES (:event_key, :category, :severity, :title, :summary, :project_id, :target_json, :created_at, :expires_at)"
            ),
            {
                "event_key": str(event_key)[:240],
                "category": norm_cat,
                "severity": norm_sev,
                "title": str(title or "")[:200],
                "summary": str(summary or "")[:1200],
                "project_id": pid_val,
                "target_json": json.dumps(target or {}, ensure_ascii=False),
                "created_at": now_iso,
                "expires_at": expires_iso,
            },
        )
        in_app_inserted = getattr(res, "rowcount", 0) == 1

    # Independent desktop tray delivery ledger (works even when in_app_enabled is False)
    desktop_inserted = False
    if cfg["desktop_popup_enabled"]:
        d_res = db.session.execute(
            text(
                "INSERT OR IGNORE INTO notification_channel_deliveries ("
                "delivery_key, channel_id, channel_type, event_key, category, project_id, title, body, "
                "status, attempts, next_attempt_at, last_error, created_at"
                ") VALUES ("
                ":delivery_key, 'desktop', 'desktop', :event_key, :category, :project_id, :title, :body, "
                "'pending', 0, :next_at, :sev_tag, :created_at"
                ")"
            ),
            {
                "delivery_key": f"desktop|{event_key}"[:300],
                "event_key": str(event_key)[:240],
                "category": norm_cat,
                "project_id": pid_val,
                "title": str(title or "")[:200],
                "body": str(summary or "")[:2000],
                "next_at": now_iso,
                "sev_tag": norm_sev,
                "created_at": now_iso,
            },
        )
        desktop_inserted = getattr(d_res, "rowcount", 0) == 1

    # Enqueue enabled matching webhooks
    for wh in cfg["webhooks"]:
        if not wh.get("enabled"):
            continue
        if norm_cat not in (wh.get("event_types") or ()):
            continue
        if SEVERITY_RANK[norm_sev] < SEVERITY_RANK[wh["min_severity"]]:
            continue
        delivery_key = f"{wh['id']}|{event_key}"[:300]
        db.session.execute(
            text(
                "INSERT OR IGNORE INTO notification_channel_deliveries ("
                "delivery_key, channel_id, channel_type, event_key, category, project_id, title, body, "
                "status, attempts, next_attempt_at, last_error, created_at"
                ") VALUES ("
                ":delivery_key, :channel_id, :channel_type, :event_key, :category, :project_id, :title, :body, "
                "'pending', 0, :next_at, '', :created_at"
                ")"
            ),
            {
                "delivery_key": delivery_key,
                "channel_id": wh["id"],
                "channel_type": wh["type"],
                "event_key": str(event_key)[:240],
                "category": norm_cat,
                "project_id": pid_val,
                "title": str(title or "")[:200],
                "body": str(summary or "")[:2000],
                "next_at": now_iso,
                "created_at": now_iso,
            },
        )
    return bool(in_app_inserted or desktop_inserted)


def _collect_due_events(ctx: Any, now: datetime) -> list[dict[str, Any]]:
    """Scan active non-deleted projects for due/overdue stages, deadlines, guarantees, and supplier shortages."""
    runtime = _normalize_ctx(ctx)
    db = runtime.get("db")
    Project = runtime.get("Project")
    load_app_settings = runtime.get("load_app_settings", lambda: {})
    if db is None or Project is None:
        return []
    today = now.date()
    today_iso = today.isoformat()
    settings = load_app_settings() if callable(load_app_settings) else {}
    events: list[dict[str, Any]] = []

    deleted_pids: set[int] = set()
    deleted_comps: set[int] = set()
    deleted_clars: set[int] = set()
    try:
        try:
            import recycle_bin
        except ModuleNotFoundError:
            from . import recycle_bin
        deleted_pids = recycle_bin.deleted_ids(db, "project")
        deleted_comps = recycle_bin.deleted_ids(db, "complaint")
        deleted_clars = recycle_bin.deleted_ids(db, "clarification")
    except Exception:
        pass

    # Eager-load stages, lots, registrations to avoid N+1 scans
    try:
        from sqlalchemy.orm import selectinload
        proj_query = Project.query.options(
            selectinload(Project.stages),
            selectinload(Project.lots),
            selectinload(Project.registrations),
        ).filter_by(is_terminated=False)
    except Exception:
        proj_query = Project.query.filter_by(is_terminated=False)
    projects = [p for p in proj_query.all() if p.id not in deleted_pids]
    proj_map = {p.id: p for p in projects}

    # 1. Stage deadlines (overdue or due within 1 day)
    for p in projects:
        for st in list(getattr(p, "stages", ()) or ()):
            if getattr(st, "completed", False) or getattr(st, "skipped", False) or getattr(st, "template_removed", False):
                continue
            planned = getattr(st, "planned_datetime", None)
            if not planned:
                continue
            p_date = planned.date() if isinstance(planned, datetime) else planned
            diff = (p_date - today).days
            if diff > 1:
                continue
            stage_name = getattr(st, "stage_name", None) or getattr(st, "stage_key", "")
            time_txt = planned.strftime("%Y-%m-%d %H:%M") if isinstance(planned, datetime) else str(planned)
            if diff < 0:
                sev = "urgent"
                prefix = f"【已逾期 {-diff} 天】"
            elif diff == 0:
                sev = "urgent"
                prefix = "【今日到期】"
            else:
                sev = "warning"
                prefix = "【明日到期】"
            events.append({
                "event_key": f"stage_due|{p.id}|{st.stage_key}|{today_iso}",
                "category": "stage_due",
                "severity": sev,
                "title": f"{prefix}{p.name} · {stage_name}",
                "summary": f"项目编号：{p.number}｜采购人：{p.purchaser or '-'}｜计划时间：{time_txt}",
                "project_id": p.id,
                "target": {"view": "project", "project_id": p.id, "tab": "board", "stage_key": st.stage_key},
            })

    # 2. Business deadlines (only official confirmed_deadline for due/overdue; needs_review labeled explicitly)
    try:
        has_bd = db.session.execute(
            text("SELECT 1 FROM sqlite_master WHERE type='table' AND name='business_deadline_items'")
        ).first()
        if has_bd:
            rows = db.session.execute(
                text(
                    "SELECT project_id, id, state, payload FROM business_deadline_items "
                    "WHERE state NOT IN ('completed','cancelled')"
                )
            ).fetchall()
            for pid_val, item_id, row_state, raw_payload in rows:
                pid_int = int(pid_val)
                if pid_int in deleted_pids or pid_int not in proj_map:
                    continue
                try:
                    item = json.loads(raw_payload or "{}")
                except Exception:
                    continue
                src_type = str(item.get("source_type") or "")
                src_id_raw = item.get("source_id")
                try:
                    src_id_int = int(src_id_raw) if src_id_raw not in (None, "") else None
                except (TypeError, ValueError):
                    src_id_int = None
                if src_type == "complaint" and src_id_int is not None and src_id_int in deleted_comps:
                    continue
                if src_type in ("clarification", "clarification_notification") and src_id_int is not None and src_id_int in deleted_clars:
                    continue

                state = str(item.get("state") or row_state or "").strip().lower()
                needs_review = bool(item.get("needs_review"))
                confirmed_raw = str(item.get("confirmed_deadline") or "").strip()
                proj = proj_map[pid_int]
                rule_name = (item.get("rule") or {}).get("name") or item.get("title") or "业务期限"

                # Never fabricate an official due/overdue notice from an unconfirmed suggested calculation.
                if state == "confirmed" and confirmed_raw:
                    try:
                        due_date = date.fromisoformat(confirmed_raw[:10])
                    except ValueError:
                        due_date = None
                    if due_date is not None:
                        try:
                            remind_days = max(0, int(item.get("remind_days", 1)))
                        except (TypeError, ValueError):
                            remind_days = 1
                        diff = (due_date - today).days
                        if diff <= max(1, remind_days):
                            if needs_review:
                                events.append({
                                    "event_key": f"deadline_review|{item_id}|{today_iso}",
                                    "category": "deadline",
                                    "severity": "warning",
                                    "title": f"【需复核】{proj.name} · {rule_name}",
                                    "summary": f"项目编号：{proj.number}｜原确认截止：{due_date.isoformat()}（起算事实或规则已变化，请复核）",
                                    "project_id": pid_int,
                                    "target": {"view": "project", "project_id": pid_int, "tab": "tasks"},
                                })
                            else:
                                sev = "urgent" if diff <= 0 else "warning"
                                tag = f"已逾期 {-diff} 天" if diff < 0 else ("今日截止" if diff == 0 else (f"明日截止" if diff == 1 else f"{diff} 天后截止"))
                                events.append({
                                    "event_key": f"deadline|{item_id}|{today_iso}",
                                    "category": "deadline",
                                    "severity": sev,
                                    "title": f"【{tag}】{proj.name} · {rule_name}",
                                    "summary": f"项目编号：{proj.number}｜确认截止日期：{due_date.isoformat()}",
                                    "project_id": pid_int,
                                    "target": {"view": "project", "project_id": pid_int, "tab": "tasks"},
                                })
                            continue

                if needs_review:
                    review_reason = str(item.get("review_reason") or "规则或起算事实发生变化，请人工核对").strip()
                    events.append({
                        "event_key": f"deadline_review|{item_id}|{today_iso}",
                        "category": "deadline",
                        "severity": "warning",
                        "title": f"【需复核】{proj.name} · {rule_name}",
                        "summary": f"项目编号：{proj.number}｜{review_reason}",
                        "project_id": pid_int,
                        "target": {"view": "project", "project_id": pid_int, "tab": "tasks"},
                    })
    except Exception:
        pass

    # 3. Guarantee refund deadlines (overdue or due within 1 day with positive balance)
    try:
        has_tl = db.session.execute(
            text("SELECT 1 FROM sqlite_master WHERE type='table' AND name='tender_ledgers'")
        ).first()
        if has_tl:
            rows = db.session.execute(
                text("SELECT project_id, items FROM tender_ledgers WHERE items != '[]'")
            ).fetchall()
            for pid_val, raw_items in rows:
                pid_int = int(pid_val)
                if pid_int in deleted_pids or pid_int not in proj_map:
                    continue
                try:
                    items = json.loads(raw_items or "[]")
                except Exception:
                    continue
                proj = proj_map[pid_int]
                for item in items:
                    if not isinstance(item, dict):
                        continue
                    try:
                        bal = float(item.get("balance") or 0)
                    except (TypeError, ValueError):
                        bal = 0.0
                    if bal <= 0:
                        continue
                    dl_raw = str(item.get("deadline") or "").strip()
                    if not dl_raw:
                        continue
                    try:
                        dl_date = date.fromisoformat(dl_raw[:10])
                    except ValueError:
                        continue
                    diff = (dl_date - today).days
                    if diff > 1:
                        continue
                    reg_id = item.get("registration_id") or item.get("company_name") or "item"
                    company = str(item.get("company_name") or "供应商")
                    sev = "urgent" if diff <= 0 else "warning"
                    tag = f"退保已逾期 {-diff} 天" if diff < 0 else ("今日退保截止" if diff == 0 else "明日退保截止")
                    events.append({
                        "event_key": f"guarantee|{pid_int}|{reg_id}|{today_iso}",
                        "category": "guarantee",
                        "severity": sev,
                        "title": f"【{tag}】{proj.name} · {company}",
                        "summary": f"项目编号：{proj.number}｜未退保证金：¥{bal:,.2f}｜退还截止：{dl_date.isoformat()}",
                        "project_id": pid_int,
                        "target": {"view": "project", "project_id": pid_int, "tab": "board"},
                    })
    except Exception:
        pass

    # 4. Supplier quantity shortage warnings (within 1 day before registration deadline)
    try:
        try:
            import lot_supplier_risk
        except ModuleNotFoundError:
            from . import lot_supplier_risk
        risk_pf = lot_supplier_risk.batch_load_project_risk_data(db, projects)
        for p in projects:
            snap = lot_supplier_risk.build_project_snapshot(db, p, now, settings, prefetched=risk_pf)
            if snap.get("blocked_reason") or not snap.get("deadline"):
                continue
            risks = [
                item for item in (snap.get("items") or [])
                if item.get("status") == "warning" and (item.get("missing_count") or 0) > 0
            ]
            if not risks:
                continue
            days_rem = snap.get("days_remaining")
            sev = "urgent" if (days_rem is not None and days_rem <= 0) else "warning"
            prefix = "【今日截止·数量不足】" if sev == "urgent" else "【数量预警】"
            summary_parts = [
                f"{(r.get('lot_number') or '项目整体')}: 已报{r.get('registration_count')}家/需{r.get('required_count')}家"
                for r in risks[:3]
            ]
            # Resolve actual registration stage key on this project (workspace has board/timeline/tasks/info/attachments tabs)
            reg_stage_key = ""
            pid_snaps = (risk_pf or {}).get("stage_snapshots_by_pid", {}).get(int(p.id), {})
            for st in list(getattr(p, "stages", ()) or ()):
                sk = getattr(st, "stage_key", None) or getattr(st, "key", None) or ""
                raw_mod, rem = pid_snaps.get(
                    sk,
                    (getattr(st, "modules_json", getattr(st, "modules", None)), bool(getattr(st, "template_removed", False))),
                )
                if rem:
                    continue
                mods = None
                if isinstance(raw_mod, str):
                    try:
                        mods = json.loads(raw_mod)
                    except Exception:
                        mods = None
                elif isinstance(raw_mod, list):
                    mods = raw_mod
                if (mods is None and sk == "registration_end") or (isinstance(mods, list) and "registration" in mods):
                    reg_stage_key = sk
                    break
            if not reg_stage_key:
                reg_stage_key = "registration_end"
            events.append({
                "event_key": f"supplier_shortage|{p.id}|{today_iso}",
                "category": "supplier_shortage",
                "severity": sev,
                "title": f"{prefix}{p.name}（{len(risks)} 个包供应商不足）",
                "summary": f"项目编号：{p.number}｜" + "；".join(summary_parts),
                "project_id": p.id,
                "target": {"view": "project", "project_id": p.id, "tab": "board", "stage_key": reg_stage_key},
            })
    except Exception:
        pass

    return events


def _resolve_desktop_notifier(runtime: Any, app: Any, override: Any = None):
    """Unified tray notification callback lookup across pure-source and legacy compatibility hosts."""
    if callable(override):
        return override
    # 1. Runtime context bridge (used by legacy compatibility desktop_app_replacements & registered contexts)
    for bridge in (
        getattr(runtime, "desktop_bridge", None),
        runtime.get("desktop_bridge") if hasattr(runtime, "get") else None,
        (getattr(app, "extensions", None) or {}).get("desktop_bridge") if app is not None else None,
        getattr((getattr(app, "extensions", None) or {}).get("runtime_context"), "desktop_bridge", None) if app is not None else None,
    ):
        if isinstance(bridge, dict) and callable(bridge.get("notify")):
            return bridge["notify"]
    # 2. Pure-source desktop host service fallback
    try:
        if __package__:
            from . import desktop_host_service
        else:
            import desktop_host_service
        return desktop_host_service.notify_desktop
    except Exception:
        return None


def run_notification_dispatch(
    ctx: Any,
    *,
    now: datetime | None = None,
    transport: Any = None,
    desktop_notifier: Any = None,
) -> dict[str, Any]:
    """Scan due items, persist in-app notifications, push tray popup & deliver webhooks."""
    runtime = _normalize_ctx(ctx)
    db = runtime.get("db")
    app = runtime.get("app")
    Project = runtime.get("Project")
    load_app_settings = runtime.get("load_app_settings", lambda: {})
    if db is None:
        return {"created": 0, "sent": 0, "failed": 0, "desktop_notified": False}
    ensure_schema(db, allow_create=True)
    dt = now or datetime.now()
    now_iso = dt.isoformat(timespec="seconds")
    cfg, secrets_map = read_committed_config_and_secrets(runtime)

    # Cleanup expired in-app notifications (> 90d)
    db.session.execute(
        text("DELETE FROM in_app_notifications WHERE expires_at IS NOT NULL AND expires_at < :now_iso"),
        {"now_iso": now_iso},
    )

    due_events = _collect_due_events(runtime, dt)
    created_events: list[dict[str, Any]] = []
    for ev in due_events:
        if record_notification(runtime, now=dt, **ev):
            created_events.append(ev)
    db.session.commit()

    deleted_pids: set[int] = set()
    try:
        try:
            import recycle_bin
        except ModuleNotFoundError:
            from . import recycle_bin
        deleted_pids = recycle_bin.deleted_ids(db, "project")
    except Exception:
        pass

    def _is_project_hidden(pid_raw: Any) -> bool:
        if pid_raw is None:
            return False
        pid_int = int(pid_raw)
        if pid_int in deleted_pids:
            return True
        if Project is not None and db.session.get(Project, pid_int) is None:
            return True
        return False

    # Independent desktop tray notification with rate-limit aggregation and per-event dedup
    desktop_notified = False
    if cfg["desktop_popup_enabled"] and not is_in_quiet_hours(cfg, dt):
        pending_desktop = db.session.execute(
            text(
                "SELECT id, project_id, title, body, last_error AS sev_tag "
                "FROM notification_channel_deliveries "
                "WHERE channel_type='desktop' AND status='pending' "
                "ORDER BY id ASC LIMIT 50"
            )
        ).mappings().all()
        visible_desktop = []
        for row in pending_desktop:
            if _is_project_hidden(row["project_id"]):
                db.session.execute(
                    text("UPDATE notification_channel_deliveries SET status='skipped', last_error='所属项目已移入回收站，已取消发送' WHERE id=:id"),
                    {"id": int(row["id"])},
                )
            else:
                visible_desktop.append(row)
        if visible_desktop:
            notifier = _resolve_desktop_notifier(runtime, app, desktop_notifier)
            if callable(notifier):
                if len(visible_desktop) <= 2:
                    for row in visible_desktop:
                        if notifier(str(row["title"]), str(row["body"])):
                            desktop_notified = True
                            db.session.execute(
                                text("UPDATE notification_channel_deliveries SET status='sent', attempts=attempts+1, sent_at=:ts, last_error='' WHERE id=:id"),
                                {"ts": now_iso, "id": int(row["id"])},
                            )
                else:
                    urgent_count = sum(1 for r in visible_desktop if str(r["sev_tag"] or "") == "urgent")
                    summary_msg = (
                        f"共 {len(visible_desktop)} 条新提醒（含 {urgent_count} 条紧急），"
                        f"首条：{visible_desktop[0]['title']}"
                    )
                    if notifier("项目管理系统 · 待办提醒", summary_msg):
                        desktop_notified = True
                        for row in visible_desktop:
                            db.session.execute(
                                text("UPDATE notification_channel_deliveries SET status='sent', attempts=attempts+1, sent_at=:ts, last_error='' WHERE id=:id"),
                                {"ts": now_iso, "id": int(row["id"])},
                            )
        db.session.commit()

    # Deliver pending webhooks (skip if inside quiet hours; re-verify project visibility before sending)
    sent = 0
    failed = 0
    if not is_in_quiet_hours(cfg, dt):
        wh_by_id = {wh["id"]: wh for wh in cfg["webhooks"] if wh.get("enabled")}
        pending_rows = db.session.execute(
            text(
                "SELECT id, channel_id, channel_type, project_id, category, title, body, created_at, attempts "
                "FROM notification_channel_deliveries "
                "WHERE channel_type != 'desktop' AND status='pending' AND attempts < 3 "
                "AND (next_attempt_at IS NULL OR next_attempt_at <= :now_iso) "
                "ORDER BY id ASC LIMIT 30"
            ),
            {"now_iso": now_iso},
        ).mappings().all()
        for row in pending_rows:
            if _is_project_hidden(row["project_id"]):
                db.session.execute(
                    text("UPDATE notification_channel_deliveries SET status='skipped', last_error='所属项目已移入回收站，已取消发送' WHERE id=:id"),
                    {"id": int(row["id"])},
                )
                continue
            cid = str(row["channel_id"])
            wh = wh_by_id.get(cid)
            sec = secrets_map.get(cid) or {}
            url = str(sec.get("webhook_url") or "").strip()
            secret = str(sec.get("secret") or "").strip()
            if not wh or not url:
                db.session.execute(
                    text("UPDATE notification_channel_deliveries SET status='skipped', last_error='通道已停用或未配置地址' WHERE id=:id"),
                    {"id": int(row["id"])},
                )
                continue
            if row["category"] not in wh["event_types"]:
                db.session.execute(text("UPDATE notification_channel_deliveries SET status='skipped', last_error='该通道已取消订阅' WHERE id=:id"), {"id": row["id"]})
                continue
            next_day = next_delivery_day(wh["delivery_days"], dt)
            if next_day != dt:
                db.session.execute(text("UPDATE notification_channel_deliveries SET next_attempt_at=:next WHERE id=:id"),
                                   {"next": next_day.isoformat(timespec="seconds"), "id": row["id"]})
                continue
            message = group_message(wh, row["category"], row["title"], row["body"], row["created_at"])
            ok, err_msg = send_webhook(
                wh["type"],
                url,
                message["title"],
                group_message_markdown(message),
                group=message,
                secret=secret,
                allow_custom_host=bool(wh.get("allow_custom_host", False)),
                transport=transport,
            )
            attempts = int(row["attempts"] or 0) + 1
            if ok:
                db.session.execute(
                    text(
                        "UPDATE notification_channel_deliveries "
                        "SET status='sent', attempts=:att, sent_at=:ts, last_error='' WHERE id=:id"
                    ),
                    {"att": attempts, "ts": now_iso, "id": int(row["id"])},
                )
                sent += 1
            else:
                backoff_min = 5 if attempts == 1 else 15
                next_at = (dt + timedelta(minutes=backoff_min)).isoformat(timespec="seconds")
                next_status = "failed" if attempts >= 3 else "pending"
                db.session.execute(
                    text(
                        "UPDATE notification_channel_deliveries "
                        "SET status=:st, attempts=:att, next_attempt_at=:na, last_error=:err WHERE id=:id"
                    ),
                    {"st": next_status, "att": attempts, "na": next_at, "err": err_msg[:240], "id": int(row["id"])},
                )
                failed += 1
        db.session.commit()

    return {
        "created": len(created_events),
        "sent": sent,
        "failed": failed,
        "desktop_notified": desktop_notified,
    }


# ---------------------------------------------------------------------------
# Route registration
# ---------------------------------------------------------------------------

def register(app: Any, db: Any, ctx: Any) -> bool:
    if app.extensions.get("notification_channels"):
        return True
    runtime = ctx if hasattr(ctx, "get") else dict(ctx or {})
    User = runtime.get("User")
    login_required = runtime.get("login_required") or (lambda f: f)
    load_app_settings = runtime.get("load_app_settings", lambda: {})
    save_app_settings = runtime.get("save_app_settings")
    log_operation = runtime.get("log_operation", lambda *a, **kw: None)

    def _current_uid() -> int:
        return int(session.get("user_id") or 0)

    def _is_admin() -> bool:
        uid = _current_uid()
        if not uid:
            return False
        user = db.session.get(User, uid) if User is not None else None
        return bool(user and getattr(user, "is_active", False) and getattr(user, "is_admin", False))

    def _visible_project_sql() -> str:
        project_exists = "EXISTS (SELECT 1 FROM projects p WHERE p.id=n.project_id)"
        try:
            try:
                import recycle_bin
            except ModuleNotFoundError:
                from . import recycle_bin
            if recycle_bin._has_table(db):
                return (
                    f"(n.project_id IS NULL OR ({project_exists} AND NOT EXISTS ("
                    "SELECT 1 FROM recycle_bin_items rb "
                    "WHERE rb.status IN ('deleted','purging') "
                    "AND rb.entity_type='project' AND rb.entity_id=n.project_id"
                    ")))"
                )
        except Exception:
            pass
        return f"(n.project_id IS NULL OR {project_exists})"

    @login_required
    def api_unread_count():
        if not _has_tables(db):
            return jsonify({"unread_count": 0, "urgent_unread_count": 0, "latest_id": 0})
        uid = _current_uid()
        vis_sql = _visible_project_sql()
        row = db.session.execute(
            text(
                "SELECT "
                "COUNT(*) AS unread_count, "
                "SUM(CASE WHEN n.severity='urgent' THEN 1 ELSE 0 END) AS urgent_count, "
                "MAX(n.id) AS latest_id "
                "FROM in_app_notifications n "
                "LEFT JOIN in_app_notification_reads r ON r.notification_id=n.id AND r.user_id=:uid "
                f"WHERE r.notification_id IS NULL AND {vis_sql}"
            ),
            {"uid": uid},
        ).mappings().first()
        return jsonify({
            "unread_count": int((row or {}).get("unread_count") or 0),
            "urgent_unread_count": int((row or {}).get("urgent_count") or 0),
            "latest_id": int((row or {}).get("latest_id") or 0),
        })

    @login_required
    def api_list_notifications():
        scope = str(request.args.get("scope") or "all").strip().lower()
        try:
            page = max(1, int(request.args.get("page") or 1))
        except (TypeError, ValueError):
            page = 1
        try:
            page_size = min(100, max(1, int(request.args.get("page_size") or 30)))
        except (TypeError, ValueError):
            page_size = 30
        if not _has_tables(db):
            return jsonify({"items": [], "total": 0, "unread_count": 0, "urgent_unread_count": 0, "page": page, "page_size": page_size})
        uid = _current_uid()
        vis_sql = _visible_project_sql()
        summary = db.session.execute(
            text(
                "SELECT "
                "SUM(CASE WHEN r.notification_id IS NULL THEN 1 ELSE 0 END) AS unread_count, "
                "SUM(CASE WHEN r.notification_id IS NULL AND n.severity='urgent' THEN 1 ELSE 0 END) AS urgent_count "
                "FROM in_app_notifications n "
                "LEFT JOIN in_app_notification_reads r ON r.notification_id=n.id AND r.user_id=:uid "
                f"WHERE {vis_sql}"
            ),
            {"uid": uid},
        ).mappings().first()
        where = [vis_sql]
        if scope == "unread":
            where.append("r.notification_id IS NULL")
        elif scope == "urgent":
            where.append("n.severity='urgent'")
        where_sql = " WHERE " + " AND ".join(where)
        total = int(
            db.session.execute(
                text(
                    "SELECT COUNT(*) FROM in_app_notifications n "
                    "LEFT JOIN in_app_notification_reads r ON r.notification_id=n.id AND r.user_id=:uid"
                    + where_sql
                ),
                {"uid": uid},
            ).scalar()
            or 0
        )
        rows = db.session.execute(
            text(
                "SELECT n.*, r.read_at FROM in_app_notifications n "
                "LEFT JOIN in_app_notification_reads r ON r.notification_id=n.id AND r.user_id=:uid"
                + where_sql
                + " ORDER BY n.created_at DESC, n.id DESC LIMIT :limit OFFSET :offset"
            ),
            {"uid": uid, "limit": page_size, "offset": (page - 1) * page_size},
        ).mappings().all()
        items = []
        for row in rows:
            try:
                target = json.loads(row["target_json"] or "{}")
            except Exception:
                target = {}
            items.append({
                "id": int(row["id"]),
                "event_key": str(row["event_key"]),
                "category": str(row["category"]),
                "category_label": CATEGORY_LABELS.get(str(row["category"]), "系统通知"),
                "severity": str(row["severity"]),
                "title": str(row["title"]),
                "summary": str(row["summary"]),
                "project_id": row["project_id"],
                "target": target,
                "created_at": str(row["created_at"]),
                "read": row["read_at"] is not None,
                "read_at": row["read_at"],
            })
        return jsonify({
            "items": items,
            "total": total,
            "unread_count": int((summary or {}).get("unread_count") or 0),
            "urgent_unread_count": int((summary or {}).get("urgent_count") or 0),
            "page": page,
            "page_size": page_size,
        })

    @login_required
    def api_mark_notification_read(nid: int):
        ensure_schema(db, allow_create=True)
        uid = _current_uid()
        now_iso = datetime.now().isoformat(timespec="seconds")
        db.session.execute(
            text(
                "INSERT OR IGNORE INTO in_app_notification_reads(notification_id, user_id, read_at) "
                "VALUES (:nid, :uid, :ts)"
            ),
            {"nid": int(nid), "uid": uid, "ts": now_iso},
        )
        db.session.commit()
        return jsonify({"ok": True})

    @login_required
    def api_mark_all_notifications_read():
        if not _has_tables(db):
            return jsonify({"ok": True, "marked": 0})
        uid = _current_uid()
        now_iso = datetime.now().isoformat(timespec="seconds")
        vis_sql = _visible_project_sql()
        res = db.session.execute(
            text(
                "INSERT OR IGNORE INTO in_app_notification_reads(notification_id, user_id, read_at) "
                "SELECT n.id, :uid, :ts FROM in_app_notifications n "
                "LEFT JOIN in_app_notification_reads r ON r.notification_id=n.id AND r.user_id=:uid "
                f"WHERE r.notification_id IS NULL AND {vis_sql}"
            ),
            {"uid": uid, "ts": now_iso},
        )
        db.session.commit()
        return jsonify({"ok": True, "marked": int(getattr(res, "rowcount", 0) or 0)})

    @login_required
    def api_scan_notifications():
        if not _is_admin():
            return jsonify({"error": "仅管理员可执行全系统通知扫描"}), 403
        result = run_notification_dispatch(runtime)
        return jsonify({"ok": True, **result})

    @login_required
    def api_get_notification_channels():
        if not _is_admin():
            return jsonify({"error": "仅管理员可查看通知通道配置"}), 403
        with _config_lock_for(runtime):
            settings = load_app_settings() if callable(load_app_settings) else {}
            cfg = normalize_notification_config(settings.get("notification_channels"))
            secrets_map = load_channel_secrets(runtime)
        webhooks_view = []
        for wh in cfg["webhooks"]:
            sec = secrets_map.get(wh["id"]) or {}
            url = str(sec.get("webhook_url") or "")
            webhooks_view.append({
                **wh,
                "has_webhook_url": bool(url),
                "webhook_url_masked": mask_url(url),
                "has_secret": bool(sec.get("secret")),
            })
        recent = []
        if _has_tables(db):
            rows = db.session.execute(
                text(
                    "SELECT id, channel_id, channel_type, category, title, status, attempts, last_error, sent_at, created_at "
                    "FROM notification_channel_deliveries WHERE channel_type != 'desktop' ORDER BY id DESC LIMIT 15"
                )
            ).mappings().all()
            recent = [dict(r) for r in rows]
        return jsonify({
            "config": {**cfg, "webhooks": webhooks_view},
            "categories": [{"key": k, "label": v} for k, v in CATEGORY_LABELS.items()],
            "recent_deliveries": recent,
            "is_desktop": bool(app.config.get("IS_DESKTOP")),
        })

    @login_required
    def api_save_notification_channels():
        if not _is_admin():
            return jsonify({"error": "仅管理员可修改通知通道配置"}), 403
        data = request.get_json(silent=True) or {}
        if not isinstance(data, dict):
            return jsonify({"error": "配置格式无效"}), 400

        with _config_lock_for(runtime):
            existing_settings = dict(load_app_settings() if callable(load_app_settings) else {})
            old_cfg = normalize_notification_config(existing_settings.get("notification_channels"))
            has_webhooks_field = "webhooks" in data

            if has_webhooks_field:
                old_secrets = load_channel_secrets(runtime)
                new_secrets: dict[str, dict[str, str]] = {}
                old_options = {wh["id"]: wh for wh in old_cfg["webhooks"]}
                raw_webhooks = data.get("webhooks")
                if raw_webhooks is not None and not isinstance(raw_webhooks, list):
                    return jsonify({"error": "群机器人通道列表格式无效"}), 400
                cleaned_webhooks = []
                seen_ids = set()
                for item in (raw_webhooks or []):
                    if not isinstance(item, dict):
                        return jsonify({"error": "群机器人通道配置项无效"}), 400
                    cid = str(item.get("id") or "").strip() or f"wh-{uuid.uuid4().hex[:8]}"
                    if cid in seen_ids:
                        continue
                    seen_ids.add(cid)
                    ctype = str(item.get("type") or "").strip().lower()
                    if ctype not in VALID_CHANNEL_TYPES:
                        return jsonify({"error": f"不支持的通道类型：{ctype}"}), 400
                    name = str(item.get("name") or "").strip()[:60]
                    if not name:
                        return jsonify({"error": "通道名称不能为空"}), 400
                    allow_custom = bool(item.get("allow_custom_host", False))
                    existing_sec = old_secrets.get(cid) or {}
                    raw_url = str(item.get("webhook_url") or "").strip()
                    if raw_url:
                        try:
                            valid_url = validate_webhook_url(raw_url, ctype, allow_custom_host=allow_custom)
                        except ValueError as exc:
                            return jsonify({"error": f"「{name}」{exc}"}), 400
                    else:
                        valid_url = str(existing_sec.get("webhook_url") or "").strip()
                        if not valid_url:
                            return jsonify({"error": f"「{name}」请填写 Webhook 地址"}), 400
                        try:
                            validate_webhook_url(valid_url, ctype, allow_custom_host=allow_custom)
                        except ValueError as exc:
                            return jsonify({"error": f"「{name}」{exc}"}), 400
                    if item.get("clear_secret"):
                        secret_val = ""
                    else:
                        raw_secret = str(item.get("secret") or "").strip()
                        secret_val = raw_secret if raw_secret else str(existing_sec.get("secret") or "")
                    new_secrets[cid] = {"webhook_url": valid_url, "secret": secret_val}
                    events = [e for e in (item.get("event_types") or []) if e in VALID_CATEGORIES]
                    cleaned_webhooks.append({
                        "id": cid,
                        "name": name,
                        "type": ctype,
                        "enabled": bool(item.get("enabled", True)),
                        "allow_custom_host": allow_custom,
                        **webhook_preferences({**old_options.get(cid, {}), **item}),
                        "event_types": events or ["stage_due", "guarantee", "deadline", "supplier_shortage"],
                    })
            else:
                cleaned_webhooks = list(old_cfg["webhooks"])
                new_secrets = None

            cfg = normalize_notification_config({
                "in_app_enabled": data["in_app_enabled"] if "in_app_enabled" in data else old_cfg["in_app_enabled"],
                "desktop_popup_enabled": data["desktop_popup_enabled"] if "desktop_popup_enabled" in data else old_cfg["desktop_popup_enabled"],
                "quiet_hours_enabled": data["quiet_hours_enabled"] if "quiet_hours_enabled" in data else old_cfg["quiet_hours_enabled"],
                "quiet_start": data["quiet_start"] if "quiet_start" in data else old_cfg["quiet_start"],
                "quiet_end": data["quiet_end"] if "quiet_end" in data else old_cfg["quiet_end"],
                "webhooks": cleaned_webhooks,
            })
            prev_settings_snapshot = dict(existing_settings)
            existing_settings["notification_channels"] = cfg
            sec_path = _secrets_path(runtime)
            had_prev_secrets_file = False
            prev_secrets_bytes: bytes | None = None
            secrets_written = False

            def _restore_secrets_file() -> None:
                try:
                    if had_prev_secrets_file and prev_secrets_bytes is not None:
                        sec_path.parent.mkdir(parents=True, exist_ok=True)
                        tmp = sec_path.with_name(f"{sec_path.name}.{uuid.uuid4().hex}.rollback.tmp")
                        with tmp.open("wb") as stream:
                            stream.write(prev_secrets_bytes)
                            stream.flush()
                            os.fsync(stream.fileno())
                        os.replace(tmp, sec_path)
                    elif not had_prev_secrets_file and sec_path.exists():
                        sec_path.unlink(missing_ok=True)
                except Exception as rb_exc:
                    if app is not None and getattr(app, "logger", None):
                        app.logger.error(f"回滚通知凭据文件失败: {rb_exc}")

            if has_webhooks_field and new_secrets is not None:
                had_prev_secrets_file = sec_path.is_file()
                if had_prev_secrets_file:
                    try:
                        prev_secrets_bytes = sec_path.read_bytes()
                    except Exception as exc:
                        return jsonify({"error": f"读取原有通知凭据失败（未改动任何配置）：{exc}"}), 500
                # Phase 1: Pre-encrypt new secrets IN MEMORY (zero disk write!) so DPAPI failures abort cleanly
                # and uncommitted URLs NEVER exist on disk before settings commit succeeds.
                try:
                    _encrypt_channel_secrets_bytes(runtime, new_secrets)
                except Exception as exc:
                    return jsonify({"error": f"通知通道凭据加密保存失败（原有配置已保留）：{exc}"}), 500

            # Phase 2: Commit app_settings.json while holding _config_lock_for(runtime).
            if callable(save_app_settings):
                try:
                    save_app_settings(existing_settings)
                except Exception as exc:
                    return jsonify({"error": f"保存通知配置失败（原有配置与凭据已保留）：{exc}"}), 500

            # Phase 3: Persist new secrets to .dpapi under the same lock; on failure roll back both settings & secrets.
            if has_webhooks_field and new_secrets is not None:
                try:
                    save_channel_secrets(runtime, new_secrets)
                except Exception as exc:
                    if callable(save_app_settings):
                        try:
                            save_app_settings(prev_settings_snapshot)
                        except Exception:
                            pass
                    _restore_secrets_file()
                    return jsonify({"error": f"更新通知凭据失败（原有配置与凭据已恢复）：{exc}"}), 500
            response = api_get_notification_channels()

        try:
            log_operation("notification_channels.update", "system", 0, f"更新多渠道通知配置（{len(cleaned_webhooks)} 个 Webhook）")
        except Exception:
            pass
        return response

    @login_required
    def api_preview_group_message():
        if not _is_admin():
            return jsonify({"error": "仅管理员可预览群消息"}), 403
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            return jsonify({"error": "预览参数无效"}), 400
        category = data.get("category")
        if not isinstance(category, str) or category not in MESSAGE_EXAMPLES:
            category = "stage_due"
        return jsonify(group_message(data, category, *MESSAGE_EXAMPLES[category], datetime.now()))

    def api_test_notification_channel(channel_id: str):
        if not _is_admin():
            return jsonify({"error": "仅管理员可测试通知通道"}), 403
        if channel_id == "desktop":
            notifier = _resolve_desktop_notifier(runtime, app)
            ok = bool(callable(notifier) and notifier("项目管理系统 · 测试通知", "桌面托盘气泡通知工作正常。"))
            if not ok:
                return jsonify({"error": "当前未处于 Windows 桌面托盘运行环境，无法弹出系统气泡（网页端仍可使用站内消息中心）"}), 400
            return jsonify({"ok": True, "message": "已发送桌面托盘测试气泡"})

        cfg, secrets_map = read_committed_config_and_secrets(runtime)
        wh = next((item for item in cfg["webhooks"] if item["id"] == channel_id), None)
        if wh is None:
            return jsonify({"error": "未找到对应的 Webhook 通道，请先保存配置"}), 404
        sec = secrets_map.get(channel_id) or {}
        url = str(sec.get("webhook_url") or "").strip()
        if not url:
            return jsonify({"error": "该通道尚未配置 Webhook 地址"}), 400
        transport = app.extensions.get("notification_test_transport")
        message = group_message(wh, "test", "项目管理系统 · 连通性测试",
                                f"测试通道：{wh['name']}｜状态：群机器人通知配置生效", datetime.now())
        ok, err_msg = send_webhook(
            wh["type"],
            url,
            message["title"],
            group_message_markdown(message),
            group=message,
            secret=str(sec.get("secret") or ""),
            allow_custom_host=bool(wh.get("allow_custom_host", False)),
            transport=transport,
        )
        if not ok:
            return jsonify({"error": f"测试发送失败：{err_msg}"}), 400
        return jsonify({"ok": True, "message": f"已向「{wh['name']}」发送测试消息"})

    app.add_url_rule("/api/notifications/unread-count", "api_notification_unread_count", api_unread_count, methods=["GET"])
    app.add_url_rule("/api/notifications", "api_list_notifications", api_list_notifications, methods=["GET"])
    app.add_url_rule("/api/notifications/<int:nid>/read", "api_mark_notification_read", api_mark_notification_read, methods=["POST"])
    app.add_url_rule("/api/notifications/read-all", "api_mark_all_notifications_read", api_mark_all_notifications_read, methods=["POST"])
    app.add_url_rule("/api/notifications/scan", "api_scan_notifications", api_scan_notifications, methods=["POST"])
    app.add_url_rule("/api/notifications/channels", "api_get_notification_channels", api_get_notification_channels, methods=["GET"])
    app.add_url_rule("/api/notifications/channels", "api_save_notification_channels", api_save_notification_channels, methods=["PUT"])
    app.add_url_rule("/api/notifications/channels/preview", "api_preview_group_message", api_preview_group_message, methods=["POST"])
    app.add_url_rule("/api/notifications/channels/<channel_id>/test", "api_test_notification_channel", api_test_notification_channel, methods=["POST"])
    app.extensions["notification_channels"] = {"signature": NOTIFICATION_CHANNELS_SIGNATURE}
    return True
