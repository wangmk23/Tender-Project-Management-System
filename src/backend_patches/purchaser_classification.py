"""Lightweight purchaser classification for the packaged desktop application."""

from __future__ import annotations

import re
import sqlite3
from contextlib import closing
from datetime import datetime
from pathlib import Path

from data_safety import run_additive_migration


SCHEMA_VERSION = "2"
RULE_VERSION = "1"
DEFAULT_COLOR = "#2563EB"
COLOR_PATTERN = re.compile(r"^#[0-9a-fA-F]{6}$")
ALLOWED_ACTIONS = {
    "upsert_category",
    "move_purchaser",
    "deactivate_category",
    "restore_auto_classification",
}

PRESET_CATEGORIES = [
    {"name": "教育机构", "color": "#3B82F6", "sort_order": 1},
    {"name": "医疗卫生", "color": "#EF4444", "sort_order": 2},
    {"name": "行政机关", "color": "#6366F1", "sort_order": 3},
    {"name": "金融机构", "color": "#F59E0B", "sort_order": 4},
    {"name": "基层自治组织", "color": "#10B981", "sort_order": 5},
    {"name": "企业", "color": "#8B5CF6", "sort_order": 6},
]

# 单位性质自动识别规则：按列表顺序匹配，第一个命中的性质即为结果。
# 顺序从特异到宽泛，避免"XX银行股份有限公司"被误判为企业。
NATURE_RULES = [
    ("金融机构", ["银行", "证券", "保险", "信用社", "农商行"]),
    ("基层自治组织", [
        "居民委员会", "村民委员会", "社区居民委员会", "街道办事处",
        "经济联合社", "股份经济联合社", "股份合作社",
    ]),
    ("医疗卫生", ["医院", "卫生院", "疾病预防控制", "妇幼保健", "卫生监督"]),
    ("教育机构", ["学校", "学院", "大学", "幼儿园", "中学", "小学", "进修学校"]),
    ("企业", ["股份有限公司", "有限责任公司", "有限公司", "公司", "集团"]),
    ("行政机关", [
        "人民政府", "管理局", "监察局", "公安局", "财政局", "教育局",
        "卫生局", "消防", "交通", "支队", "大队", "分局", "办事处",
        "管理委员会", "机关",
    ]),
]


class PurchaserClassificationError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def _is_integrity_error(exc: Exception) -> bool:
    return isinstance(exc, sqlite3.IntegrityError) or exc.__class__.__name__ == "IntegrityError"


def _connect(database_path, encrypted_connect=None, master_key=None):
    database_path = Path(database_path)
    database_path.parent.mkdir(parents=True, exist_ok=True)
    if encrypted_connect is None:
        connection = sqlite3.connect(str(database_path), timeout=5)
    else:
        connection = encrypted_connect(database_path, master_key, False)
    row_module = __import__(connection.__class__.__module__, fromlist=["Row"])
    connection.row_factory = getattr(row_module, "Row", sqlite3.Row)
    connection.execute("PRAGMA foreign_keys=ON")
    return connection


def _now() -> str:
    return datetime.now().replace(microsecond=0).isoformat(sep=" ")


def _schema_ready(connection) -> bool:
    tables = {
        row["name"]
        for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name IN "
            "('purchaser_schema_meta', 'purchaser_categories', "
            "'purchaser_category_assignments', 'purchaser_classification_audit', "
            "'__safe_migration_versions')"
        )
    }
    if len(tables) != 5:
        return False
    row = connection.execute(
        "SELECT value FROM purchaser_schema_meta WHERE key='schema_version'"
    ).fetchone()
    safe_row = connection.execute(
        "SELECT value FROM __safe_migration_versions "
        "WHERE namespace='purchaser_classification'"
    ).fetchone()
    return bool(
        row
        and row["value"] == SCHEMA_VERSION
        and safe_row
        and safe_row["value"] == SCHEMA_VERSION
    )


def _seed_preset_categories(connection):
    now = _now()
    for preset in PRESET_CATEGORIES:
        connection.execute(
            "INSERT OR IGNORE INTO purchaser_categories "
            "(name, color, sort_order, is_active, created_at, updated_at) "
            "VALUES (?, ?, ?, 1, ?, ?)",
            (preset["name"], preset["color"], preset["sort_order"], now, now),
        )


def classify_purchaser_nature(name):
    """Return the current automatic rule result and its provenance."""
    if not name:
        return {
            "category_name": None,
            "rule_version": None,
            "matched_keyword": None,
        }
    for nature, keywords in NATURE_RULES:
        for keyword in keywords:
            if keyword in name:
                return {
                    "category_name": nature,
                    "rule_version": RULE_VERSION,
                    "matched_keyword": keyword,
                }
    return {
        "category_name": None,
        "rule_version": None,
        "matched_keyword": None,
    }


