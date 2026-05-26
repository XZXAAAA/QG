"""
SQLite-backed cache for daily news articles and reports.

Schema
──────
news_articles  — individual processed articles (7-day TTL by default)
daily_reports  — per-date formatted daily reports
"""
from __future__ import annotations

import json
import logging
import os
import sqlite3
import time
from contextlib import contextmanager
from datetime import date, datetime, timedelta
from typing import Any, Generator, Optional

logger = logging.getLogger(__name__)

_DEFAULT_DB = os.path.join(os.path.dirname(__file__), "..", "..", "news_cache.db")
_DEFAULT_TTL_DAYS = 7

_DDL = """
PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS news_articles (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    guid          TEXT    NOT NULL UNIQUE,
    title         TEXT    NOT NULL,
    date_raw      TEXT,
    date_iso      TEXT,
    content       TEXT,
    link          TEXT,
    media         TEXT,
    category      TEXT,
    sentiment     TEXT,
    analysis_json TEXT,
    is_china      INTEGER DEFAULT 0,
    fetch_ts      REAL    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_articles_date  ON news_articles(date_iso);
CREATE INDEX IF NOT EXISTS idx_articles_fetch ON news_articles(fetch_ts);
CREATE INDEX IF NOT EXISTS idx_articles_cat   ON news_articles(category);

CREATE TABLE IF NOT EXISTS daily_reports (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    report_date  TEXT NOT NULL UNIQUE,
    content      TEXT,
    sections_json TEXT,
    created_ts   REAL NOT NULL
);
"""


