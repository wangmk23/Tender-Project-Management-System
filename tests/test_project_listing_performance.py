"""3000-project scale benchmark and cold-archive / pagination functional tests."""
from __future__ import annotations

from datetime import date, datetime
from pathlib import Path
import tempfile
import time
import unittest

from sqlalchemy import event, text
from werkzeug.security import generate_password_hash

from src.project_manager.standalone_app import create_app


class ProjectListingPerformanceTests(unittest.TestCase):
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
            self.db.session.add(admin)
            self.db.session.commit()
        self.client.post("/login", data={"username": "admin", "password": "AdminPass123456!"})
        tok = self.client.post("/api/csrf-refresh").get_json() or {}
        self.csrf = tok.get("csrf_token", "")

    def _cleanup(self):
        try:
            with self.app.app_context():
                self.db.session.remove()
                self.db.engine.dispose()
        except Exception:
            pass
        self.tmp.cleanup()

    def _seed_projects(self, total: int = 3000):
        """Insert synthetic multi-year dataset directly via SQL for realistic scale benchmarking."""
        today_year = date.today().year
        years = [today_year - offset for offset in range(6)]  # current year down to -5
        per_year = total // len(years)
        stage_keys = [
            ("plan_received", "计划接收", "📥", 0),
            ("doc_prepare", "文件编制", "📝", 1),
            ("doc_review", "文件审核", "🔍", 2),
            ("announcement", "公告发布", "📢", 3),
            ("registration_end", "报名截止", "⏰", 4),
            ("bid_opening", "开标", "🎯", 5),
            ("evaluation", "评标", "📊", 6),
            ("result_announced", "结果公示", "📣", 7),
            ("winning_notice", "中标通知书", "🏆", 8),
            ("archived", "资料整理归档", "📦", 9),
        ]
        now_iso = datetime.now().isoformat(timespec="seconds")
        tomorrow_dt = datetime.now().replace(hour=10, minute=0, second=0, microsecond=0).strftime("%Y-%m-%d %H:%M:%S")
        with self.app.app_context():
            conn = self.db.session.connection()
            pid = 0
            project_rows = []
            stage_rows = []
            lot_rows = []
            reg_rows = []
            for y_idx, y in enumerate(years):
                for i in range(per_year):
                    pid += 1
                    is_old = y_idx >= 2  # older than active 2-year window
                    # Keep 5 old-year projects per old year still in-progress to verify they stay active
                    still_active_old = is_old and i < 5
                    is_terminated = (not still_active_old) and (i % 25 == 0)
                    all_done = (not is_terminated) and ((is_old and not still_active_old) or (not is_old and i >= 120))
                    project_rows.append({
                        "id": pid,
                        "number": f"{y}-P{i+1:04d}",
                        "name": f"{y}年度招标采购项目第{i+1}号",
                        "purchaser": f"测试采购单位{(i % 30) + 1}",
                        "method": "公开招标" if i % 2 == 0 else "竞争性磋商",
                        "budget": str(100000 + i * 1000),
                        "year": str(y),
                        "is_terminated": 1 if is_terminated else 0,
                        "terminated_type": "liubiao" if is_terminated else "",
                        "terminated_reason": "",
                        "notes": "",
                        "no_deposit": 0,
                        "prepare_owner": "张三",
                        "review_owner": "李四",
                        "created_at": now_iso,
                    })
                    # Add realistic lots & registrations (including warning-window projects)
                    if i < 60:
                        lot_rows.append({
                            "project_id": pid,
                            "lot_number": "第1包",
                            "lot_name": "核心标段",
                            "budget": "50000",
                        })
                        reg_rows.append({
                            "project_id": pid,
                            "company_name": f"测试投标人{pid}",
                        })
                    for sk, sname, sicon, pos in stage_keys:
                        done = 1 if (all_done or (not is_terminated and pos < 3)) else 0
                        # Put some active projects inside registration warning window to exercise risk batching
                        planned_dt = tomorrow_dt if (sk == "registration_end" and not done and not is_terminated and i < 40) else None
                        stage_rows.append({
                            "project_id": pid,
                            "stage_key": sk,
                            "stage_name": sname,
                            "stage_icon": sicon,
                            "stage_position": pos,
                            "completed": done,
                            "skipped": 0,
                            "template_removed": 0,
                            "planned_datetime": planned_dt,
                            "notes": "",
                            "responsible_person": "张三",
                            "opening_location": "",
                            "evaluation_location": "",
                            "publication_url": "",
                        })
            conn.execute(
                text(
                    "INSERT INTO projects(id,number,name,purchaser,method,budget,year,is_terminated,"
                    "terminated_type,terminated_reason,notes,no_deposit,prepare_owner,review_owner,created_at) "
                    "VALUES (:id,:number,:name,:purchaser,:method,:budget,:year,:is_terminated,"
                    ":terminated_type,:terminated_reason,:notes,:no_deposit,:prepare_owner,:review_owner,:created_at)"
                ),
                project_rows,
            )
            conn.execute(
                text(
                    "INSERT INTO stages(project_id,stage_key,stage_name,stage_icon,stage_position,"
                    "completed,skipped,template_removed,planned_datetime,notes,responsible_person,opening_location,"
                    "evaluation_location,publication_url) "
                    "VALUES (:project_id,:stage_key,:stage_name,:stage_icon,:stage_position,"
                    ":completed,:skipped,:template_removed,:planned_datetime,:notes,:responsible_person,:opening_location,"
                    ":evaluation_location,:publication_url)"
                ),
                stage_rows,
            )
            if lot_rows:
                conn.execute(
                    text("INSERT INTO project_lots(project_id,lot_number,lot_name,budget) VALUES (:project_id,:lot_number,:lot_name,:budget)"),
                    lot_rows,
                )
            if reg_rows:
                conn.execute(
                    text("INSERT INTO supplier_registrations(project_id,company_name) VALUES (:project_id,:company_name)"),
                    reg_rows,
                )
            # Also seed electronic-tender snapshots & ledgers on 20 active projects to prove zero per-lot N+1
            from src.backend_patches import electronic_tender, procurement_catalog
            procurement_catalog.ensure_schema(self.db)
            electronic_tender.ensure_schema(self.db)
            method_row = conn.execute(
                text("SELECT id FROM procurement_methods WHERE builtin_kind='公开招标' OR name='公开招标' LIMIT 1")
            ).first()
            if method_row:
                mid = str(method_row[0])
                elec_snaps = []
                elec_ledgers = []
                for epid in range(1, 21):
                    elec_snaps.append({
                        "pid": epid,
                        "mid": mid,
                        "snap": f'{{"method_id":"{mid}","method_revision":1,"electronic_tender":true,"quantity_rule":{{"mode":"fixed","minimum":3}}}}',
                    })
                    elec_ledgers.append({"pid": epid, "counts": '[{"lot_id":null,"meets_minimum":true}]'})
                conn.execute(
                    text("INSERT OR REPLACE INTO project_procurement_snapshots(project_id,method_id,snapshot_json,workflow_revision) VALUES (:pid,:mid,:snap,1)"),
                    elec_snaps,
                )
                conn.execute(
                    text("INSERT OR REPLACE INTO electronic_tender_ledgers(project_id,revision,counts_json,quotes_json,cutoff_snapshot) VALUES (:pid,1,:counts,'{}',NULL)"),
                    elec_ledgers,
                )
            self.db.session.commit()
        return years

    def test_3000_projects_cold_archive_pagination_and_sql_budget(self):
        years = self._seed_projects(3000)

        # 1. Years summary must be fast and accurately separate active vs cold-archived
        t0 = time.perf_counter()
        summary_resp = self.client.get("/api/projects/years-summary")
        t_summary = time.perf_counter() - t0
        self.assertEqual(summary_resp.status_code, 200)
        summary = summary_resp.get_json()
        self.assertEqual(summary["total_count"], 3000)
        # 2 active years * 500 + 4 old years * 5 still-in-progress = 1020 active scope; 1980 cold archived
        self.assertEqual(summary["active_scope_count"], 1020)
        self.assertEqual(summary["cold_archived_count"], 1980)
        self.assertLess(t_summary, 1.0, f"years-summary too slow: {t_summary:.3f}s")

        # 2. First-load active scope with compact=1 and SQL counter (no N+1!)
        sql_count = 0
        def _count_sql(*_args, **_kwargs):
            nonlocal sql_count
            sql_count += 1

        with self.app.app_context():
            event.listen(self.db.engine, "before_cursor_execute", _count_sql)
        try:
            t1 = time.perf_counter()
            active_resp = self.client.get("/api/projects?year=active&compact=1&paginated=1&page=1&page_size=100")
            t_active_page = time.perf_counter() - t1
        finally:
            with self.app.app_context():
                event.remove(self.db.engine, "before_cursor_execute", _count_sql)

        self.assertEqual(active_resp.status_code, 200)
        page_data = active_resp.get_json()
        self.assertEqual(page_data["total"], 1020)
        self.assertEqual(len(page_data["items"]), 100)
        self.assertTrue(page_data["has_more"])
        # Paginated items MUST preserve optimistic concurrency record_version & business_deadline_summary
        sample_item = page_data["items"][0]
        self.assertTrue(sample_item.get("record_version"), "Paginated project missing record_version")
        self.assertIn("business_deadline_summary", sample_item)
        if sample_item.get("stages"):
            self.assertTrue(sample_item["stages"][0].get("record_version"), "Paginated stage missing record_version")
        # Verify N+1 is eliminated (< 50 queries instead of thousands) and response well under 3s
        self.assertLess(sql_count, 50, f"N+1 detected: {sql_count} SQL queries")
        self.assertLess(t_active_page, 3.0, f"First active page exceeded 3s budget: {t_active_page:.3f}s")

        # 3. Cold-start sequence (years-summary + active scope unpaginated) stays well under 3s
        t2 = time.perf_counter()
        active_all_resp = self.client.get("/api/projects?year=active&compact=1")
        t_active_all = time.perf_counter() - t2
        self.assertEqual(active_all_resp.status_code, 200)
        active_all = active_all_resp.get_json()
        self.assertEqual(len(active_all), 1020)
        self.assertLess(t_summary + t_active_all, 3.0, f"Cold-start load exceeded 3s budget: {(t_summary + t_active_all):.3f}s")
        # Confirm an old-year still-in-progress project IS present in active scope
        oldest_year = years[-1]
        self.assertTrue(any(p["number"] == f"{oldest_year}-P0001" for p in active_all))
        # Confirm an old-year completed project is NOT in active scope
        self.assertFalse(any(p["number"] == f"{oldest_year}-P0020" for p in active_all))

        # 4. Cross-year backend search finds cold-archived old project instantly
        t3 = time.perf_counter()
        search_resp = self.client.get(f"/api/projects?year=all&q={oldest_year}-P0020&compact=1")
        t_search = time.perf_counter() - t3
        self.assertEqual(search_resp.status_code, 200)
        found = search_resp.get_json()
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0]["number"], f"{oldest_year}-P0020")
        self.assertLess(t_search, 2.0, f"Cross-year search too slow: {t_search:.3f}s")

        # 5. Cold archive setting update works
        upd = self.client.patch(
            "/api/settings",
            json={"cold_archive_active_years": 3},
            headers={"X-CSRFToken": self.csrf},
        )
        self.assertEqual(upd.status_code, 200)
        summary3 = self.client.get("/api/projects/years-summary").get_json()
        self.assertEqual(summary3["active_years_window"], 3)
        self.assertEqual(summary3["active_scope_count"], 1515)  # 3*500 + 3*5

    def test_3000_same_year_projects_no_cold_archive_first_page_under_3s(self):
        """Even when all 3000 projects are in the current year (0 cold-archived), paginated cold-start stays well under 3s."""
        cur_year = str(date.today().year)
        stage_keys = [
            ("plan_received", "计划接收", "📥", 0),
            ("doc_prepare", "文件编制", "📝", 1),
            ("doc_review", "文件审核", "🔍", 2),
            ("announcement", "公告发布", "📢", 3),
            ("registration_end", "报名截止", "⏰", 4),
            ("bid_opening", "开标", "🎯", 5),
            ("evaluation", "评标", "📊", 6),
            ("result_announced", "结果公示", "📣", 7),
            ("winning_notice", "中标通知书", "🏆", 8),
            ("archived", "资料整理归档", "📦", 9),
        ]
        now_iso = datetime.now().isoformat(timespec="seconds")
        with self.app.app_context():
            conn = self.db.session.connection()
            project_rows = [
                {
                    "id": i,
                    "number": f"{cur_year}-SY{i:04d}",
                    "name": f"{cur_year}当年项目第{i}号",
                    "purchaser": f"单位{(i % 20) + 1}",
                    "method": "公开招标",
                    "budget": "200000",
                    "year": cur_year,
                    "is_terminated": 0,
                    "terminated_type": "",
                    "terminated_reason": "",
                    "notes": "",
                    "no_deposit": 0,
                    "prepare_owner": "张三",
                    "review_owner": "李四",
                    "created_at": now_iso,
                }
                for i in range(1, 3001)
            ]
            stage_rows = [
                {
                    "project_id": i,
                    "stage_key": sk,
                    "stage_name": sname,
                    "stage_icon": sicon,
                    "stage_position": pos,
                    "completed": 1 if pos < 3 else 0,
                    "skipped": 0,
                    "template_removed": 0,
                    "notes": "",
                    "responsible_person": "张三",
                    "opening_location": "",
                    "evaluation_location": "",
                    "publication_url": "",
                }
                for i in range(1, 3001)
                for sk, sname, sicon, pos in stage_keys
            ]
            conn.execute(
                text(
                    "INSERT INTO projects(id,number,name,purchaser,method,budget,year,is_terminated,"
                    "terminated_type,terminated_reason,notes,no_deposit,prepare_owner,review_owner,created_at) "
                    "VALUES (:id,:number,:name,:purchaser,:method,:budget,:year,:is_terminated,"
                    ":terminated_type,:terminated_reason,:notes,:no_deposit,:prepare_owner,:review_owner,:created_at)"
                ),
                project_rows,
            )
            conn.execute(
                text(
                    "INSERT INTO stages(project_id,stage_key,stage_name,stage_icon,stage_position,"
                    "completed,skipped,template_removed,notes,responsible_person,opening_location,"
                    "evaluation_location,publication_url) "
                    "VALUES (:project_id,:stage_key,:stage_name,:stage_icon,:stage_position,"
                    ":completed,:skipped,:template_removed,:notes,:responsible_person,:opening_location,"
                    ":evaluation_location,:publication_url)"
                ),
                stage_rows,
            )
            self.db.session.commit()

        # Measure exact frontend cold-start sequence: years-summary -> paginated page 1
        sql_count = 0
        def _count_sql(*_a, **_kw):
            nonlocal sql_count
            sql_count += 1

        t0 = time.perf_counter()
        summary = self.client.get("/api/projects/years-summary").get_json()
        self.assertEqual(summary["total_count"], 3000)
        self.assertEqual(summary["cold_archived_count"], 0)

        with self.app.app_context():
            event.listen(self.db.engine, "before_cursor_execute", _count_sql)
        try:
            page_resp = self.client.get("/api/projects?year=all&compact=1&paginated=1&page=1&page_size=100")
        finally:
            with self.app.app_context():
                event.remove(self.db.engine, "before_cursor_execute", _count_sql)
        elapsed = time.perf_counter() - t0

        self.assertEqual(page_resp.status_code, 200)
        payload = page_resp.get_json()
        self.assertEqual(payload["total"], 3000)
        self.assertEqual(len(payload["items"]), 100)
        self.assertTrue(payload["has_more"])
        self.assertTrue(payload["items"][0].get("record_version"))
        self.assertLess(len(page_resp.data), 2 * 1024 * 1024, f"First page payload too large: {len(page_resp.data)} bytes")
        self.assertLess(sql_count, 50, f"Too many SQL queries for page 1: {sql_count}")
        self.assertLess(elapsed, 3.0, f"Same-year 3000-project cold start exceeded 3s: {elapsed:.3f}s")

        # Verify server-side stable sorting across pages (P2①: number_desc starts at SY3000 on page 1, SY2900 on page 2!)
        desc_p1 = self.client.get("/api/projects?year=all&compact=1&paginated=1&page=1&page_size=100&sort=number_desc").get_json()
        desc_p2 = self.client.get("/api/projects?year=all&compact=1&paginated=1&page=2&page_size=100&sort=number_desc").get_json()
        self.assertEqual(desc_p1["items"][0]["number"], f"{cur_year}-SY3000")
        self.assertEqual(desc_p1["items"][-1]["number"], f"{cur_year}-SY2901")
        self.assertEqual(desc_p2["items"][0]["number"], f"{cur_year}-SY2900")
        self.assertEqual(desc_p2["items"][-1]["number"], f"{cur_year}-SY2801")

        asc_p1 = self.client.get("/api/projects?year=all&compact=1&paginated=1&page=1&page_size=100&sort=number_asc").get_json()
        asc_p2 = self.client.get("/api/projects?year=all&compact=1&paginated=1&page=2&page_size=100&sort=number_asc").get_json()
        self.assertEqual(asc_p1["items"][0]["number"], f"{cur_year}-SY0001")
        self.assertEqual(asc_p2["items"][0]["number"], f"{cur_year}-SY0101")

        sql_af = 0
        def _count_af(*_a, **_kw):
            nonlocal sql_af
            sql_af += 1
        with self.app.app_context():
            event.listen(self.db.engine, "before_cursor_execute", _count_af)
        try:
            af_p1 = self.client.get("/api/projects?year=all&compact=1&paginated=1&page=1&page_size=100&sort=active_first").get_json()
        finally:
            with self.app.app_context():
                event.remove(self.db.engine, "before_cursor_execute", _count_af)
        self.assertEqual(len(af_p1["items"]), 100)
        self.assertEqual(af_p1["items"][0]["number"], f"{cur_year}-SY3000")
        self.assertLess(sql_af, 50, f"Too many SQL queries for active_first sort: {sql_af}")

        # Verify default dashboard startup uses compact aggregated summary (<256KB, total login-to-home < 3s!)
        t_dash0 = time.perf_counter()
        dash_resp = self.client.get("/api/projects/dashboard-summary")
        t_dash = time.perf_counter() - t_dash0
        self.assertEqual(dash_resp.status_code, 200)
        dash = dash_resp.get_json()
        self.assertTrue(dash["aggregated"])
        self.assertEqual(dash["metrics"]["total"], 3000)
        self.assertEqual(dash["metrics"]["active"], 3000)
        self.assertEqual(dash["metrics"]["unopened"], 3000)
        self.assertEqual(dash["insights"]["methods"]["公开招标"], 3000)
        self.assertLess(len(dash_resp.data), 256 * 1024, f"dashboard-summary payload too large: {len(dash_resp.data)} bytes")
        self.assertLess(elapsed + t_dash, 3.0, f"Full login-to-dashboard-ready exceeded 3s: {(elapsed + t_dash):.3f}s")

    def test_skipped_historical_stage_consistent_across_summary_archive_and_status_filter(self):
        """A project whose non-removed stages are all completed or skipped must consistently count as completed everywhere."""
        cur_year = date.today().year
        old_year = cur_year - 4
        now_iso = datetime.now().isoformat(timespec="seconds")
        with self.app.app_context():
            conn = self.db.session.connection()
            conn.execute(
                text(
                    "INSERT INTO projects(id,number,name,purchaser,method,budget,year,is_terminated,"
                    "terminated_type,terminated_reason,notes,no_deposit,prepare_owner,review_owner,created_at) VALUES "
                    "(101, :n1, '历史跳过完成项目', '单位A', '公开招标', '100000', :y1, 0, '', '', '', 0, '张三', '李四', :now),"
                    "(102, :n2, '当年跳过完成项目', '单位A', '公开招标', '100000', :y2, 0, '', '', '', 0, '张三', '李四', :now)"
                ),
                {"n1": f"{old_year}-SKIP-1", "y1": str(old_year), "n2": f"{cur_year}-SKIP-2", "y2": str(cur_year), "now": now_iso},
            )
            stage_rows = []
            for pid in (101, 102):
                stage_rows.extend([
                    {"pid": pid, "sk": "plan_received", "sn": "计划接收", "pos": 0, "c": 1, "s": 0, "tr": 0},
                    {"pid": pid, "sk": "bid_opening", "sn": "开标", "pos": 1, "c": 0, "s": 1, "tr": 0},
                    {"pid": pid, "sk": "archived", "sn": "资料归档", "pos": 2, "c": 1, "s": 0, "tr": 0},
                    {"pid": pid, "sk": "legacy_removed", "sn": "已移除阶段", "pos": 3, "c": 0, "s": 0, "tr": 1},
                ])
            conn.execute(
                text(
                    "INSERT INTO stages(project_id,stage_key,stage_name,stage_icon,stage_position,"
                    "completed,skipped,template_removed,notes,responsible_person,opening_location,"
                    "evaluation_location,publication_url) "
                    "VALUES (:pid,:sk,:sn,'•',:pos,:c,:s,:tr,'','','','','')"
                ),
                stage_rows,
            )
            self.db.session.commit()

        summary = self.client.get("/api/projects/years-summary").get_json()
        self.assertEqual(summary["total_count"], 2)
        self.assertEqual(summary["cold_archived_count"], 1)
        by_y = {y["year"]: y for y in summary["years"]}
        self.assertEqual(by_y[str(old_year)]["completed"], 1)
        self.assertEqual(by_y[str(old_year)]["in_progress"], 0)
        self.assertEqual(by_y[str(cur_year)]["completed"], 1)
        self.assertEqual(by_y[str(cur_year)]["in_progress"], 0)

        done_page = self.client.get("/api/projects?year=all&paginated=1&status=done").get_json()
        active_page = self.client.get("/api/projects?year=all&paginated=1&status=active").get_json()
        archived_page = self.client.get("/api/projects?year=archived&paginated=1").get_json()
        dash = self.client.get("/api/projects/dashboard-summary").get_json()

        self.assertEqual(done_page["total"], 2)
        self.assertTrue(all(item["progress"] == 100 for item in done_page["items"]))
        self.assertEqual(active_page["total"], 0)
        self.assertEqual(archived_page["total"], 1)
        self.assertEqual(dash["metrics"]["completed"], 2)
        self.assertEqual(dash["metrics"]["active"], 0)

    def test_dashboard_summary_minute_deadline_overdue_and_prefiltered_task_buckets(self):
        """Round-5 P1③ & P2①: minute-precision deadlines passed earlier today count as overdue (matching overview_summaries),
        and task_buckets preserve 'soon' preview items even when >120 overdue stage nodes exist."""
        from src.backend_patches import business_deadlines, project_listing

        now = datetime(2026, 11, 25, 14, 0, 0)
        with self.app.app_context():
            conn = self.db.session.connection()
            conn.execute(
                text(
                    "INSERT INTO projects(id,number,name,purchaser,method,budget,year,is_terminated,"
                    "terminated_type,terminated_reason,notes,no_deposit,prepare_owner,review_owner,created_at) VALUES "
                    "(201, '2026-BD-TIME', '时分期限与多逾期项目', '单位T', '公开招标', '100000', '2026', 0, '', '', '', 0, '张三', '李四', '2026-11-01T09:00:00')"
                )
            )
            # 121 overdue stages + 1 tomorrow stage ('soon')
            st_rows = [
                {
                    "pid": 201,
                    "sk": f"ov_{idx}",
                    "sn": f"逾期阶段{idx}",
                    "pos": idx,
                    "dt": "2026-11-10 09:00:00",
                }
                for idx in range(121)
            ]
            st_rows.append({
                "pid": 201,
                "sk": "tomorrow_due",
                "sn": "明日到期阶段",
                "pos": 122,
                "dt": "2026-11-26 10:00:00",
            })
            conn.execute(
                text(
                    "INSERT INTO stages(project_id,stage_key,stage_name,stage_icon,stage_position,"
                    "completed,skipped,template_removed,planned_datetime,notes,responsible_person,"
                    "opening_location,evaluation_location,publication_url) "
                    "VALUES (:pid,:sk,:sn,'•',:pos,0,0,0,:dt,'','张三','','','')"
                ),
                st_rows,
            )
            # Confirmed deadline 1: 10:00 today (already passed at 14:00 -> MUST be overdue=1, dueSoon=0!)
            # Confirmed deadline 2: date-only today (end of day -> MUST be overdue=0, dueSoon=1!)
            conn.execute(
                text(
                    "INSERT INTO business_deadline_items(id, project_id, revision, state, payload) VALUES "
                    "('bd-10am', 201, 1, 'confirmed', :p1),"
                    "('bd-date', 201, 1, 'confirmed', :p2)"
                ),
                {
                    "p1": '{"id":"bd-10am","state":"confirmed","title":"上午10点截止","confirmed_deadline":"2026-11-25T10:00","needs_review":false}',
                    "p2": '{"id":"bd-date","state":"confirmed","title":"当日全天截止","confirmed_deadline":"2026-11-25","needs_review":false}',
                },
            )
            self.db.session.commit()

            ref = business_deadlines.overview_summaries(
                [
                    {"id": "bd-10am", "project_id": 201, "state": "confirmed", "title": "上午10点截止", "confirmed_deadline": "2026-11-25T10:00", "needs_review": False},
                    {"id": "bd-date", "project_id": 201, "state": "confirmed", "title": "当日全天截止", "confirmed_deadline": "2026-11-25", "needs_review": False},
                ],
                now=now,
            )[201]["summary"]
            dash = project_listing.compute_dashboard_summary(self.db, {}, ctx=self.ctx, now=now)

        # P1③: Aggregated deadline_overview MUST match business_deadlines.overview_summaries (overdue=1, dueSoon=1)
        self.assertEqual(ref["overdue"], 1)
        self.assertEqual(ref["dueSoon"], 1)
        self.assertEqual(dash["deadline_overview"]["overdue"], ref["overdue"])
        self.assertEqual(dash["deadline_overview"]["dueSoon"], ref["dueSoon"])
        by_dl_id = {it["id"]: it for it in dash["deadline_overview"]["items"]}
        self.assertEqual(by_dl_id["bd-10am"]["time_status"], "overdue")
        self.assertEqual(by_dl_id["bd-date"]["time_status"], "soon")

        # P2①: Even with 121 overdue actions (>120 cap), task_buckets['soon'] MUST still contain the 1 tomorrow item!
        self.assertEqual(dash["metrics"]["overdue"], 121)
        self.assertEqual(dash["metrics"]["dueSoon"], 1)
        self.assertEqual(dash["task_buckets"]["soon"]["count"], 1)
        self.assertEqual(len(dash["task_buckets"]["soon"]["items"]), 1)
        self.assertEqual(dash["task_buckets"]["soon"]["items"][0]["stageKey"], "tomorrow_due")


if __name__ == "__main__":
    unittest.main()