def ensure_schema(database_path, backup_dir, encrypted_connect=None, master_key=None):
    database_path = Path(database_path)
    with closing(_connect(database_path, encrypted_connect, master_key)) as connection:
        if _schema_ready(connection):
            return
    run_additive_migration(
        database_path,
        backup_dir,
        "purchaser_classification",
        SCHEMA_VERSION,
        [
            """
            CREATE TABLE IF NOT EXISTS purchaser_schema_meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS purchaser_categories (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                color TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0,
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS purchaser_category_assignments (
                purchaser_key TEXT PRIMARY KEY,
                category_id INTEGER NOT NULL REFERENCES purchaser_categories(id),
                updated_at TEXT NOT NULL,
                updated_by TEXT NOT NULL DEFAULT ''
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS purchaser_classification_audit (
                id INTEGER PRIMARY KEY,
                action TEXT NOT NULL,
                purchaser_key TEXT NOT NULL,
                old_category_id INTEGER,
                old_category_name TEXT,
                new_category_id INTEGER,
                new_category_name TEXT,
                actor TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            )
            """,
            """
            CREATE INDEX IF NOT EXISTS idx_purchaser_assignments_category
            ON purchaser_category_assignments(category_id, purchaser_key)
            """,
            """
            CREATE INDEX IF NOT EXISTS idx_purchaser_classification_audit_unit
            ON purchaser_classification_audit(purchaser_key, id)
            """,
        ],
        encrypted_connect=encrypted_connect,
        master_key=master_key,
    )
    with closing(_connect(database_path, encrypted_connect, master_key)) as connection:
        with connection:
            _seed_preset_categories(connection)
            connection.execute(
                "INSERT INTO purchaser_schema_meta(key, value) VALUES ('schema_version', ?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (SCHEMA_VERSION,),
            )


def _category(row):
    return {
        "id": row["id"],
        "name": row["name"],
        "color": row["color"],
        "sort_order": row["sort_order"],
        "is_active": bool(row["is_active"]),
    }


def _project_columns(connection) -> set[str]:
    return {str(row["name"]) for row in connection.execute("PRAGMA table_info(projects)")}


def _project_rows(connection):
    from data_safety import _quote_identifier

    columns = _project_columns(connection)
    if not {"id", "purchaser"}.issubset(columns):
        return []
    created_at = (
        _quote_identifier("created_at")
        if "created_at" in columns
        else "'' AS created_at"
    )
    year = _quote_identifier("year") if "year" in columns else "'' AS year"
    return connection.execute(
        f"SELECT {_quote_identifier('id')}, {_quote_identifier('purchaser')}, "
        f"{created_at}, {year} FROM projects ORDER BY {_quote_identifier('id')}"
    ).fetchall()


def _aggregate_units(connection):
    grouped = {}
    for row in _project_rows(connection):
        name = str(row["purchaser"] or "").strip()
        if not name:
            continue
        unit = grouped.setdefault(
            name,
            {"name": name, "project_ids": [], "created_at": [], "years": []},
        )
        unit["project_ids"].append(int(row["id"]))
        created_at = str(row["created_at"] or "").strip()
        year = str(row["year"] or "").strip()
        if created_at:
            unit["created_at"].append(created_at)
        if year:
            unit["years"].append(year)

    result = {}
    for name, unit in grouped.items():
        project_ids = sorted(unit["project_ids"])
        recent = max(unit["created_at"], default="")
        if not recent:
            recent = max(unit["years"], default="")
        result[name] = {
            "name": name,
            "project_count": len(project_ids),
            "recent_project": recent,
            "project_ids": project_ids,
        }
    return result