class NewsCache:
    def __init__(self, db_path: str = _DEFAULT_DB, ttl_days: int = _DEFAULT_TTL_DAYS) -> None:
        self.db_path = os.path.abspath(db_path or _DEFAULT_DB)
        self.ttl_days = ttl_days
        db_dir = os.path.dirname(self.db_path)
        if db_dir:  # os.path.dirname("file.db") returns "" — skip makedirs in that case
            os.makedirs(db_dir, exist_ok=True)
        self._init_db()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @contextmanager
    def _conn(self) -> Generator[sqlite3.Connection, None, None]:
        conn = sqlite3.connect(self.db_path, timeout=10)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def _init_db(self) -> None:
        with self._conn() as conn:
            conn.executescript(_DDL)

    # ------------------------------------------------------------------
    # Article CRUD
    # ------------------------------------------------------------------

    def store_articles(self, articles: list[dict[str, Any]]) -> int:
        """
        Upsert a list of article dicts.  Returns the number of rows inserted/replaced.

        Expected keys per article (all optional except title/guid):
          guid, title, date_raw, date_iso, content, link, media,
          category, sentiment, analysis_json (str), is_china (bool/int)
        """
        if not articles:
            return 0

        rows = []
        ts = time.time()
        for a in articles:
            guid = a.get("guid") or a.get("link") or a.get("title", "")
            if not guid:
                continue
            analysis = a.get("analysis_json")
            if isinstance(analysis, dict):
                analysis = json.dumps(analysis, ensure_ascii=False)
            rows.append((
                guid,
                a.get("title", ""),
                a.get("date_raw"),
                a.get("date_iso"),
                a.get("content"),
                a.get("link"),
                a.get("media"),
                a.get("category"),
                a.get("sentiment"),
                analysis,
                int(bool(a.get("is_china", True))),
                ts,
            ))

        sql = """
        INSERT OR REPLACE INTO news_articles
          (guid, title, date_raw, date_iso, content, link, media,
           category, sentiment, analysis_json, is_china, fetch_ts)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
        """
        with self._conn() as conn:
            conn.executemany(sql, rows)
        logger.info("NewsCache: stored %d articles", len(rows))
        return len(rows)

    def get_articles_by_date(self, date_iso: str) -> list[dict]:
        """Return all articles whose date_iso matches the given YYYY-MM-DD string."""
        sql = "SELECT * FROM news_articles WHERE date_iso = ? ORDER BY fetch_ts DESC"
        with self._conn() as conn:
            rows = conn.execute(sql, (date_iso,)).fetchall()
        return [dict(r) for r in rows]

    def get_today_articles(self) -> list[dict]:
        return self.get_articles_by_date(date.today().isoformat())

    def get_recent_articles(self, days: int = 1) -> list[dict]:
        """Return articles fetched within the last `days` days."""
        cutoff = time.time() - days * 86400
        sql = "SELECT * FROM news_articles WHERE fetch_ts >= ? ORDER BY fetch_ts DESC"
        with self._conn() as conn:
            rows = conn.execute(sql, (cutoff,)).fetchall()
        return [dict(r) for r in rows]

    def search_by_company(self, company_name: str, days: int = 7) -> list[dict]:
        """
        Full-text keyword search on title + content for a company name.
        Looks back `days` days in fetch_ts.
        """
        if not company_name:
            return []
        cutoff = time.time() - days * 86400
        pattern = f"%{company_name}%"
        sql = """
        SELECT * FROM news_articles
        WHERE fetch_ts >= ?
          AND (title LIKE ? OR content LIKE ?)
        ORDER BY fetch_ts DESC
        LIMIT 50
        """
        with self._conn() as conn:
            rows = conn.execute(sql, (cutoff, pattern, pattern)).fetchall()
        return [dict(r) for r in rows]

    def get_all_recent_for_context(self, days: int = 1, limit: int = 30) -> list[dict]:
        """Return today's / recent articles for LLM context injection."""
        cutoff = time.time() - days * 86400
        sql = """
        SELECT title, date_iso, content, media, category, sentiment, analysis_json
        FROM news_articles
        WHERE fetch_ts >= ?
        ORDER BY fetch_ts DESC
        LIMIT ?
        """
        with self._conn() as conn:
            rows = conn.execute(sql, (cutoff, limit)).fetchall()
        return [dict(r) for r in rows]

    # ------------------------------------------------------------------
    # Daily report CRUD
    # ------------------------------------------------------------------

    def store_daily_report(
        self, report_date: str, content: str, sections: list[dict]
    ) -> None:
        sql = """
        INSERT OR REPLACE INTO daily_reports (report_date, content, sections_json, created_ts)
        VALUES (?, ?, ?, ?)
        """
        with self._conn() as conn:
            conn.execute(sql, (
                report_date,
                content,
                json.dumps(sections, ensure_ascii=False),
                time.time(),
            ))
        logger.info("NewsCache: stored daily report for %s", report_date)

    def get_daily_report(self, report_date: str) -> Optional[dict]:
        sql = "SELECT * FROM daily_reports WHERE report_date = ?"
        with self._conn() as conn:
            row = conn.execute(sql, (report_date,)).fetchone()
        if row is None:
            return None
        d = dict(row)
        try:
            d["sections"] = json.loads(d.get("sections_json") or "[]")
        except Exception:
            d["sections"] = []
        return d

    def get_today_report(self) -> Optional[dict]:
        return self.get_daily_report(date.today().isoformat())

    def get_latest_report(self) -> Optional[dict]:
        sql = "SELECT * FROM daily_reports ORDER BY report_date DESC LIMIT 1"
        with self._conn() as conn:
            row = conn.execute(sql).fetchone()
        if row is None:
            return None
        d = dict(row)
        try:
            d["sections"] = json.loads(d.get("sections_json") or "[]")
        except Exception:
            d["sections"] = []
        return d

    # ------------------------------------------------------------------
    # Maintenance
    # ------------------------------------------------------------------

    def purge_old_articles(self) -> int:
        cutoff = time.time() - self.ttl_days * 86400
        with self._conn() as conn:
            cur = conn.execute(
                "DELETE FROM news_articles WHERE fetch_ts < ?", (cutoff,)
            )
        logger.info("NewsCache: purged %d stale articles", cur.rowcount)
        return cur.rowcount

    def stats(self) -> dict:
        with self._conn() as conn:
            total = conn.execute("SELECT COUNT(*) FROM news_articles").fetchone()[0]
            today = conn.execute(
                "SELECT COUNT(*) FROM news_articles WHERE date_iso = ?",
                (date.today().isoformat(),),
            ).fetchone()[0]
            reports = conn.execute("SELECT COUNT(*) FROM daily_reports").fetchone()[0]
        return {"total_articles": total, "today_articles": today, "total_reports": reports}
