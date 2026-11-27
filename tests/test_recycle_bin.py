"""Comprehensive backend tests for recycle bin (soft delete, isolation, restore, purge)."""
from __future__ import annotations

from datetime import datetime, timedelta
from pathlib import Path
import tempfile
import unittest

from sqlalchemy import text

from src.backend_patches import recycle_bin
from src.project_manager.standalone_app import create_app


class RecycleBinTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._cleanup_resources)
        self.data_dir = Path(self.tmp.name) / "data"
        self.app = create_app(data_dir=self.data_dir, public_unrestricted=True)
        self.app.config["TESTING"] = True
        self.client = self.app.test_client()
        self.ctx = self.app.extensions["runtime_context"]
        self.db = self.ctx["db"]
        self._create_admin_and_login()

    def _cleanup_resources(self):
        try:
            with self.app.app_context():
                self.db.session.remove()
                self.db.engine.dispose()
        except Exception:
            pass
        self.tmp.cleanup()

    def _create_admin_and_login(self):
        from werkzeug.security import generate_password_hash

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
                display_name="只读成员",
            )
            editor = User(
                username="editor",
                password_hash=generate_password_hash("EditorPass123456!"),
                is_admin=False,
                is_active=True,
                display_name="协作编辑",
            )
            self.db.session.add_all([admin, viewer, editor])
            self.db.session.commit()
            self.admin_id = admin.id
            self.viewer_id = viewer.id
            self.editor_id = editor.id
            self.db.session.execute(
                text("INSERT INTO account_permissions(user_id, role, permissions) VALUES (:uid, 'viewer', :perms)"),
                {"uid": viewer.id, "perms": '{"create_projects":false,"edit_projects":false,"delete_projects":false,"manage_attachments":false,"export_data":true}'},
            )
            self.db.session.execute(
                text("INSERT INTO account_permissions(user_id, role, permissions) VALUES (:uid, 'editor', :perms)"),
                {"uid": editor.id, "perms": '{"create_projects":true,"edit_projects":true,"delete_projects":false,"manage_attachments":true,"export_data":true}'},
            )
            self.db.session.commit()

        self._login("admin", "AdminPass123456!")

    def _login(self, username, password):
        resp = self.client.post("/login", data={"username": username, "password": password})
        self.assertIn(resp.status_code, (200, 302))
        tok_resp = self.client.post("/api/csrf-refresh")
        if tok_resp.status_code == 200:
            self.csrf = (tok_resp.get_json() or {}).get("csrf_token", "")
        else:
            with self.client.session_transaction() as sess:
                self.csrf = sess.get("csrf_token", "")

    def _headers(self):
        return {"X-CSRFToken": self.csrf}

    def _create_project(self, number="2026-RB-001", name="回收站测试项目"):
        resp = self.client.post(
            "/api/projects",
            json={"number": number, "name": name, "purchaser": "测试采购单位", "method": "公开招标", "year": "2026"},
            headers=self._headers(),
        )
        self.assertEqual(resp.status_code, 201, resp.get_data(as_text=True))
        return resp.get_json()

    def test_project_soft_delete_isolation_number_reuse_and_restore_conflict(self):
        proj = self._create_project("2026-RB-001", "一期项目")
        pid = proj["id"]

        # Upload an attachment so we verify physical file stays on soft-delete
        import io
        upload_resp = self.client.post(
            f"/api/projects/{pid}/attachments",
            data={"files": (io.BytesIO(b"recycle-bin-sample-content"), "sample.txt")},
            headers=self._headers(),
            content_type="multipart/form-data",
        )
        self.assertIn(upload_resp.status_code, (200, 201), upload_resp.get_data(as_text=True))
        up_json = upload_resp.get_json()
        att = up_json[0] if isinstance(up_json, list) else (up_json.get("uploaded") or [up_json])[0]
        att_id = att["id"]
        with self.app.app_context():
            Attachment = self.ctx["Attachment"]
            att_row = self.db.session.get(Attachment, att_id)
            stored_file = self.ctx["UPLOAD_FOLDER"] / att_row.file_path
            self.assertTrue(stored_file.exists())

        # Soft delete project
        del_resp = self.client.delete(
            f"/api/projects/{pid}",
            json={"reason": "误建测试"},
            headers=self._headers(),
        )
        self.assertEqual(del_resp.status_code, 200)
        body = del_resp.get_json()
        self.assertTrue(body["ok"])
        self.assertTrue(body["soft_deleted"])
        recycle_id = body["recycle_id"]

        # Physical file preserved while in recycle bin
        self.assertTrue(stored_file.exists())

        # Full isolation across list, detail, stats, export, calendar, attachment download
        self.assertEqual(self.client.get("/api/projects").get_json(), [])
        self.assertEqual(self.client.get(f"/api/projects/{pid}").status_code, 404)
        self.assertEqual(self.client.get(f"/api/attachments/{att_id}/download").status_code, 404)
        stats = self.client.get("/api/stats").get_json()
        self.assertEqual(stats["total"], 0)
        self.assertEqual(self.client.get("/api/export-years").get_json()["years"], [])

        # Number was released -> creating a new project with the same number succeeds
        new_proj = self._create_project("2026-RB-001", "重名新项目")
        self.assertNotEqual(new_proj["id"], pid)

        # Recycle bin lists the soft-deleted project
        rb_resp = self.client.get("/api/recycle-bin").get_json()
        self.assertEqual(rb_resp["total"], 1)
        self.assertEqual(rb_resp["counts"]["project"], 1)
        self.assertEqual(rb_resp["items"][0]["delete_reason"], "误建测试")

        # Restoring without new_number hits 409 number_conflict
        conflict = self.client.post(f"/api/recycle-bin/{recycle_id}/restore", json={}, headers=self._headers())
        self.assertEqual(conflict.status_code, 409)
        self.assertEqual(conflict.get_json()["code"], "number_conflict")

        # Restoring with a new_number succeeds and brings back project + attachment
        restored = self.client.post(
            f"/api/recycle-bin/{recycle_id}/restore",
            json={"new_number": "2026-RB-001-RESTORED"},
            headers=self._headers(),
        )
        self.assertEqual(restored.status_code, 200)
        self.assertEqual(restored.get_json()["number"], "2026-RB-001-RESTORED")

        detail = self.client.get(f"/api/projects/{pid}")
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.get_json()["number"], "2026-RB-001-RESTORED")
        self.assertEqual(len(detail.get_json()["attachments"]), 1)

    def test_attachment_complaint_clarification_soft_delete_restore_and_purge(self):
        proj = self._create_project("2026-RB-002", "子资源回收测试")
        pid = proj["id"]

        # Upload attachment and soft-delete it
        import io
        up = self.client.post(
            f"/api/projects/{pid}/attachments",
            data={"files": (io.BytesIO(b"doc-recycle-content"), "doc.txt")},
            headers=self._headers(),
            content_type="multipart/form-data",
        )
        self.assertIn(up.status_code, (200, 201), up.get_data(as_text=True))
        up_json = up.get_json()
        att_obj = up_json[0] if isinstance(up_json, list) else (up_json.get("uploaded") or [up_json])[0]
        att_id = att_obj["id"]
        with self.app.app_context():
            att_row = self.db.session.get(self.ctx["Attachment"], att_id)
            att_path = self.ctx["UPLOAD_FOLDER"] / att_row.file_path

        del_att = self.client.delete(f"/api/attachments/{att_id}", headers=self._headers())
        self.assertEqual(del_att.status_code, 200)
        att_recycle_id = del_att.get_json()["recycle_id"]
        self.assertTrue(att_path.exists())
        self.assertEqual(self.client.get(f"/api/projects/{pid}/attachments").get_json(), [])
        self.assertEqual(self.client.get(f"/api/attachments/{att_id}/download").status_code, 404)

        # Create & soft-delete complaint
        comp = self.client.post(
            f"/api/projects/{pid}/complaints",
            json={"complaint_type": "质疑", "challenger": "测试供应商", "content": "内容"},
            headers=self._headers(),
        ).get_json()
        cid = comp["id"]
        del_comp = self.client.delete(f"/api/projects/{pid}/complaints/{cid}", headers=self._headers())
        self.assertEqual(del_comp.status_code, 200)
        self.assertEqual(self.client.get(f"/api/projects/{pid}/complaints").get_json(), [])

        # Create & soft-delete clarification
        clar = self.client.post(
            f"/api/projects/{pid}/clarifications",
            json={"clarification_type": "澄清", "title": "答疑1", "content": "说明"},
            headers=self._headers(),
        ).get_json()
        clid = clar["id"]
        del_clar = self.client.delete(f"/api/projects/{pid}/clarifications/{clid}", headers=self._headers())
        self.assertEqual(del_clar.status_code, 200)
        self.assertEqual(self.client.get(f"/api/projects/{pid}").get_json()["clarifications"], [])

        # Viewer cannot restore or purge
        self._login("viewer", "ViewerPass123456!")
        self.assertEqual(
            self.client.post(f"/api/recycle-bin/{att_recycle_id}/restore", headers=self._headers()).status_code,
            403,
        )
        self.assertEqual(
            self.client.delete(f"/api/recycle-bin/{att_recycle_id}", headers=self._headers()).status_code,
            403,
        )

        # Admin permanently purges the attachment -> physical file removed
        self._login("admin", "AdminPass123456!")
        purge = self.client.delete(f"/api/recycle-bin/{att_recycle_id}", headers=self._headers())
        self.assertEqual(purge.status_code, 200)
        self.assertFalse(att_path.exists())

    def test_auto_purge_expired_items_and_retention_setting(self):
        # Update retention setting
        upd = self.client.patch(
            "/api/settings",
            json={"recycle_bin_retention_days": 15},
            headers=self._headers(),
        )
        self.assertEqual(upd.status_code, 200)
        self.assertEqual(self.client.get("/api/settings").get_json()["recycle_bin_retention_days"], 15)

        proj = self._create_project("2026-RB-EXP", "过期清理测试")
        pid = proj["id"]
        del_resp = self.client.delete(f"/api/projects/{pid}", headers=self._headers())
        rid = del_resp.get_json()["recycle_id"]

        # Backdate purge_after into the past
        with self.app.app_context():
            past = (datetime.now() - timedelta(days=1)).isoformat(timespec="seconds")
            self.db.session.execute(
                text("UPDATE recycle_bin_items SET purge_after=:p WHERE id=:id"),
                {"p": past, "id": rid},
            )
            self.db.session.commit()
            res = recycle_bin.purge_expired_items(self.ctx, force=True)
            self.assertEqual(res["purged"], 1)
            self.assertIsNone(self.db.session.get(self.ctx["Project"], pid))

    def test_exports_and_signed_downloads_isolate_soft_deleted_projects_and_child_attachments(self):
        import io
        import time
        import zipfile
        from src.backend_patches import signed_attachments

        proj_a = self._create_project("2026-EXP-A", "正常保留项目A")
        proj_b = self._create_project("2026-EXP-B", "已删隔离项目B")
        pid_a, pid_b = proj_a["id"], proj_b["id"]

        # Add registrations to both projects
        r_a = self.client.post(
            f"/api/projects/{pid_a}/registrations",
            json={"company_name": "保留供应商甲"},
            headers=self._headers(),
        )
        self.assertIn(r_a.status_code, (200, 201))
        r_b = self.client.post(
            f"/api/projects/{pid_b}/registrations",
            json={"company_name": "已删项目供应商乙"},
            headers=self._headers(),
        )
        self.assertIn(r_b.status_code, (200, 201))

        # Upload a normal attachment + a soft-deleted attachment + a complaint attachment on project A
        up_keep = self.client.post(
            f"/api/projects/{pid_a}/attachments",
            data={"files": (io.BytesIO(b"keep-content"), "保留附件.txt")},
            headers=self._headers(),
            content_type="multipart/form-data",
        ).get_json()
        keep_att = (up_keep.get("uploaded") or up_keep)[0]

        up_del = self.client.post(
            f"/api/projects/{pid_a}/attachments",
            data={"files": (io.BytesIO(b"del-content"), "已删单附件.txt")},
            headers=self._headers(),
            content_type="multipart/form-data",
        ).get_json()
        del_att = (up_del.get("uploaded") or up_del)[0]

        comp = self.client.post(
            f"/api/projects/{pid_a}/complaints",
            json={"complaint_type": "质疑", "challenger": "质疑方C", "content": "质疑内容"},
            headers=self._headers(),
        ).get_json()
        cid = comp["id"]
        up_comp = self.client.post(
            f"/api/projects/{pid_a}/attachments",
            data={"files": (io.BytesIO(b"comp-content"), "已删质疑附件.txt"), "complaint_id": str(cid)},
            headers=self._headers(),
            content_type="multipart/form-data",
        ).get_json()
        comp_att = (up_comp.get("uploaded") or up_comp)[0]

        # Soft-delete project B, single attachment, and complaint
        self.assertEqual(self.client.delete(f"/api/projects/{pid_b}", headers=self._headers()).status_code, 200)
        self.assertEqual(self.client.delete(f"/api/attachments/{del_att['id']}", headers=self._headers()).status_code, 200)
        del_comp_resp = self.client.delete(f"/api/projects/{pid_a}/complaints/{cid}", headers=self._headers())
        self.assertEqual(del_comp_resp.status_code, 200)
        comp_recycle_id = del_comp_resp.get_json()["recycle_id"]

        # 1. All-project registration XLSX export MUST NOT include soft-deleted project B or its suppliers
        reg_xlsx = self.client.get(f"/api/projects/{pid_a}/registrations?export=1&scope=all")
        self.assertEqual(reg_xlsx.status_code, 200)
        with zipfile.ZipFile(io.BytesIO(reg_xlsx.data)) as zf:
            xml_text = "\n".join(zf.read(name).decode("utf-8", errors="ignore") for name in zf.namelist() if name.endswith(".xml"))
        self.assertIn("保留供应商甲", xml_text)
        self.assertNotIn("已删隔离项目B", xml_text)
        self.assertNotIn("已删项目供应商乙", xml_text)
        self.assertNotIn("__deleted__", xml_text)

        # 2. Project XLSX export MUST exclude soft-deleted attachments & attachments of soft-deleted complaints
        proj_xlsx = self.client.get("/api/export")
        self.assertEqual(proj_xlsx.status_code, 200)
        with zipfile.ZipFile(io.BytesIO(proj_xlsx.data)) as zf:
            xml_text = "\n".join(zf.read(name).decode("utf-8", errors="ignore") for name in zf.namelist() if name.endswith(".xml"))
        self.assertIn("保留附件.txt", xml_text)
        self.assertNotIn("已删单附件.txt", xml_text)
        self.assertNotIn("已删质疑附件.txt", xml_text)

        # 3. Signed public download MUST return 404 for complaint-owned attachment while complaint is in recycle bin
        secret = signed_attachments.get_or_create_secret(self.data_dir)
        exp = int(time.time()) + 3600
        signed_url = signed_attachments.build_signed_url("", comp_att["id"], exp, secret)
        self.assertEqual(self.client.get(signed_url).status_code, 404)
        self.assertEqual(self.client.get(f"/api/attachments/{comp_att['id']}/download").status_code, 404)
        # Restoring the complaint re-enables its signed attachment download
        self.assertEqual(self.client.post(f"/api/recycle-bin/{comp_recycle_id}/restore", json={}, headers=self._headers()).status_code, 200)
        self.assertEqual(self.client.get(signed_url).status_code, 200)

    def test_editor_cannot_bypass_permanent_delete_for_complaint_or_clarification(self):
        proj = self._create_project("2026-PERM-001", "权限防绕过测试")
        pid = proj["id"]
        comp = self.client.post(
            f"/api/projects/{pid}/complaints",
            json={"complaint_type": "质疑", "challenger": "供应商X", "content": "说明"},
            headers=self._headers(),
        ).get_json()
        clar = self.client.post(
            f"/api/projects/{pid}/clarifications",
            json={"clarification_type": "澄清", "title": "澄清X", "content": "内容"},
            headers=self._headers(),
        ).get_json()

        self._login("editor", "EditorPass123456!")
        # Editor CAN soft-delete normally, but MUST get 403 on ?permanent=1
        self.assertEqual(
            self.client.delete(f"/api/projects/{pid}/complaints/{comp['id']}?permanent=1", headers=self._headers()).status_code,
            403,
        )
        self.assertEqual(
            self.client.delete(f"/api/projects/{pid}/clarifications/{clar['id']}?permanent=1", headers=self._headers()).status_code,
            403,
        )
        # Both records remain active in DB
        with self.app.app_context():
            self.assertIsNotNone(self.db.session.get(self.ctx["Complaint"], comp["id"]))
            self.assertIsNotNone(self.db.session.get(self.ctx["AnnouncementClarification"], clar["id"]))

    def test_atomic_purge_skips_concurrently_restored_item_and_supports_legacy_module_ctx(self):
        import types
        from unittest import mock
        from sqlalchemy.exc import IntegrityError

        proj = self._create_project("2026-RACE-001", "并发恢复清理测试")
        pid = proj["id"]
        del_resp = self.client.delete(f"/api/projects/{pid}", headers=self._headers())
        rid = del_resp.get_json()["recycle_id"]

        # Simulate concurrent restore happening before atomic purge claims the row
        self.assertEqual(self.client.post(f"/api/recycle-bin/{rid}/restore", json={}, headers=self._headers()).status_code, 200)
        with self.app.app_context():
            ok, reason, _meta = recycle_bin._atomic_purge_item(self.ctx, rid)
            self.assertFalse(ok)
            self.assertEqual(reason, "not_deleted")
            # Restored project is untouched!
            self.assertIsNotNone(self.db.session.get(self.ctx["Project"], pid))

        # Verify IntegrityError during restore commit converts cleanly to 409 number_conflict
        del2 = self.client.delete(f"/api/projects/{pid}", headers=self._headers())
        rid2 = del2.get_json()["recycle_id"]
        orig_commit = self.db.session.commit
        def _boom_commit():
            raise IntegrityError("UPDATE projects", {}, Exception("UNIQUE constraint failed: projects.number"))
        with mock.patch.object(self.db.session, "commit", side_effect=_boom_commit):
            conflict_resp = self.client.post(
                f"/api/recycle-bin/{rid2}/restore",
                json={"new_number": "2026-RACE-CONFLICT"},
                headers=self._headers(),
            )
        self.assertEqual(conflict_resp.status_code, 409)
        self.assertEqual(conflict_resp.get_json()["code"], "number_conflict")
        self.db.session.commit = orig_commit

        # Verify legacy module object (no .get() method) works in purge_expired_items
        with self.app.app_context():
            past = (datetime.now() - timedelta(days=2)).isoformat(timespec="seconds")
            self.db.session.execute(
                text("UPDATE recycle_bin_items SET purge_after=:p WHERE id=:id"),
                {"p": past, "id": rid2},
            )
            self.db.session.commit()
            legacy_mod = types.ModuleType("legacy_server_app")
            for k in ("app", "db", "Project", "Attachment", "Complaint", "AnnouncementClarification", "UPLOAD_FOLDER", "_cleanup_project_files", "_delete_attachment_file", "DATA_DIR"):
                setattr(legacy_mod, k, self.ctx.get(k))
            res = recycle_bin.purge_expired_items(legacy_mod, force=True)
            self.assertEqual(res["purged"], 1)
            self.assertIsNone(self.db.session.get(self.ctx["Project"], pid))

    def test_business_deadlines_exclude_soft_deleted_complaint_and_flag_confirmed_item_for_review(self):
        proj = self._create_project("2026-BD-001", "法定期限软删隔离测试")
        pid = proj["id"]
        # Enable gov procurement deadline rules on project
        set_resp = self.client.put(
            f"/api/projects/{pid}/deadline-settings",
            json={"revision": 0, "enabled": True, "regime": "government_procurement", "custom_rules": []},
            headers=self._headers(),
        )
        self.assertEqual(set_resp.status_code, 200, set_resp.get_data(as_text=True))

        comp = self.client.post(
            f"/api/projects/{pid}/complaints",
            json={"complaint_type": "质疑", "challenger": "供应商Q", "submit_date": "2026-11-20", "content": "质疑"},
            headers=self._headers(),
        ).get_json()
        cid = comp["id"]

        # Preview & confirm a gov_question_reply deadline sourced from this complaint
        prev = self.client.post(
            f"/api/projects/{pid}/deadlines/preview",
            json={"rule_id": "gov_question_reply", "source_type": "complaint", "source_id": cid},
            headers=self._headers(),
        )
        self.assertEqual(prev.status_code, 200, prev.get_data(as_text=True))
        token = prev.get_json()["token"]
        conf = self.client.post(
            f"/api/projects/{pid}/deadlines/confirm",
            json={"token": token},
            headers=self._headers(),
        )
        self.assertEqual(conf.status_code, 200, conf.get_data(as_text=True))
        dl_item = conf.get_json()["item"]
        self.assertFalse(dl_item["needs_review"])

        # Soft-delete the complaint -> source disappears from selectable sources AND confirmed deadline becomes needs_review
        self.assertEqual(self.client.delete(f"/api/projects/{pid}/complaints/{cid}", headers=self._headers()).status_code, 200)
        listed = self.client.get(f"/api/projects/{pid}/deadlines").get_json()
        self.assertFalse(any(s["source_type"] == "complaint" and s["source_id"] == cid for s in listed["sources"]))
        refreshed = next(i for i in listed["items"] if i["id"] == dl_item["id"])
        self.assertTrue(refreshed["needs_review"])
        self.assertTrue(refreshed["confirmed_deadline"])
        self.assertTrue(any("原业务记录已删除" in w for w in (refreshed.get("calculation") or {}).get("warnings") or []))

    def test_purging_project_removes_in_app_notifications_permanently_across_all_purge_paths(self):
        from src.backend_patches import notification_channels as nc

        # Create 3 due projects to test: (1) single purge, (2) expired auto-purge, (3) empty recycle bin
        now = datetime(2026, 11, 24, 10, 0, 0)
        pids = []
        for idx in range(1, 4):
            p = self._create_project(f"2026-PURGE-N{idx}", f"清理通知项目{idx}")
            pids.append(p["id"])
            self.client.put(
                f"/api/projects/{p['id']}/stages/bid_opening",
                json={"planned_at": now.strftime("%Y-%m-%dT10:30")},
                headers=self._headers(),
            )

        with self.app.app_context():
            nc.run_notification_dispatch(self.ctx, now=now)
        self.assertEqual(self.client.get("/api/notifications/unread-count").get_json()["unread_count"], 3)

        # Soft-delete all 3 projects -> unread drops 3 -> 0
        rids = []
        for pid in pids:
            r = self.client.delete(f"/api/projects/{pid}", headers=self._headers())
            self.assertEqual(r.status_code, 200)
            rids.append(r.get_json()["recycle_id"])
        self.assertEqual(self.client.get("/api/notifications/unread-count").get_json()["unread_count"], 0)

        # Path 1: Single item purge -> unread MUST remain 0 (never reappear!)
        self.assertEqual(self.client.delete(f"/api/recycle-bin/{rids[0]}", headers=self._headers()).status_code, 200)
        self.assertEqual(self.client.get("/api/notifications/unread-count").get_json()["unread_count"], 0)
        self.assertEqual(self.client.get("/api/notifications").get_json()["items"], [])

        # Path 2: Expired auto-purge -> unread MUST remain 0
        with self.app.app_context():
            past = (datetime.now() - timedelta(days=2)).isoformat(timespec="seconds")
            self.db.session.execute(
                text("UPDATE recycle_bin_items SET purge_after=:p WHERE id=:id"),
                {"p": past, "id": rids[1]},
            )
            self.db.session.commit()
            res = recycle_bin.purge_expired_items(self.ctx, force=True)
            self.assertEqual(res["purged"], 1)
        self.assertEqual(self.client.get("/api/notifications/unread-count").get_json()["unread_count"], 0)

        # Path 3: Empty recycle bin -> unread MUST remain 0 and DB rows cleaned
        self.assertEqual(self.client.post("/api/recycle-bin/empty", json={}, headers=self._headers()).status_code, 200)
        self.assertEqual(self.client.get("/api/notifications/unread-count").get_json()["unread_count"], 0)
        with self.app.app_context():
            leftover = self.db.session.execute(text("SELECT COUNT(*) FROM in_app_notifications")).scalar()
            self.assertEqual(int(leftover or 0), 0)

    def test_purging_complaint_and_clarification_deletes_owned_attachment_rows_without_orphaning(self):
        import io

        proj = self._create_project("2026-ORPHAN-001", "纯源码子附件级联清理测试")
        pid = proj["id"]

        # Create complaint + complaint attachment + complaint event + event attachment
        comp = self.client.post(
            f"/api/projects/{pid}/complaints",
            json={"complaint_type": "质疑", "challenger": "供应商O", "content": "说明"},
            headers=self._headers(),
        ).get_json()
        cid = comp["id"]
        up_comp = self.client.post(
            f"/api/projects/{pid}/attachments",
            data={"files": (io.BytesIO(b"comp-file-bytes"), "质疑主附件.txt"), "complaint_id": str(cid)},
            headers=self._headers(),
            content_type="multipart/form-data",
        ).get_json()
        comp_att_id = (up_comp.get("uploaded") or up_comp)[0]["id"]

        ev = self.client.post(
            f"/api/projects/{pid}/complaints/{cid}/events",
            json={"event_type": "收到质疑材料", "summary": "提交补充材料"},
            headers=self._headers(),
        ).get_json()
        eid = ev["id"]
        up_ev_resp = self.client.post(
            f"/api/projects/{pid}/complaints/{cid}/events/{eid}/attachments",
            data={"files": (io.BytesIO(b"ev-file-bytes"), "质疑过程附件.txt")},
            headers=self._headers(),
            content_type="multipart/form-data",
        )
        self.assertIn(up_ev_resp.status_code, (200, 201), up_ev_resp.get_data(as_text=True))

        # Create clarification + clarification attachment
        clar = self.client.post(
            f"/api/projects/{pid}/clarifications",
            json={"clarification_type": "澄清", "title": "澄清O", "content": "更正"},
            headers=self._headers(),
        ).get_json()
        clid = clar["id"]
        up_clar_resp = self.client.post(
            f"/api/projects/{pid}/clarifications/{clid}/attachments",
            data={"files": (io.BytesIO(b"clar-file-bytes"), "澄清附件.txt")},
            headers=self._headers(),
            content_type="multipart/form-data",
        )
        self.assertIn(up_clar_resp.status_code, (200, 201), up_clar_resp.get_data(as_text=True))

        with self.app.app_context():
            Attachment = self.ctx["Attachment"]
            ev_att = Attachment.query.filter_by(complaint_event_id=eid).first()
            clar_att = Attachment.query.filter_by(clarification_id=clid).first()
            self.assertIsNotNone(ev_att)
            self.assertIsNotNone(clar_att)
            ev_att_id = ev_att.id
            clar_att_id = clar_att.id
            paths = [
                self.ctx["UPLOAD_FOLDER"] / self.db.session.get(Attachment, aid).file_path
                for aid in (comp_att_id, ev_att_id, clar_att_id)
            ]
            for p_file in paths:
                self.assertTrue(p_file.exists())

        # Soft-delete and permanently purge complaint & clarification
        del_c = self.client.delete(f"/api/projects/{pid}/complaints/{cid}", headers=self._headers()).get_json()
        del_cl = self.client.delete(f"/api/projects/{pid}/clarifications/{clid}", headers=self._headers()).get_json()
        self.assertEqual(self.client.delete(f"/api/recycle-bin/{del_c['recycle_id']}", headers=self._headers()).status_code, 200)
        self.assertEqual(self.client.delete(f"/api/recycle-bin/{del_cl['recycle_id']}", headers=self._headers()).status_code, 200)

        # Ordinary project attachment listing MUST be empty (zero orphaned rows!) and DB rows + files MUST be gone
        self.assertEqual(self.client.get(f"/api/projects/{pid}/attachments").get_json(), [])
        with self.app.app_context():
            Attachment = self.ctx["Attachment"]
            for aid in (comp_att_id, ev_att_id, clar_att_id):
                self.assertIsNone(self.db.session.get(Attachment, aid))
            for p_file in paths:
                self.assertFalse(p_file.exists())

    def test_direct_permanent_delete_closes_child_recycle_items_and_guards_id_reuse(self):
        import io

        # 1. Soft-delete an attachment, then directly permanent-delete its parent project (?permanent=1)
        p1 = self._create_project("2026-IDREUSE-1", "旧项目1")
        pid1 = p1["id"]
        up1 = self.client.post(
            f"/api/projects/{pid1}/attachments",
            data={"files": (io.BytesIO(b"old-att-content"), "旧附件.txt")},
            headers=self._headers(),
            content_type="multipart/form-data",
        ).get_json()
        att1_id = (up1.get("uploaded") or up1)[0]["id"]
        del_att1 = self.client.delete(f"/api/attachments/{att1_id}", headers=self._headers())
        self.assertEqual(del_att1.status_code, 200)
        att1_rid = del_att1.get_json()["recycle_id"]

        # Direct hard delete of parent project MUST close out child recycle entry in same transaction
        perm_del = self.client.delete(f"/api/projects/{pid1}?permanent=1", headers=self._headers())
        self.assertEqual(perm_del.status_code, 200, perm_del.get_data(as_text=True))
        with self.app.app_context():
            st = self.db.session.execute(
                text("SELECT status FROM recycle_bin_items WHERE id=:rid"),
                {"rid": att1_rid},
            ).scalar()
            self.assertEqual(st, "purged")

        # Create a brand new project & attachment (SQLite reuses id=1!) -> MUST be visible and downloadable!
        p2 = self._create_project("2026-IDREUSE-2", "新项目复用ID")
        pid2 = p2["id"]
        up2 = self.client.post(
            f"/api/projects/{pid2}/attachments",
            data={"files": (io.BytesIO(b"new-att-content"), "新附件.txt")},
            headers=self._headers(),
            content_type="multipart/form-data",
        ).get_json()
        att2 = (up2.get("uploaded") or up2)[0]
        att2_id = att2["id"]
        self.assertEqual(pid2, pid1)
        self.assertEqual(att2_id, att1_id)
        listed = self.client.get(f"/api/projects/{pid2}/attachments").get_json()
        self.assertEqual(len(listed), 1)
        self.assertEqual(listed[0]["filename"], "新附件.txt")
        self.assertEqual(self.client.get(f"/api/attachments/{att2_id}/download").status_code, 200)

        # 2. Direct permanent delete of complaint, complaint event, and clarification closes out soft-deleted child attachments
        comp = self.client.post(
            f"/api/projects/{pid2}/complaints",
            json={"complaint_type": "质疑", "challenger": "供应商R", "content": "说明"},
            headers=self._headers(),
        ).get_json()
        cid = comp["id"]
        up_c = self.client.post(
            f"/api/projects/{pid2}/attachments",
            data={"files": (io.BytesIO(b"c-att"), "质疑旧附.txt"), "complaint_id": str(cid)},
            headers=self._headers(),
            content_type="multipart/form-data",
        ).get_json()
        c_att_id = (up_c.get("uploaded") or up_c)[0]["id"]
        c_att_rid = self.client.delete(f"/api/attachments/{c_att_id}", headers=self._headers()).get_json()["recycle_id"]

        ev = self.client.post(
            f"/api/projects/{pid2}/complaints/{cid}/events",
            json={"event_type": "补充材料", "summary": "事件"},
            headers=self._headers(),
        ).get_json()
        eid = ev["id"]
        self.assertIn(
            self.client.post(
                f"/api/projects/{pid2}/complaints/{cid}/events/{eid}/attachments",
                data={"files": (io.BytesIO(b"ev-att"), "事件旧附.txt")},
                headers=self._headers(),
                content_type="multipart/form-data",
            ).status_code,
            (200, 201),
        )
        with self.app.app_context():
            ev_att_id = self.ctx["Attachment"].query.filter_by(complaint_event_id=eid).first().id
        ev_att_rid = self.client.delete(f"/api/attachments/{ev_att_id}", headers=self._headers()).get_json()["recycle_id"]

        clar = self.client.post(
            f"/api/projects/{pid2}/clarifications",
            json={"clarification_type": "澄清", "title": "澄清R", "content": "内容"},
            headers=self._headers(),
        ).get_json()
        clid = clar["id"]
        self.assertIn(
            self.client.post(
                f"/api/projects/{pid2}/clarifications/{clid}/attachments",
                data={"files": (io.BytesIO(b"cl-att"), "澄清旧附.txt")},
                headers=self._headers(),
                content_type="multipart/form-data",
            ).status_code,
            (200, 201),
        )
        with self.app.app_context():
            cl_att_id = self.ctx["Attachment"].query.filter_by(clarification_id=clid).first().id
        cl_att_rid = self.client.delete(f"/api/attachments/{cl_att_id}", headers=self._headers()).get_json()["recycle_id"]

        # Directly delete complaint event, permanent-delete complaint, and permanent-delete clarification
        self.assertEqual(self.client.delete(f"/api/projects/{pid2}/complaints/{cid}/events/{eid}", headers=self._headers()).status_code, 200)
        self.assertEqual(self.client.delete(f"/api/projects/{pid2}/complaints/{cid}?permanent=1", headers=self._headers()).status_code, 200)
        self.assertEqual(self.client.delete(f"/api/projects/{pid2}/clarifications/{clid}?permanent=1", headers=self._headers()).status_code, 200)
        with self.app.app_context():
            for rid in (c_att_rid, ev_att_rid, cl_att_rid):
                st = self.db.session.execute(
                    text("SELECT status FROM recycle_bin_items WHERE id=:rid"),
                    {"rid": rid},
                ).scalar()
                self.assertEqual(st, "purged", f"Child recycle item {rid} was not purged")

        # 3. Defense-in-depth: even if a stale recycle row exists targeting a reused entity_id,
        # purging that stale row MUST NOT delete the live new attachment or its physical file!
        with self.app.app_context():
            live_att = self.db.session.get(self.ctx["Attachment"], att2_id)
            live_file = self.ctx["UPLOAD_FOLDER"] / live_att.file_path
            self.assertTrue(live_file.exists())
            stale_rid = recycle_bin._insert_recycle_row(
                self.db,
                entity_type="attachment",
                entity_id=att2_id,
                project_id=pid2,
                display_title="遗留旧附件.txt",
                snapshot={"filename": "遗留旧附件.txt", "file_path": "stale/never_match.txt", "project_id": pid2},
                deleted_by=self.admin_id,
                deleted_by_name="admin",
                delete_reason="模拟遗留",
                deleted_at="2026-11-01T00:00:00",
                purge_after="2026-11-10T00:00:00",
            )
            self.db.session.commit()
        purge_stale = self.client.delete(f"/api/recycle-bin/{stale_rid}", headers=self._headers())
        self.assertEqual(purge_stale.status_code, 200)
        with self.app.app_context():
            still_alive = self.db.session.get(self.ctx["Attachment"], att2_id)
            self.assertIsNotNone(still_alive)
            self.assertTrue(live_file.exists())
        self.assertEqual(self.client.get(f"/api/attachments/{att2_id}/download").status_code, 200)

    def test_stale_reused_id_recycle_item_cannot_restore_over_or_side_effect_new_project(self):
        import io
        from src.backend_patches import notification_channels as nc

        # Create a live project NEW-1, soft-delete its own attachment, and generate an in-app notification for NEW-1
        new_proj = self._create_project("NEW-1", "现存新项目")
        pid = new_proj["id"]
        up = self.client.post(
            f"/api/projects/{pid}/attachments",
            data={"files": (io.BytesIO(b"new-proj-att"), "新项目附件.txt")},
            headers=self._headers(),
            content_type="multipart/form-data",
        ).get_json()
        new_att_id = (up.get("uploaded") or up)[0]["id"]
        new_att_rid = self.client.delete(f"/api/attachments/{new_att_id}", headers=self._headers()).get_json()["recycle_id"]

        now = datetime(2026, 11, 24, 10, 0, 0)
        self.client.put(
            f"/api/projects/{pid}/stages/bid_opening",
            json={"planned_at": now.strftime("%Y-%m-%dT10:30")},
            headers=self._headers(),
        )
        with self.app.app_context():
            nc.run_notification_dispatch(self.ctx, now=now)
            # Inject a historical stale project recycle entry reusing pid (representing OLD-1)
            stale_proj_rid = recycle_bin._insert_recycle_row(
                self.db,
                entity_type="project",
                entity_id=pid,
                project_id=pid,
                display_title="OLD-1 · 历史已删项目",
                snapshot={"original_number": "OLD-1", "name": "历史已删项目"},
                deleted_by=self.admin_id,
                deleted_by_name="admin",
                delete_reason="历史遗留",
                deleted_at="2026-10-01T00:00:00",
                purge_after="2026-10-31T00:00:00",
            )
            # Also inject a historical stale attachment recycle entry reusing new_att_id with a different file_path
            stale_att_rid = recycle_bin._insert_recycle_row(
                self.db,
                entity_type="attachment",
                entity_id=new_att_id,
                project_id=pid,
                display_title="历史旧附件.txt",
                snapshot={"filename": "历史旧附件.txt", "file_path": "old/does-not-match.txt", "project_id": pid},
                deleted_by=self.admin_id,
                deleted_by_name="admin",
                delete_reason="历史遗留",
                deleted_at="2026-10-01T00:00:00",
                purge_after="2026-10-31T00:00:00",
            )
            self.db.session.commit()

        # 1. Restoring stale project recycle row MUST return 409 entity_mismatch and NEVER overwrite NEW-1 -> OLD-1!
        restore_resp = self.client.post(f"/api/recycle-bin/{stale_proj_rid}/restore", json={}, headers=self._headers())
        self.assertEqual(restore_resp.status_code, 409, restore_resp.get_data(as_text=True))
        self.assertEqual(restore_resp.get_json().get("code"), "entity_mismatch")
        with self.app.app_context():
            self.assertEqual(self.db.session.get(self.ctx["Project"], pid).number, "NEW-1")

        # 2. Restoring stale attachment recycle row with mismatched snapshot MUST also return 409 entity_mismatch!
        restore_att_resp = self.client.post(f"/api/recycle-bin/{stale_att_rid}/restore", json={}, headers=self._headers())
        self.assertEqual(restore_att_resp.status_code, 409, restore_att_resp.get_data(as_text=True))
        self.assertEqual(restore_att_resp.get_json().get("code"), "entity_mismatch")

        # 3. Purging stale project recycle row MUST mark ONLY that stale row purged, with ZERO side effects on NEW-1,
        # NEW-1's own soft-deleted attachment recycle row (still 'deleted'), or NEW-1's in-app notification (still 1)!
        purge_resp = self.client.delete(f"/api/recycle-bin/{stale_proj_rid}", headers=self._headers())
        self.assertEqual(purge_resp.status_code, 200, purge_resp.get_data(as_text=True))
        with self.app.app_context():
            live_p = self.db.session.get(self.ctx["Project"], pid)
            self.assertIsNotNone(live_p)
            self.assertEqual(live_p.number, "NEW-1")
            stale_st = self.db.session.execute(
                text("SELECT status FROM recycle_bin_items WHERE id=:rid"), {"rid": stale_proj_rid}
            ).scalar()
            self.assertEqual(stale_st, "purged")
            new_att_st = self.db.session.execute(
                text("SELECT status FROM recycle_bin_items WHERE id=:rid"), {"rid": new_att_rid}
            ).scalar()
            self.assertEqual(new_att_st, "deleted", "New project's own attachment recycle entry must stay 'deleted'")
            notif_cnt = self.db.session.execute(
                text("SELECT COUNT(*) FROM in_app_notifications WHERE project_id=:pid"), {"pid": pid}
            ).scalar()
            self.assertEqual(int(notif_cnt or 0), 1, "New project's in-app notification must NOT be deleted")
        self.assertEqual(self.client.get("/api/notifications/unread-count").get_json()["unread_count"], 1)

        # 4. Round-5 P1①: Even after NEW-1 ITSELF is soft-deleted into the recycle bin (so its number also starts with
        # __deleted__<pid>__), purging historical/legacy recycle entries for the same pid MUST conservatively skip NEW-1!
        soft_new = self.client.delete(f"/api/projects/{pid}", headers=self._headers())
        self.assertEqual(soft_new.status_code, 200)
        new_proj_rid = soft_new.get_json()["recycle_id"]

        with self.app.app_context():
            # Case A: legacy row for OLD-1 (no tombstone_number)
            legacy_old_rid = recycle_bin._insert_recycle_row(
                self.db,
                entity_type="project",
                entity_id=pid,
                project_id=pid,
                display_title="OLD-1 · 历史旧条目",
                snapshot={"original_number": "OLD-1", "name": "历史旧条目"},
                deleted_by=self.admin_id,
                deleted_by_name="admin",
                delete_reason="遗留A",
                deleted_at="2026-09-01T00:00:00",
                purge_after="2026-09-30T00:00:00",
            )
            # Case B: legacy row even sharing original_number='NEW-1' (no tombstone_number, competing with active new_proj_rid)
            legacy_same_num_rid = recycle_bin._insert_recycle_row(
                self.db,
                entity_type="project",
                entity_id=pid,
                project_id=pid,
                display_title="NEW-1 · 同号历史旧条目",
                snapshot={"original_number": "NEW-1", "name": "同号历史旧条目"},
                deleted_by=self.admin_id,
                deleted_by_name="admin",
                delete_reason="遗留B",
                deleted_at="2026-09-02T00:00:00",
                purge_after="2026-09-30T00:00:00",
            )
            self.db.session.commit()

        for srid in (legacy_old_rid, legacy_same_num_rid):
            r_purge = self.client.delete(f"/api/recycle-bin/{srid}", headers=self._headers())
            self.assertEqual(r_purge.status_code, 200)

        with self.app.app_context():
            # NEW-1 entity and its own recycle entry MUST still exist and remain restorable!
            self.assertIsNotNone(self.db.session.get(self.ctx["Project"], pid))
            own_st = self.db.session.execute(
                text("SELECT status FROM recycle_bin_items WHERE id=:rid"), {"rid": new_proj_rid}
            ).scalar()
            self.assertEqual(own_st, "deleted")

        restored_new = self.client.post(f"/api/recycle-bin/{new_proj_rid}/restore", json={}, headers=self._headers())
        self.assertEqual(restored_new.status_code, 200, restored_new.get_data(as_text=True))
        self.assertEqual(restored_new.get_json()["number"], "NEW-1")


    def test_dashboard_and_lists_share_visible_complaint_states(self):
        pid = self._create_project()["id"]
        base = f"/api/projects/{pid}/complaints"

        def add(kind):
            response = self.client.post(base, json={"complaint_type": kind, "challenger": "测试单位"}, headers=self._headers())
            self.assertIn(response.status_code, (200, 201))
            return response.get_json()["id"]

        def assert_state(expected):
            summary = self.client.get("/api/projects/dashboard-summary").get_json()
            risks = {p["id"]: p["challenge_state"] for p in summary["insights"]["riskProjects"]}
            self.assertEqual(risks.get(pid, ""), expected)
            self.assertEqual(self.client.get(f"/api/projects/{pid}").get_json()["challenge_state"], expected)
            for url in ("/api/projects", "/api/projects?compact=1&paginated=1"):
                payload = self.client.get(url).get_json()
                rows = payload if isinstance(payload, list) else payload["items"]
                self.assertEqual(next(p for p in rows if p["id"] == pid)["challenge_state"], expected)

        question = add("质疑")
        assert_state("质疑中")
        complaint = add("投诉")
        assert_state("投诉中")
        removed = self.client.delete(f"{base}/{complaint}", headers=self._headers()).get_json()
        assert_state("质疑中")
        self.assertEqual(self.client.post(f"{base}/{question}/set-status", json={"action": "resolve"}, headers=self._headers()).status_code, 200)
        assert_state("")
        self.assertEqual(self.client.post(f"/api/recycle-bin/{removed['recycle_id']}/restore", json={}, headers=self._headers()).status_code, 200)
        assert_state("投诉中")
        self.assertEqual(self.client.put(f"{base}/{complaint}", json={"status": "已办结"}, headers=self._headers()).status_code, 200)
        assert_state("")


if __name__ == "__main__":
    unittest.main()
