"""HTTP response and access-log hardening for the frozen V5 application."""

from __future__ import annotations

import logging
import re
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit


_SENSITIVE_KEYS = {"sig", "token", "csrf", "code"}
_REQUEST_LINE = re.compile(
    r"^(?P<prefix>[A-Z]+\s+)(?P<target>\S+)(?P<suffix>\s+HTTP/\d(?:\.\d)?)(?P<tail>.*)$",
    re.DOTALL,
)
_BAD_PERCENT = re.compile(r"%(?![0-9A-Fa-f]{2})")


def _strip_query(value: str) -> str:
    match = _REQUEST_LINE.match(value)
    if match:
        target = match.group("target").split("?", 1)[0]
        return f'{match.group("prefix")}{target}{match.group("suffix")}{match.group("tail")}'
    return value.split("?", 1)[0] if "?" in value else value


def _redact_target(target: str) -> str:
    if "?" not in target:
        return target
    if _BAD_PERCENT.search(target):
        raise ValueError("malformed percent escape")
    parts = urlsplit(target)
    pairs = parse_qsl(parts.query, keep_blank_values=True, strict_parsing=False)
    cleaned = [
        (key, "[REDACTED]" if key.casefold() in _SENSITIVE_KEYS else value)
        for key, value in pairs
    ]
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(cleaned), parts.fragment))


def redact_request_target(value: str) -> str:
    raw = str(value)
    try:
        match = _REQUEST_LINE.match(raw)
        if match:
            target = _redact_target(match.group("target"))
            return f'{match.group("prefix")}{target}{match.group("suffix")}{match.group("tail")}'
        if raw.startswith(("/", "http://", "https://")):
            return _redact_target(raw)
        return raw
    except Exception:
        return _strip_query(raw)


class _AccessLogRedactionFilter(logging.Filter):
    _device_access_redactor = True

    def filter(self, record):
        try:
            if isinstance(record.msg, str):
                record.msg = redact_request_target(record.msg)
            if isinstance(record.args, tuple):
                record.args = tuple(
                    redact_request_target(value) if isinstance(value, str) else value
                    for value in record.args
                )
            elif isinstance(record.args, dict):
                record.args = {
                    key: redact_request_target(value) if isinstance(value, str) else value
                    for key, value in record.args.items()
                }
        except Exception:
            if isinstance(record.msg, str):
                record.msg = _strip_query(record.msg)
            record.args = ()
        return True


def install_access_log_redaction(loggers) -> None:
    for logger in loggers or ():
        if any(getattr(item, "_device_access_redactor", False) for item in logger.filters):
            continue
        logger.addFilter(_AccessLogRedactionFilter())


def _is_sensitive_response(request) -> bool:
    endpoint = str(request.endpoint or "")
    path = str(request.path or "")
    return (
        endpoint in {"login", "device_access_request_page", "device_access_request_submit"}
        or endpoint.startswith("device_access_")
        or path == "/login"
        or path == "/request-access"
        or path == "/api/csrf-refresh"
        or path.startswith("/api/device-access/")
    )


def install_http_security(app, *, request_handler_class, access_loggers) -> None:
    install_access_log_redaction(access_loggers)

    if not getattr(request_handler_class, "_device_access_identity_installed", False):
        def version_string(self):
            return "ProjectManagementSystem"

        request_handler_class.server_version = "ProjectManagementSystem"
        request_handler_class.sys_version = ""
        request_handler_class.version_string = version_string
        request_handler_class._device_access_identity_installed = True

    if app.extensions.get("http_security_installed"):
        return

    from flask import request

    @app.after_request
    def device_access_security_headers(response):
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "same-origin")
        response.headers.setdefault(
            "Permissions-Policy", "camera=(), microphone=(), geolocation=()"
        )
        if _is_sensitive_response(request):
            response.headers["Cache-Control"] = "no-store"
        return response

    app.extensions["http_security_installed"] = True