def _build_purchaser_board(all_categories, assignments, units, is_admin):
    """Apply the one shared manual-first classification contract to unit rows."""
    units = {name: dict(unit) for name, unit in units.items()}
    categories = [category for category in all_categories if category["is_active"]]
    all_by_id = {category["id"]: category for category in all_categories}
    active_by_id = {category["id"]: category for category in categories}
    # 性质名 → 分类 ID 映射，用于自动识别
    nature_to_category = {cat["name"]: cat["id"] for cat in categories}
    grouped = {category["id"]: [] for category in categories}
    inactive_manual_grouped = {}
    unclassified = []
    for name in sorted(units):
        # 手动映射优先
        category_id = assignments.get(name)
        manual_category = all_by_id.get(category_id)
        if manual_category is not None:
            units[name].update(
                classification_source="manual",
                rule_version=None,
                matched_keyword=None,
            )
            if category_id in active_by_id:
                grouped[category_id].append(units[name])
            else:
                units[name].update(
                    classification_status="inactive_manual_category",
                    requires_attention=True,
                )
                inactive_manual_grouped.setdefault(category_id, []).append(units[name])
            continue
        # 无手动映射时，按名称自动识别单位性质
        rule_result = classify_purchaser_nature(name)
        category_name = rule_result["category_name"]
        auto_id = nature_to_category.get(category_name) if category_name else None
        if auto_id and auto_id in active_by_id:
            units[name].update(
                classification_source="auto",
                rule_version=rule_result["rule_version"],
                matched_keyword=rule_result["matched_keyword"],
            )
            grouped[auto_id].append(units[name])
        else:
            units[name].update(
                classification_source="unclassified",
                rule_version=None,
                matched_keyword=None,
            )
            unclassified.append(units[name])

    groups = [
        {"category": category, "name": category["name"], "units": grouped[category["id"]]}
        for category in categories
        if grouped[category["id"]]
    ]
    groups.extend(
        {
            "category": all_by_id[category_id],
            "name": all_by_id[category_id]["name"],
            "units": inactive_manual_grouped[category_id],
            "classification_status": "inactive_manual_category",
            "requires_attention": True,
        }
        for category_id in sorted(
            inactive_manual_grouped,
            key=lambda value: (
                all_by_id[value]["sort_order"],
                all_by_id[value]["name"],
                value,
            ),
        )
    )
    groups.append({"category": None, "name": "未分类", "units": unclassified})
    return {
        "categories": categories,
        "groups": groups,
        "unit_total": len(units),
        "is_admin": bool(is_admin),
    }


def read_purchaser_board(
    database_path,
    backup_dir,
    is_admin,
    encrypted_connect=None,
    master_key=None,
):
    ensure_schema(database_path, backup_dir, encrypted_connect, master_key)
    with closing(_connect(database_path, encrypted_connect, master_key)) as connection:
        category_rows = connection.execute(
            "SELECT * FROM purchaser_categories ORDER BY sort_order, name, id"
        ).fetchall()
        all_categories = [_category(row) for row in category_rows]
        assignments = {
            row["purchaser_key"]: row["category_id"]
            for row in connection.execute(
                "SELECT purchaser_key, category_id FROM purchaser_category_assignments"
            )
        }
        units = _aggregate_units(connection)
    return _build_purchaser_board(all_categories, assignments, units, is_admin)


def _require_admin(is_admin):
    if not is_admin:
        raise PurchaserClassificationError("仅管理员可执行此操作", 403)


def _parse_category_id(value, allow_none=False):
    if allow_none and (value is None or value == ""):
        return None
    try:
        category_id = int(value)
    except (TypeError, ValueError):
        raise PurchaserClassificationError("分类编号无效") from None
    if category_id <= 0:
        raise PurchaserClassificationError("分类编号无效")
    return category_id


def _active_category(connection, category_id):
    row = connection.execute(
        "SELECT * FROM purchaser_categories WHERE id=? AND is_active=1",
        (category_id,),
    ).fetchone()
    if row is None:
        raise PurchaserClassificationError("分类不存在", 404)
    return row


def _upsert_category(connection, payload):
    name = str(payload.get("name") or "").strip()
    if not name or name == "未分类":
        raise PurchaserClassificationError("请输入有效的分类名称")
    color = str(payload.get("color") or DEFAULT_COLOR).strip().upper()
    if not COLOR_PATTERN.fullmatch(color):
        raise PurchaserClassificationError("分类颜色格式无效")
    try:
        sort_order = int(payload.get("sort_order", 0))
    except (TypeError, ValueError):
        raise PurchaserClassificationError("分类排序必须是整数") from None
    now = _now()
    category_id = payload.get("id")
    if category_id in (None, ""):
        cursor = connection.execute(
            """
            INSERT INTO purchaser_categories
                (name, color, sort_order, is_active, created_at, updated_at)
            VALUES (?, ?, ?, 1, ?, ?)
            """,
            (name, color, sort_order, now, now),
        )
        category_id = cursor.lastrowid
    else:
        category_id = _parse_category_id(category_id)
        _active_category(connection, category_id)
        connection.execute(
            "UPDATE purchaser_categories SET name=?, color=?, sort_order=?, updated_at=? "
            "WHERE id=?",
            (name, color, sort_order, now, category_id),
        )
    return _category(_active_category(connection, category_id))


def _current_purchaser_names(connection):
    return set(_aggregate_units(connection))


