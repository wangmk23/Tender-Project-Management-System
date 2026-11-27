"""Comprehensive backend tests for multi-channel instant notifications (in-app, desktop tray, webhooks)."""
from __future__ import annotations

from datetime import datetime, timedelta
from pathlib import Path
import tempfile
import unittest

from sqlalchemy import text
from werkzeug.security import generate_password_hash

from src.backend_patches import desktop_host_service, notification_channels as nc
from src.project_manager.standalone_app import create_app


class NotificationChannelsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._cleanup)
        self.data_dir = Path(self.tmp.name) / "data"
        self.app = create_app(data_dir=self.data_dir, public_unrestricted=True)
        self.app.config["TESTING"] = True
        self.client = self.app.test_client()
        self.ctx = self.app.extensions["runtime_context"]
        self.db = self.ctx["db"]
        with self.app.app_context():
            User = self.ctx["User"]
            admin = User(
                username="admin",
                password_hash=generate_password_hash("AdminPass123456!"),
                is_admin=True,
                is_active=True,
                display_name="管理员",
            )
            viewer = User(
                username="viewer",
                password_hash=generate_password_hash("ViewerPass123456!"),
                is_admin=False,
                is_active=True,
                display_name="普通成员",
            )
            self.db.session.add_all([admin, viewer])
            self.db.session.commit()
            self.db.session.execute(
                text("INSERT INTO account_permissions(user_id, role, permissions) VALUES (:uid, 'viewer', :perms)"),
                {"uid": viewer.id, "perms": '{"create_projects":false,"edit_projects":false,"delete_projects":false,"manage_attachments":false,"export_data":true}'},
            )
            self.db.session.commit()
        self._login("admin", "AdminPass123456!")

    def _cleanup(self):
        try:
            with self.app.app_context():
                self.db.session.remove()
                self.db.engine.dispose()
        except Exception:
            pass
        self.tmp.cleanup()

    def _login(self, username, password):
        self.client.post("/login", data={"username": username, "password": password})
        tok = self.client.post("/api/csrf-refresh").get_json() or {}
        self.csrf = tok.get("csrf_token", "")

    def _headers(self):
        return {"X-CSRFToken": self.csrf}

    def test_webhook_validation_ssrf_and_signing_payloads(self):
        # Reject insecure HTTP, localhost, link-local, and unofficial domains by default
        with self.assertRaises(ValueError):
            nc.validate_webhook_url("http://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=1", "wecom")
        with self.assertRaises(ValueError):
            nc.validate_webhook_url("https://127.0.0.1/hook", "wecom", allow_custom_host=True)
        with self.assertRaises(ValueError):
            nc.validate_webhook_url("https://169.254.169.254/latest", "wecom", allow_custom_host=True)
        with self.assertRaises(ValueError):
            nc.validate_webhook_url("https://evil.example.com/hook", "wecom", allow_custom_host=False)
        # Allow official hosts and explicit custom host
        self.assertTrue(nc.validate_webhook_url("https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc", "wecom"))
        self.assertTrue(nc.validate_webhook_url("https://oapi.dingtalk.com/robot/send?access_token=abc", "dingtalk"))
        self.assertTrue(nc.validate_webhook_url("https://open.feishu.cn/open-apis/bot/v2/hook/abc", "feishu"))
        self.assertTrue(nc.validate_webhook_url("https://im.corp.example.com/hook", "feishu", allow_custom_host=True))

        # Verify WeCom / DingTalk / Feishu signed payloads
        url_w, body_w = nc.build_webhook_request("wecom", "https://qyapi.weixin.qq.com/hook", "测试标题", "详情内容")
        self.assertEqual(body_w["msgtype"], "markdown")
        self.assertIn("测试标题", body_w["markdown"]["content"])

        url_d, body_d = nc.build_webhook_request(
            "dingtalk", "https://oapi.dingtalk.com/robot/send?access_token=t", "开标提醒", "正文", secret="SEC123", timestamp=1700000000
        )
        self.assertIn("timestamp=1700000000000", url_d)
        self.assertIn("sign=", url_d)
        self.assertEqual(body_d["msgtype"], "markdown")

        url_f, body_f = nc.build_webhook_request(
            "feishu", "https://open.feishu.cn/open-apis/bot/v2/hook/x", "退保提醒", "正文", secret="FSEC", timestamp=1700000000
        )
        self.assertEqual(body_f["msg_type"], "interactive")
        self.assertEqual(body_f["timestamp"], "1700000000")
        self.assertTrue(body_f["sign"])

    def test_channel_config_encrypted_storage_test_send_and_permissions(self):
        # Save WeCom & DingTalk webhooks with secrets
        resp = self.client.put(
            "/api/notifications/channels",
            json={
                "in_app_enabled": True,
                "desktop_popup_enabled": True,
                "quiet_hours_enabled": False,
                "quiet_start": "22:00",
                "quiet_end": "08:00",
                "webhooks": [
                    {
                        "id": "wh-wecom",
                        "name": "招标业务群",
                        "type": "wecom",
                        "enabled": True,
                        "webhook_url": "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=secretkey9988",
                        "event_types": ["stage_due", "guarantee"],
                    },
                    {
                        "id": "wh-ding",
                        "name": "财务退保群",
                        "type": "dingtalk",
                        "enabled": True,
                        "webhook_url": "https://oapi.dingtalk.com/robot/send?access_token=tok1234",
                        "secret": "SEC_DING_SECRET",
                        "event_types": ["guarantee"],
                    },
                ],
            },
            headers=self._headers(),
        )
        self.assertEqual(resp.status_code, 200, resp.get_data(as_text=True))
        cfg = resp.get_json()["config"]
        self.assertEqual(len(cfg["webhooks"]), 2)
        # Raw secrets/URLs must NOT leak into app_settings.json or API response
        settings_text = (self.data_dir / "app_settings.json").read_text(encoding="utf-8")
        self.assertNotIn("secretkey9988", settings_text)
        self.assertNotIn("SEC_DING_SECRET", settings_text)
        self.assertTrue(cfg["webhooks"][0]["has_webhook_url"])
        self.assertIn("****9988", cfg["webhooks"][0]["webhook_url_masked"])
        self.assertTrue(cfg["webhooks"][1]["has_secret"])

        # Saving again with blank webhook_url & secret keeps existing encrypted values
        resp2 = self.client.put(
            "/api/notifications/channels",
            json={
                "in_app_enabled": True,
                "desktop_popup_enabled": True,
                "webhooks": [
                    {
                        "id": "wh-wecom",
                        "name": "招标业务群-改名",
                        "type": "wecom",
                        "enabled": True,
                        "event_types": ["stage_due"],
                    }
                ],
            },
            headers=self._headers(),
        )
        self.assertEqual(resp2.status_code, 200)
        self.assertEqual(resp2.get_json()["config"]["webhooks"][0]["name"], "招标业务群-改名")
        self.assertTrue(resp2.get_json()["config"]["webhooks"][0]["has_webhook_url"])

        # Test send with injected transport stub
        captured = []
        self.app.extensions["notification_test_transport"] = lambda ctype, url, payload: (captured.append((ctype, url, payload)) or (True, ""))
        t_resp = self.client.post("/api/notifications/channels/wh-wecom/test", json={}, headers=self._headers())
        self.assertEqual(t_resp.status_code, 200)
        self.assertEqual(len(captured), 1)
        self.assertEqual(captured[0][0], "wecom")

        # Non-admin viewer cannot view or edit channels
        self._login("viewer", "ViewerPass123456!")
        self.assertEqual(self.client.get("/api/notifications/channels").status_code, 403)
        self.assertEqual(self.client.put("/api/notifications/channels", json={}, headers=self._headers()).status_code, 403)

    def test_group_business_preview_and_weekday_delivery(self):
        opts = dict(id="audit", type="feishu", name="业务群", title_prefix="业务一部",
                    event_types=["stage_due"], delivery_days="weekdays", min_severity="urgent",
                    message_style="detail", show_category=True, show_time=False,
                    webhook_url="https://open.feishu.cn/open-apis/bot/v2/hook/demo")
        response = self.client.put("/api/notifications/channels", json={"webhooks": [opts]}, headers=self._headers())
        self.assertEqual(response.status_code, 200)
        config = response.get_json()["config"]["webhooks"][0]
        self.assertEqual(config["min_severity"], "urgent")
        preview = self.client.post("/api/notifications/channels/preview",
                                   json={**config, "category": "guarantee"}, headers=self._headers()).get_json()
        self.assertTrue(preview["title"].startswith("业务一部 · "))
        self.assertEqual(preview["meta"], [nc.CATEGORY_LABELS["guarantee"]])
        self.assertEqual(preview["style"], "detail")
        saturday = datetime(2026, 11, 28, 9)
        packets = []
        def collect(channel, url, packet):
            packets.append(packet)
            return True, ""
        with self.app.app_context():
            for severity in ("warning", "urgent"):
                nc.record_notification(self.ctx, event_key=severity, category="stage_due", severity=severity,
                                       title="开标", summary="项目编号：001｜采购人：甲", now=saturday)
            self.db.session.commit()
            nc.run_notification_dispatch(self.ctx, now=saturday, transport=collect)
            self.assertEqual(packets, [])
            nc.run_notification_dispatch(self.ctx, now=saturday+timedelta(days=2), transport=collect)
        self.assertEqual(len(packets), 1)
        card = packets[0]["card"]
        self.assertEqual(card["header"]["title"]["content"], "业务一部 · 开标")
        self.assertIn("**采购人**", card["elements"][0]["content"])
        self.assertEqual(card["elements"][-1]["elements"][0]["content"], nc.CATEGORY_LABELS["stage_due"])

    def test_dispatch_in_app_desktop_aggregation_webhook_retry_and_per_user_read(self):
        # Create 3 due projects so desktop aggregation triggers (>2 -> 1 aggregated popup)
        now = datetime(2026, 11, 24, 10, 0, 0)
        for idx in range(1, 4):
            p_resp = self.client.post(
                "/api/projects",
                json={"number": f"2026-NF-00{idx}", "name": f"紧急开标项目{idx}", "purchaser": "单位A", "method": "公开招标", "year": "2026"},
                headers=self._headers(),
            )
            pid = p_resp.get_json()["id"]
            self.client.put(
                f"/api/projects/{pid}/stages/bid_opening",
                json={"planned_at": now.strftime("%Y-%m-%dT10:30")},
                headers=self._headers(),
            )

        # Configure one webhook
        self.client.put(
            "/api/notifications/channels",
            json={
                "in_app_enabled": True,
                "desktop_popup_enabled": True,
                "quiet_hours_enabled": False,
                "webhooks": [
                    {
                        "id": "wh-1",
                        "name": "业务群",
                        "type": "feishu",
                        "enabled": True,
                        "webhook_url": "https://open.feishu.cn/open-apis/bot/v2/hook/test1",
                        "event_types": ["stage_due"],
                    }
                ],
            },
            headers=self._headers(),
        )

        # Dispatch with simulated failure first -> retry -> success
        desktop_calls = []
        sent_calls = []

        def fake_desktop(title, msg):
            desktop_calls.append((title, msg))
            return True

        def fail_transport(ctype, url, payload):
            return False, "simulated timeout"

        with self.app.app_context():
            res1 = nc.run_notification_dispatch(self.ctx, now=now, transport=fail_transport, desktop_notifier=fake_desktop)
            self.assertEqual(res1["created"], 3)
            self.assertTrue(res1["desktop_notified"])
            # >2 events aggregated into 1 tray notification!
            self.assertEqual(len(desktop_calls), 1)
            self.assertIn("共 3 条新提醒", desktop_calls[0][1])
            self.assertEqual(res1["failed"], 3)

            # Retry after 6 minutes succeeds without duplicating in-app notifications
            def ok_transport(ctype, url, payload):
                sent_calls.append((ctype, url, payload))
                return True, ""

            res2 = nc.run_notification_dispatch(
                self.ctx,
                now=now + timedelta(minutes=6),
                transport=ok_transport,
                desktop_notifier=fake_desktop,
            )
            self.assertEqual(res2["created"], 0)  # idempotent!
            self.assertEqual(res2["sent"], 3)
            self.assertEqual(len(sent_calls), 3)

        # Admin reads unread count and marks all read; viewer STILL sees 3 unread independently
        self.assertEqual(self.client.get("/api/notifications/unread-count").get_json()["unread_count"], 3)
        self.assertEqual(self.client.post("/api/notifications/read-all", json={}, headers=self._headers()).status_code, 200)
        self.assertEqual(self.client.get("/api/notifications/unread-count").get_json()["unread_count"], 0)

        self._login("viewer", "ViewerPass123456!")
        self.assertEqual(self.client.get("/api/notifications/unread-count").get_json()["unread_count"], 3)
        items = self.client.get("/api/notifications?scope=unread").get_json()["items"]
        self.assertEqual(len(items), 3)
        # Viewer marks 1 read
        self.assertEqual(self.client.post(f"/api/notifications/{items[0]['id']}/read", json={}, headers=self._headers()).status_code, 200)
        self.assertEqual(self.client.get("/api/notifications/unread-count").get_json()["unread_count"], 2)

    def test_desktop_notify_helper_handles_mock_tray_and_none(self):
        self.assertFalse(desktop_host_service.notify_desktop("标题", "消息", tray_icon=None))
        seen = []
        class FakeIcon:
            def notify(self, msg, title):
                seen.append((title, msg))
        self.assertTrue(desktop_host_service.notify_desktop("标题", "内容", tray_icon=FakeIcon()))
        self.assertEqual(seen, [("标题", "内容")])

    def test_dpapi_failure_aborts_save_and_preserves_old_secrets(self):
        import os
        from unittest import mock

        # Save an initial valid channel
        r1 = self.client.put(
            "/api/notifications/channels",
            json={
                "in_app_enabled": True,
                "desktop_popup_enabled": True,
                "webhooks": [{
                    "id": "wh-old",
                    "name": "旧通道",
                    "type": "wecom",
                    "enabled": True,
                    "webhook_url": "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=oldsecret",
                    "event_types": ["stage_due"],
                }],
            },
            headers=self._headers(),
        )
        self.assertEqual(r1.status_code, 200)
        old_blob = (self.data_dir / "notification_channel_secrets.dpapi").read_bytes()
        old_settings = (self.data_dir / "app_settings.json").read_text(encoding="utf-8")

        if os.name == "nt":
            from src.backend_patches import public_licensing
            with mock.patch.object(public_licensing, "_dpapi_protect", side_effect=OSError("DPAPI failed")):
                r2 = self.client.put(
                    "/api/notifications/channels",
                    json={
                        "in_app_enabled": True,
                        "desktop_popup_enabled": True,
                        "webhooks": [{
                            "id": "wh-new",
                            "name": "新通道",
                            "type": "wecom",
                            "enabled": True,
                            "webhook_url": "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=newsecret",
                            "event_types": ["stage_due"],
                        }],
                    },
                    headers=self._headers(),
                )
            self.assertEqual(r2.status_code, 500)
            # Old .dpapi and old app_settings.json MUST be untouched and NEVER contain PMSEC1 fallback
            new_blob = (self.data_dir / "notification_channel_secrets.dpapi").read_bytes()
            self.assertEqual(new_blob, old_blob)
            self.assertFalse(new_blob.startswith(b"PMSEC1:"))
            self.assertEqual((self.data_dir / "app_settings.json").read_text(encoding="utf-8"), old_settings)

    def test_ssrf_dns_redirect_and_response_size_guards(self):
        import urllib.error

        # 1. Custom host resolving to loopback MUST be rejected even with allow_custom_host=True
        fake_loopback = lambda host, port, type=0: [(2, 1, 6, "", ("127.0.0.1", port))]
        ok, err = nc.send_webhook(
            "feishu", "https://im.corp.example.com/hook", "标题", "正文",
            allow_custom_host=True, resolver=fake_loopback,
        )
        self.assertFalse(ok)
        self.assertIn("受限 IP", err)

        # 2. Link-local metadata IP MUST be rejected
        fake_meta = lambda host, port, type=0: [(2, 1, 6, "", ("169.254.169.254", port))]
        ok2, err2 = nc.send_webhook(
            "feishu", "https://im.corp.example.com/hook", "标题", "正文",
            allow_custom_host=True, resolver=fake_meta,
        )
        self.assertFalse(ok2)
        self.assertIn("受限 IP", err2)

        # 3. HTTP redirect MUST be rejected
        fake_public = lambda host, port, type=0: [(2, 1, 6, "", ("93.184.216.34", port))]
        class RedirectOpener:
            def open(self, req, timeout=5.0):
                raise urllib.error.HTTPError(req.full_url, 302, "Found", {}, None)
        ok3, err3 = nc.send_webhook(
            "wecom", "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=x", "标题", "正文",
            resolver=fake_public, opener=RedirectOpener(),
        )
        self.assertFalse(ok3)
        self.assertIn("重定向", err3)

        # 4. Oversized response (>64KB) MUST be rejected without unbounded read
        class HugeResp:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *a): return False
            def read(self, n=-1): return b"A" * (n if n > 0 else 100000)
        class HugeOpener:
            def open(self, req, timeout=5.0): return HugeResp()
        ok4, err4 = nc.send_webhook(
            "wecom", "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=x", "标题", "正文",
            resolver=fake_public, opener=HugeOpener(),
        )
        self.assertFalse(ok4)
        self.assertIn("64KB", err4)

    def test_soft_deleted_project_cancels_queued_webhook_hides_inbox_and_independent_desktop_dedup(self):
        import types

        # Quiet hours active at 23:00 -> enqueue webhook & in-app without sending
        quiet_time = datetime(2026, 11, 24, 23, 0, 0)
        active_time = datetime(2026, 11, 25, 9, 0, 0)
        p_resp = self.client.post(
            "/api/projects",
            json={"number": "2026-QDEL-001", "name": "免打扰待删项目", "purchaser": "单位Q", "method": "公开招标", "year": "2026"},
            headers=self._headers(),
        )
        pid = p_resp.get_json()["id"]
        self.client.put(
            f"/api/projects/{pid}/stages/bid_opening",
            json={"planned_at": "2026-11-24T10:00"},
            headers=self._headers(),
        )
        self.client.put(
            "/api/notifications/channels",
            json={
                "in_app_enabled": True,
                "desktop_popup_enabled": True,
                "quiet_hours_enabled": True,
                "quiet_start": "22:00",
                "quiet_end": "08:00",
                "webhooks": [{
                    "id": "wh-q",
                    "name": "测试群",
                    "type": "wecom",
                    "enabled": True,
                    "webhook_url": "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=qtest",
                    "event_types": ["stage_due"],
                }],
            },
            headers=self._headers(),
        )
        sent = []
        with self.app.app_context():
            nc.run_notification_dispatch(self.ctx, now=quiet_time, transport=lambda *a: (sent.append(a) or (True, "")))
        self.assertEqual(len(sent), 0)
        self.assertEqual(self.client.get("/api/notifications/unread-count").get_json()["unread_count"], 1)

        # Move project to recycle bin BEFORE quiet hours end
        del_r = self.client.delete(f"/api/projects/{pid}", headers=self._headers())
        self.assertEqual(del_r.status_code, 200)
        rid = del_r.get_json()["recycle_id"]

        # In-app unread count & listing immediately hide the deleted project's notification
        self.assertEqual(self.client.get("/api/notifications/unread-count").get_json()["unread_count"], 0)
        self.assertEqual(self.client.get("/api/notifications").get_json()["items"], [])

        # After quiet hours end, dispatch MUST skip queued webhook & desktop deliveries for the deleted project
        # Also verify legacy module context works!
        with self.app.app_context():
            legacy_mod = types.ModuleType("legacy_server_app")
            for k in ("app", "db", "Project", "DATA_DIR", "load_app_settings"):
                setattr(legacy_mod, k, self.ctx.get(k))
            nc.run_notification_dispatch(legacy_mod, now=active_time, transport=lambda *a: (sent.append(a) or (True, "")))
            self.assertEqual(len(sent), 0)
            st_row = self.db.session.execute(
                text("SELECT status FROM notification_channel_deliveries WHERE channel_id='wh-q'")
            ).first()
            self.assertEqual(st_row[0], "skipped")

        # Restoring project brings back its in-app notification
        self.assertEqual(self.client.post(f"/api/recycle-bin/{rid}/restore", json={}, headers=self._headers()).status_code, 200)
        self.assertEqual(self.client.get("/api/notifications/unread-count").get_json()["unread_count"], 1)

        # Test independent desktop dedup when in_app_enabled=False + real supplier_shortage category + admin-only scan
        p2 = self.client.post(
            "/api/projects",
            json={"number": "2026-DESK-002", "name": "桌面独立去重项目", "purchaser": "单位D", "method": "公开招标", "year": "2026"},
            headers=self._headers(),
        ).get_json()
        pid2 = p2["id"]
        self.client.put(
            f"/api/projects/{pid2}/stages/registration_end",
            json={"planned_at": "2026-11-26T10:00"},
            headers=self._headers(),
        )
        self.client.put(
            "/api/notifications/channels",
            json={
                "in_app_enabled": False,
                "desktop_popup_enabled": True,
                "quiet_hours_enabled": False,
                "webhooks": [],
            },
            headers=self._headers(),
        )
        cats = [c["key"] for c in self.client.get("/api/notifications/channels").get_json()["categories"]]
        self.assertEqual(cats, ["stage_due", "guarantee", "deadline", "supplier_shortage"])

        desk_calls = []
        with self.app.app_context():
            r_d1 = nc.run_notification_dispatch(
                self.ctx,
                now=datetime(2026, 11, 25, 10, 0, 0),
                desktop_notifier=lambda t, m: (desk_calls.append((t, m)) or True),
            )
            self.assertTrue(r_d1["desktop_notified"])
            self.assertGreaterEqual(len(desk_calls), 1)
            # Second run MUST NOT re-fire desktop popup even though in_app_enabled is False
            r_d2 = nc.run_notification_dispatch(
                self.ctx,
                now=datetime(2026, 11, 25, 10, 5, 0),
                desktop_notifier=lambda t, m: (desk_calls.append((t, m)) or True),
            )
            self.assertFalse(r_d2["desktop_notified"])
            # Supplier shortage event was generated
            ss_row = self.db.session.execute(
                text("SELECT COUNT(*) FROM notification_channel_deliveries WHERE category='supplier_shortage' AND project_id=:pid"),
                {"pid": pid2},
            ).scalar()
            self.assertGreaterEqual(int(ss_row or 0), 1)

        # Viewer MUST get 403 on POST /api/notifications/scan
        self._login("viewer", "ViewerPass123456!")
        self.assertEqual(self.client.post("/api/notifications/scan", json={}, headers=self._headers()).status_code, 403)

    def test_partial_channel_save_preserves_other_section_and_pinned_ip_tls_proxy_behavior(self):
        import os
        import socket
        import ssl
        from unittest import mock

        # 1. Partial save: save webhook first, then update toggles WITHOUT sending webhooks -> webhook & secret preserved!
        r1 = self.client.put(
            "/api/notifications/channels",
            json={
                "in_app_enabled": True,
                "desktop_popup_enabled": True,
                "quiet_hours_enabled": False,
                "quiet_start": "22:00",
                "quiet_end": "08:00",
                "webhooks": [{
                    "id": "wh-keep",
                    "name": "核心业务群",
                    "type": "wecom",
                    "enabled": True,
                    "webhook_url": "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=keep9999",
                    "event_types": ["stage_due"],
                }],
            },
            headers=self._headers(),
        )
        self.assertEqual(r1.status_code, 200)

        # Update ONLY toggles (omit 'webhooks') -> webhook MUST stay intact!
        r2 = self.client.put(
            "/api/notifications/channels",
            json={"in_app_enabled": True, "desktop_popup_enabled": False, "quiet_hours_enabled": True, "quiet_start": "21:00", "quiet_end": "07:30"},
            headers=self._headers(),
        )
        self.assertEqual(r2.status_code, 200)
        cfg2 = r2.get_json()["config"]
        self.assertEqual(len(cfg2["webhooks"]), 1)
        self.assertEqual(cfg2["webhooks"][0]["id"], "wh-keep")
        self.assertTrue(cfg2["webhooks"][0]["has_webhook_url"])
        self.assertEqual(cfg2["quiet_start"], "21:00")

        # Update ONLY webhooks (omit toggles) -> quiet_start MUST stay '21:00'!
        r3 = self.client.put(
            "/api/notifications/channels",
            json={"webhooks": [{"id": "wh-keep", "name": "核心业务群", "type": "wecom", "enabled": False, "event_types": ["stage_due"]}]},
            headers=self._headers(),
        )
        self.assertEqual(r3.status_code, 200)
        cfg3 = r3.get_json()["config"]
        self.assertEqual(cfg3["quiet_start"], "21:00")
        self.assertFalse(cfg3["desktop_popup_enabled"])
        self.assertFalse(cfg3["webhooks"][0]["enabled"])

        # 2. Pinned IP connection + preserved TLS server_hostname + ambient HTTPS_PROXY ignored
        connect_calls = []
        tls_hostnames = []

        class FakeRawSock:
            def close(self): pass
            def settimeout(self, t): pass

        class FakeTLSSock:
            def __init__(self):
                self._buf = b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 13\r\nConnection: close\r\n\r\n{\"errcode\":0}"
                self._pos = 0
            def sendall(self, data): pass
            def makefile(self, mode, *a, **kw):
                import io
                return io.BytesIO(self._buf)
            def close(self): pass

        def fake_create_connection(addr, timeout=None, source_address=None):
            connect_calls.append(addr)
            return FakeRawSock()

        def fake_wrap_socket(self_ctx, sock, server_hostname=None, **kw):
            tls_hostnames.append((server_hostname, self_ctx.check_hostname, self_ctx.verify_mode))
            return FakeTLSSock()

        fake_resolver = lambda host, port, type=0: [(2, 1, 6, "", ("101.226.103.11", port))]
        with mock.patch.dict(os.environ, {"HTTPS_PROXY": "http://127.0.0.1:18080", "HTTP_PROXY": "http://127.0.0.1:18080"}):
            with mock.patch.object(socket, "create_connection", side_effect=fake_create_connection):
                with mock.patch.object(ssl.SSLContext, "wrap_socket", autospec=True, side_effect=fake_wrap_socket):
                    ok, err = nc.send_webhook(
                        "wecom",
                        "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=pin",
                        "连接绑定测试",
                        "正文",
                        resolver=fake_resolver,
                    )
        self.assertTrue(ok, err)
        # TCP socket MUST connect directly to the verified pinned IP (never 127.0.0.1:18080 proxy or unresolved hostname!)
        self.assertEqual(connect_calls, [("101.226.103.11", 443)])
        # TLS MUST validate certificate against original hostname with CERT_REQUIRED
        self.assertEqual(len(tls_hostnames), 1)
        self.assertEqual(tls_hostnames[0][0], "qyapi.weixin.qq.com")
        self.assertTrue(tls_hostnames[0][1])
        self.assertEqual(tls_hostnames[0][2], ssl.CERT_REQUIRED)

    def test_legacy_compat_desktop_bridge_and_deadline_confirmation_rules_and_shortage_target(self):
        import types
        from src.backend_patches import runtime_context

        # 1. Verify legacy compatibility runtime_context.register_runtime_context desktop_bridge reaches BOTH test API & scheduler
        tray_calls = []
        self.app.extensions.pop("desktop_bridge", None)
        legacy_host = types.ModuleType("compat_server_app")
        for k in ("app", "db", "Project", "User", "DATA_DIR", "load_app_settings", "STAGES", "METHODS"):
            setattr(legacy_host, k, self.ctx.get(k))
        runtime_context.register_runtime_context(
            legacy_host,
            app=self.app,
            db=self.db,
            desktop_bridge={"notify": lambda title, msg: (tray_calls.append((title, msg)) or True)},
        )
        t_resp = self.client.post("/api/notifications/channels/desktop/test", json={}, headers=self._headers())
        self.assertEqual(t_resp.status_code, 200, t_resp.get_data(as_text=True))
        self.assertEqual(len(tray_calls), 1)

        # 2. Verify pending business deadline does NOT fire official due alert; confirmed+needs_review emits 【需复核】; supplier_shortage uses valid board tab
        now = datetime(2026, 11, 24, 10, 0, 0)
        p = self.client.post(
            "/api/projects",
            json={"number": "2026-DL-CHECK", "name": "期限口径测试项目", "purchaser": "单位L", "method": "公开招标", "year": "2026"},
            headers=self._headers(),
        ).get_json()
        pid = p["id"]
        self.client.put(
            f"/api/projects/{pid}/stages/registration_end",
            json={"planned_at": "2026-11-25T10:00"},
            headers=self._headers(),
        )
        with self.app.app_context():
            # Insert 3 business_deadline_items: pending (unconfirmed), confirmed+needs_review, confirmed+valid
            self.db.session.execute(
                text(
                    "INSERT INTO business_deadline_items(id, project_id, revision, state, payload) VALUES "
                    "('dl-pending', :pid, 1, 'pending', :p1),"
                    "('dl-review', :pid, 1, 'confirmed', :p2),"
                    "('dl-confirmed', :pid, 1, 'confirmed', :p3)"
                ),
                {
                    "pid": pid,
                    "p1": '{"id":"dl-pending","state":"pending","needs_review":false,"title":"未确认草稿期限","confirmed_deadline":"","calculation":{"deadline":"2026-11-24"}}',
                    "p2": '{"id":"dl-review","state":"confirmed","needs_review":true,"title":"待复核期限","confirmed_deadline":"2026-11-24","review_reason":"日历变化"}',
                    "p3": '{"id":"dl-confirmed","state":"confirmed","needs_review":false,"title":"已确认正式期限","confirmed_deadline":"2026-11-24"}',
                },
            )
            self.db.session.commit()
            res = nc.run_notification_dispatch(legacy_host, now=now)
            self.assertTrue(res["desktop_notified"])
            self.assertGreaterEqual(len(tray_calls), 2)

        items = self.client.get("/api/notifications").get_json()["items"]
        titles = [it["title"] for it in items]
        self.assertFalse(any("未确认草稿期限" in t for t in titles), f"Pending item leaked: {titles}")
        review_item = next((it for it in items if "待复核期限" in it["title"]), None)
        self.assertIsNotNone(review_item)
        self.assertTrue(review_item["title"].startswith("【需复核】"), review_item["title"])
        confirmed_item = next((it for it in items if "已确认正式期限" in it["title"]), None)
        self.assertIsNotNone(confirmed_item)
        self.assertTrue(confirmed_item["title"].startswith("【今日截止】"), confirmed_item["title"])

        shortage_item = next((it for it in items if it["category"] == "supplier_shortage"), None)
        self.assertIsNotNone(shortage_item)
        self.assertEqual(shortage_item["target"].get("tab"), "board")
        self.assertEqual(shortage_item["target"].get("stage_key"), "registration_end")

    def test_settings_save_failure_rolls_back_webhook_credentials_atomically(self):
        import os
        from unittest import mock

        # 1. Save two channels with URLs & secrets
        init_resp = self.client.put(
            "/api/notifications/channels",
            json={
                "webhooks": [
                    {
                        "id": "wh-del",
                        "name": "待删机器人",
                        "type": "wecom",
                        "enabled": True,
                        "webhook_url": "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=del1111",
                        "event_types": ["stage_due"],
                    },
                    {
                        "id": "wh-keep",
                        "name": "保留机器人",
                        "type": "dingtalk",
                        "enabled": True,
                        "webhook_url": "https://oapi.dingtalk.com/robot/send?access_token=keep2222",
                        "secret": "SECkeepsecret",
                        "event_types": ["guarantee"],
                    },
                ]
            },
            headers=self._headers(),
        )
        self.assertEqual(init_resp.status_code, 200)

        # 2. Simulate settings file replacement failing while deleting wh-del -> HTTP 500 AND credentials intact!
        real_replace = os.replace
        def _fail_settings_replace(src, dst):
            if str(dst).endswith("app_settings.json"):
                raise OSError("Simulated settings replace failure")
            return real_replace(src, dst)

        with mock.patch.object(os, "replace", side_effect=_fail_settings_replace):
            fail_resp = self.client.put(
                "/api/notifications/channels",
                json={
                    "webhooks": [{
                        "id": "wh-keep",
                        "name": "保留机器人",
                        "type": "dingtalk",
                        "enabled": True,
                        "webhook_url": "https://oapi.dingtalk.com/robot/send?access_token=edited9999",
                        "event_types": ["guarantee"],
                    }]
                },
                headers=self._headers(),
            )
        self.assertEqual(fail_resp.status_code, 500)

        # Both original channels MUST still be listed with has_webhook_url=True and exact original secrets!
        after = self.client.get("/api/notifications/channels").get_json()["config"]["webhooks"]
        self.assertEqual(len(after), 2)
        by_id = {w["id"]: w for w in after}
        self.assertTrue(by_id["wh-del"]["has_webhook_url"])
        self.assertTrue(by_id["wh-keep"]["has_webhook_url"])
        self.assertTrue(by_id["wh-keep"]["has_secret"])
        secrets = nc.load_channel_secrets(self.ctx)
        self.assertIn("del1111", secrets["wh-del"]["webhook_url"])
        self.assertIn("keep2222", secrets["wh-keep"]["webhook_url"])
        self.assertEqual(secrets["wh-keep"]["secret"], "SECkeepsecret")

        # 3. Simulate Phase 3 (secrets write) failing after settings commit -> both settings & secrets roll back cleanly!
        save_calls = {"n": 0}
        def _fail_phase3_secret_write(ctx_arg, smap):
            save_calls["n"] += 1
            raise RuntimeError("Simulated phase-3 secret write failure")

        with mock.patch.object(nc, "save_channel_secrets", side_effect=_fail_phase3_secret_write):
            fail_phase3 = self.client.put(
                "/api/notifications/channels",
                json={"webhooks": [{"id": "wh-keep", "name": "保留机器人", "type": "dingtalk", "enabled": True, "event_types": ["guarantee"]}]},
                headers=self._headers(),
            )
        self.assertEqual(fail_phase3.status_code, 500)
        after3 = self.client.get("/api/notifications/channels").get_json()["config"]["webhooks"]
        self.assertEqual(len(after3), 2)
        self.assertTrue(all(w["has_webhook_url"] for w in after3))

    def test_dispatch_and_test_send_never_read_uncommitted_webhook_url_before_rollback(self):
        import os
        import threading
        from unittest import mock

        # 1. Commit initial webhook URL ('committedOLD')
        committed_url = "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=committedOLD"
        uncommitted_url = "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=uncommittedNEW"
        r_init = self.client.put(
            "/api/notifications/channels",
            json={
                "webhooks": [{
                    "id": "wh-iso",
                    "name": "事务隔离群",
                    "type": "wecom",
                    "enabled": True,
                    "webhook_url": committed_url,
                    "event_types": ["stage_due"],
                }]
            },
            headers=self._headers(),
        )
        self.assertEqual(r_init.status_code, 200)

        # Create a due project so run_notification_dispatch has a real queued message to send
        now = datetime(2026, 11, 25, 10, 0, 0)
        proj = self.client.post(
            "/api/projects",
            json={"number": "2026-TXISO-1", "name": "投递隔离项目", "purchaser": "单位T", "method": "公开招标", "year": "2026"},
            headers=self._headers(),
        ).get_json()
        self.client.put(
            f"/api/projects/{proj['id']}/stages/bid_opening",
            json={"planned_at": "2026-11-25T10:30"},
            headers=self._headers(),
        )

        sent_urls: list[str] = []
        def _fake_transport(channel_type, target_url, payload):
            sent_urls.append(target_url)
            return True, ""

        self.app.extensions["notification_test_transport"] = _fake_transport
        in_save_event = threading.Event()
        proceed_fail_event = threading.Event()
        real_replace = os.replace
        disk_secret_during_save = {}

        def _fail_settings_and_coord(src, dst):
            if str(dst).endswith("app_settings.json"):
                # Verify .dpapi on disk has NOT been overwritten with uncommittedNEW before settings commit!
                disk_secret_during_save["url"] = (nc.load_channel_secrets(self.ctx).get("wh-iso") or {}).get("webhook_url")
                in_save_event.set()
                proceed_fail_event.wait(timeout=5)
                raise OSError("Simulated settings write failure")
            return real_replace(src, dst)

        put_status = {}
        def _put_worker():
            c = self.app.test_client()
            c.post("/login", data={"username": "admin", "password": "AdminPass123456!"})
            tok = (c.post("/api/csrf-refresh").get_json() or {}).get("csrf_token", "")
            resp = c.put(
                "/api/notifications/channels",
                json={
                    "webhooks": [{
                        "id": "wh-iso",
                        "name": "事务隔离群",
                        "type": "wecom",
                        "enabled": True,
                        "webhook_url": uncommitted_url,
                        "event_types": ["stage_due"],
                    }]
                },
                headers={"X-CSRFToken": tok},
            )
            put_status["code"] = resp.status_code

        dispatch_done = {}
        def _dispatch_and_test_worker():
            in_save_event.wait(timeout=5)
            # Launch test send & background dispatch while PUT is mid-flight; allow PUT to fail & release lock
            c2 = self.app.test_client()
            c2.post("/login", data={"username": "admin", "password": "AdminPass123456!"})
            tok2 = (c2.post("/api/csrf-refresh").get_json() or {}).get("csrf_token", "")
            proceed_fail_event.set()
            t_res = c2.post("/api/notifications/channels/wh-iso/test", json={}, headers={"X-CSRFToken": tok2})
            with self.app.app_context():
                d_res = nc.run_notification_dispatch(self.ctx, now=now, transport=_fake_transport)
            dispatch_done["test_code"] = t_res.status_code
            dispatch_done["sent"] = d_res["sent"]

        with mock.patch.object(os, "replace", side_effect=_fail_settings_and_coord):
            t_put = threading.Thread(target=_put_worker)
            t_disp = threading.Thread(target=_dispatch_and_test_worker)
            t_put.start()
            t_disp.start()
            t_put.join(timeout=10)
            t_disp.join(timeout=10)

        self.assertEqual(put_status.get("code"), 500)
        self.assertEqual(disk_secret_during_save.get("url"), committed_url)
        self.assertEqual(dispatch_done.get("test_code"), 200)
        self.assertEqual(dispatch_done.get("sent"), 1)
        # Neither test send nor background dispatch may EVER send to uncommittedNEW!
        self.assertGreaterEqual(len(sent_urls), 2)
        self.assertTrue(all(u == committed_url for u in sent_urls), f"Uncommitted URL leaked to sender: {sent_urls}")

    def test_concurrent_channel_saves_and_rollback_stay_consistent(self):
        import os
        import threading
        import time
        from unittest import mock

        # Create two independent logged-in admin test clients
        clients = []
        for _ in range(2):
            c = self.app.test_client()
            c.post("/login", data={"username": "admin", "password": "AdminPass123456!"})
            tok = (c.post("/api/csrf-refresh").get_json() or {}).get("csrf_token", "")
            clients.append((c, {"X-CSRFToken": tok}))

        # Seed initial bot so Phase 3 prune path is always exercised
        r0 = self.client.put(
            "/api/notifications/channels",
            json={
                "webhooks": [{
                    "id": "wh-init",
                    "name": "初始群",
                    "type": "wecom",
                    "enabled": True,
                    "webhook_url": "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=init0000",
                    "event_types": ["stage_due"],
                }]
            },
            headers=self._headers(),
        )
        self.assertEqual(r0.status_code, 200)

        # 1. Interleaved concurrent PUTs from two admin clients with artificial delay in settings replace
        real_replace = os.replace
        def _slow_settings_replace(src, dst):
            if str(dst).endswith("app_settings.json"):
                time.sleep(0.02)
            return real_replace(src, dst)

        errors = []
        statuses = []
        barrier = threading.Barrier(2)

        def _worker(idx: int):
            c, hdrs = clients[idx]
            bot_id = f"wh-worker-{idx}"
            url = f"https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=worker{idx}key999"
            try:
                for step in range(4):
                    barrier.wait(timeout=5)
                    resp = c.put(
                        "/api/notifications/channels",
                        json={
                            "webhooks": [{
                                "id": f"{bot_id}-{step}",
                                "name": f"并发群{idx}-{step}",
                                "type": "wecom",
                                "enabled": True,
                                "webhook_url": url,
                                "event_types": ["stage_due"],
                            }]
                        },
                        headers=hdrs,
                    )
                    statuses.append(resp.status_code)
            except Exception as exc:
                errors.append(exc)

        with mock.patch.object(os, "replace", side_effect=_slow_settings_replace):
            threads = [threading.Thread(target=_worker, args=(i,)) for i in range(2)]
            for t in threads:
                t.start()
            for t in threads:
                t.join(timeout=15)

        self.assertEqual(errors, [])
        self.assertTrue(all(s == 200 for s in statuses), f"Unexpected statuses: {statuses}")
        final_wh = self.client.get("/api/notifications/channels").get_json()["config"]["webhooks"]
        self.assertEqual(len(final_wh), 1)
        self.assertTrue(final_wh[0]["has_webhook_url"], f"Config/secrets mismatch after concurrent saves: {final_wh}")
        final_sec = nc.load_channel_secrets(self.ctx)
        self.assertIn(final_wh[0]["id"], final_sec)
        self.assertTrue(final_sec[final_wh[0]["id"]]["webhook_url"])

        # 2. Concurrent failing save (rollback) interleaved with succeeding save must leave consistent secrets!
        fail_flag = {"should_fail_for_bot": "wh-fail-rb"}
        orig_save = self.ctx.get("save_app_settings")
        # Intercept settings replacement when payload contains 'wh-fail-rb'
        def _flaky_replace(src, dst):
            if str(dst).endswith("app_settings.json"):
                time.sleep(0.015)
                try:
                    content = Path(src).read_text(encoding="utf-8")
                    if fail_flag["should_fail_for_bot"] in content:
                        raise OSError("Simulated concurrent settings failure")
                except OSError:
                    raise
                except Exception:
                    pass
            return real_replace(src, dst)

        rb_statuses = {}
        barrier2 = threading.Barrier(2)

        def _fail_worker():
            c, hdrs = clients[0]
            barrier2.wait(timeout=5)
            resp = c.put(
                "/api/notifications/channels",
                json={
                    "webhooks": [{
                        "id": "wh-fail-rb",
                        "name": "失败回滚群",
                        "type": "wecom",
                        "enabled": True,
                        "webhook_url": "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=failrb111",
                        "event_types": ["stage_due"],
                    }]
                },
                headers=hdrs,
            )
            rb_statuses["fail"] = resp.status_code

        def _ok_worker():
            c, hdrs = clients[1]
            barrier2.wait(timeout=5)
            resp = c.put(
                "/api/notifications/channels",
                json={
                    "webhooks": [{
                        "id": "wh-ok-concurrent",
                        "name": "成功并发群",
                        "type": "wecom",
                        "enabled": True,
                        "webhook_url": "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=okconc222",
                        "event_types": ["stage_due"],
                    }]
                },
                headers=hdrs,
            )
            rb_statuses["ok"] = resp.status_code

        with mock.patch.object(os, "replace", side_effect=_flaky_replace):
            t1 = threading.Thread(target=_fail_worker)
            t2 = threading.Thread(target=_ok_worker)
            t1.start()
            t2.start()
            t1.join(timeout=15)
            t2.join(timeout=15)

        self.assertEqual(rb_statuses.get("fail"), 500)
        self.assertEqual(rb_statuses.get("ok"), 200)
        after_rb = self.client.get("/api/notifications/channels").get_json()["config"]["webhooks"]
        self.assertEqual(len(after_rb), 1)
        self.assertEqual(after_rb[0]["id"], "wh-ok-concurrent")
        self.assertTrue(after_rb[0]["has_webhook_url"])


if __name__ == "__main__":
    unittest.main()
