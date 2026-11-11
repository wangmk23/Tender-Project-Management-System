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
        # Windows registry MIME overrides can label .mjs as text/plain. Module
        # scripts require JavaScript MIME; never apply this to user attachments.
        filename = (request.view_args or {}).get('filename', '')
        if (request.endpoint == 'static' and response.status_code in (200, 206)
                and isinstance(filename, str) and filename.lower().endswith('.mjs')):
            response.mimetype = 'text/javascript'
        response.headers.setdefault("X-Frame-Options", "DENY")
        # The attachment reader is a reviewed same-origin iframe. Keep login,
        # originals and every other page under the default framing restriction.
        if (request.endpoint == 'static' and response.status_code in (200, 206, 304)
                and (request.view_args or {}).get('filename') == 'pdf-reader/index.html'):
            response.headers['X-Frame-Options'] = 'SAMEORIGIN'
            response.headers.add('Content-Security-Policy', "frame-ancestors 'self'")
        response.headers.setdefault("Referrer-Policy", "same-origin")
        response.headers.setdefault(
            "Permissions-Policy", "camera=(), microphone=(), geolocation=()"
        )
        if _is_sensitive_response(request):
            response.headers["Cache-Control"] = "no-store"
        return response

    app.extensions["http_security_installed"] = True


def smbios_system_uuid(raw):
    """Read SMBIOS type 1 UUID; malformed/legacy tables use the WMI fallback."""
    import uuid
    if len(raw) < 8 or (raw[1], raw[2]) < (2, 6):
        return None
    end = 8 + int.from_bytes(raw[4:8], 'little')
    if end > len(raw):
        return None
    offset = 8
    while offset + 4 <= end:
        kind, length = raw[offset:offset+2]
        if length < 4 or offset + length > end:
            return None
        if kind == 1:
            if length < 25:
                return None
            value = raw[offset+8:offset+24]
            if value in (bytes(16), b'\xff'*16):
                return None
            return str(uuid.UUID(bytes_le=value)).upper()
        terminator = raw.find(b'\x00\x00', offset+length, end)
        if terminator < 0 or kind == 127:
            return None
        offset = terminator + 2
    return None


def native_system_uuid():
    """Query live firmware through Windows, without launching PowerShell."""
    import os
    if os.name != 'nt':
        return None
    import ctypes
    try:
        read = ctypes.WinDLL('kernel32', use_last_error=True).GetSystemFirmwareTable
        read.argtypes = [ctypes.c_uint, ctypes.c_uint, ctypes.c_void_p, ctypes.c_uint]
        read.restype = ctypes.c_uint
        provider = int.from_bytes(b'RSMB', 'big')
        length = read(provider, 0, None, 0)
        if not 8 <= length <= 16*1024*1024:
            return None
        buffer = ctypes.create_string_buffer(length)
        actual = read(provider, 0, buffer, length)
        return smbios_system_uuid(buffer.raw[:actual]) if actual == length else None
    except (OSError, ValueError, AttributeError):
        return None


def prepare_license_verifier(original, *, reader=None):
    """Accelerate only UUID acquisition after proving equality with preserved WMI.

    Every request still reads live firmware, disk identity, license signature,
    expiry and rollback state. No authorization result or disk value is cached.
    Protected licensing module globals and code are not modified.
    """
    import types
    reader = reader or native_system_uuid
    if not isinstance(original, types.FunctionType):
        return original
    fingerprint = original.__globals__.get('machine_fingerprint')
    if not isinstance(fingerprint, types.FunctionType):
        return original
    legacy = fingerprint.__globals__.get('_system_uuid')
    if not callable(legacy):
        return original
    try:
        value = reader()
        if not value or value.upper() != str(legacy()).strip().upper():
            return original
    except Exception:
        return original

    def verify(*args, **kwargs):
        try:
            current = reader()
        except Exception:
            current = None
        if not current:
            return original(*args, **kwargs)
        # Fresh namespaces prevent retaining other mutable runtime inputs.
        fp = types.FunctionType(fingerprint.__code__,
            {**fingerprint.__globals__, '_system_uuid': lambda: current},
            fingerprint.__name__, fingerprint.__defaults__, fingerprint.__closure__)
        verifier = types.FunctionType(original.__code__,
            {**original.__globals__, 'machine_fingerprint': fp},
            original.__name__, original.__defaults__, original.__closure__)
        verifier.__kwdefaults__ = original.__kwdefaults__
        return verifier(*args, **kwargs)
    return verify


def install_live_license_identity(runtime):
    """Keep the preserved status gate and licensing module; optimize its input query."""
    if runtime.app.extensions.get('live_license_identity_installed'):
        return
    original = getattr(runtime, 'verify_license', None)
    if not callable(original):
        return False
    runtime.verify_license = prepare_license_verifier(original)
    runtime.app.extensions['live_license_identity_installed'] = True