def _move_purchaser(connection, payload, actor):
    purchaser_name = str(payload.get("purchaser_name") or "").strip()
    if not purchaser_name or purchaser_name not in _current_purchaser_names(connection):
        raise PurchaserClassificationError("采购人单位不存在", 404)
    category_id = _parse_category_id(payload.get("category_id"), allow_none=True)
    if category_id is None:
        connection.execute(
            "DELETE FROM purchaser_category_assignments WHERE purchaser_key=?",
            (purchaser_name,),
        )
    else:
        _active_category(connection, category_id)
        connection.execute(
            """
            INSERT INTO purchaser_category_assignments
                (purchaser_key, category_id, updated_at, updated_by)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(purchaser_key) DO UPDATE SET
                category_id=excluded.category_id,
                updated_at=excluded.updated_at,
                updated_by=excluded.updated_by
            """,
            (purchaser_name, category_id, _now(), str(actor or "")),
        )
    return {"purchaser_name": purchaser_name, "category_id": category_id}


def _restore_auto_classification(connection, payload, actor):
    purchaser_name = str(payload.get("purchaser_name") or "").strip()
    if not purchaser_name or purchaser_name not in _current_purchaser_names(connection):
        raise PurchaserClassificationError("采购人单位不存在", 404)

    # Acquire the write reservation before reading the override. This keeps the
    # read, guarded delete and audit insert in one serialization window.
    connection.execute("BEGIN IMMEDIATE")
    assignment = connection.execute(
        "SELECT a.category_id, c.name AS category_name "
        "FROM purchaser_category_assignments a "
        "LEFT JOIN purchaser_categories c ON c.id=a.category_id "
        "WHERE a.purchaser_key=?",
        (purchaser_name,),
    ).fetchone()
    if assignment is None:
        raise PurchaserClassificationError("该采购人单位当前没有手工分类", 409)

    rule_result = classify_purchaser_nature(purchaser_name)
    automatic_category = None
    if rule_result["category_name"]:
        automatic_category = connection.execute(
            "SELECT id, name FROM purchaser_categories WHERE name=? AND is_active=1",
            (rule_result["category_name"],),
        ).fetchone()

    deleted = connection.execute(
        "DELETE FROM purchaser_category_assignments "
        "WHERE purchaser_key=? AND category_id=?",
        (purchaser_name, assignment["category_id"]),
    )
    if deleted.rowcount != 1:
        raise PurchaserClassificationError("手工分类已发生变化，请刷新后重试", 409)

    new_category_id = automatic_category["id"] if automatic_category else None
    new_category_name = automatic_category["name"] if automatic_category else None
    connection.execute(
        """
        INSERT INTO purchaser_classification_audit
            (action, purchaser_key, old_category_id, old_category_name,
             new_category_id, new_category_name, actor, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            "restore_auto_classification",
            purchaser_name,
            assignment["category_id"],
            assignment["category_name"],
            new_category_id,
            new_category_name,
            str(actor or ""),
            _now(),
        ),
    )
    return {
        "purchaser_name": purchaser_name,
        "category_id": new_category_id,
        "classification_source": "auto" if automatic_category else "unclassified",
        "rule_version": rule_result["rule_version"] if automatic_category else None,
        "matched_keyword": rule_result["matched_keyword"] if automatic_category else None,
    }


def _deactivate_category(connection, payload):
    category_id = _parse_category_id(payload.get("id"))
    _active_category(connection, category_id)
    assignment = connection.execute(
        "SELECT 1 FROM purchaser_category_assignments WHERE category_id=? LIMIT 1",
        (category_id,),
    ).fetchone()
    if assignment:
        raise PurchaserClassificationError("该分类仍有采购人单位，请先移动后再停用", 409)
    connection.execute(
        "UPDATE purchaser_categories SET is_active=0, updated_at=? WHERE id=?",
        (_now(), category_id),
    )
    return {"id": category_id, "deactivated": True}


def execute_purchaser_action(
    database_path,
    backup_dir,
    action,
    payload,
    is_admin,
    actor,
    encrypted_connect=None,
    master_key=None,
):
    try:
        _require_admin(is_admin)
        if action not in ALLOWED_ACTIONS:
            raise PurchaserClassificationError("不支持的采购人分类操作")
        ensure_schema(database_path, backup_dir, encrypted_connect, master_key)
        with closing(_connect(database_path, encrypted_connect, master_key)) as connection:
            with connection:
                if action == "upsert_category":
                    result = {"category": _upsert_category(connection, payload)}
                elif action == "move_purchaser":
                    result = _move_purchaser(connection, payload, actor)
                elif action == "deactivate_category":
                    result = _deactivate_category(connection, payload)
                else:
                    result = _restore_auto_classification(connection, payload, actor)
        return result, 200
    except PurchaserClassificationError as exc:
        return {"error": str(exc)}, exc.status
    except Exception as exc:
        if _is_integrity_error(exc):
            return {"error": "分类名称已存在或数据冲突"}, 409
        raise
