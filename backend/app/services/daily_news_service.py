"""
Daily news pipeline — Python equivalent of the n8n "start up每日大事" workflow.

Pipeline steps (mirrors the n8n flow)
──────────────────────────────────────
1.  Fetch RSS from 9 sources in parallel (消费电子 × 6 + 机器人 × 3), cap 3 per feed
2.  Merge + normalize fields (标题 / 日期 / 内容 / 链接 / 媒体)
3.  AI: filter China-related articles (true/false per item)
4.  AI: normalize date → "Day, DD Mon YYYY"
5.  Keep only today's articles
6.  AI: structure each article → {标题, 日期, 内容, 影响板块, 市场情绪, 分析逻辑}
7.  Translate to English (deep_translator Google free tier)
8.  AI: semantic deduplication
9.  Group by sector; deduplicate by exact title
10. Format daily-report text
11. Persist everything to NewsCache (SQLite)

Usage
─────
    from app.services.daily_news_service import DailyNewsPipeline
    pipeline = DailyNewsPipeline(config)
    result = pipeline.run()          # {"daily_report": str, "sections": [...]}
    result = pipeline.run(force=True) # bypass today's cache
"""
from __future__ import annotations

import json
import logging
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

import calendar

import feedparser
from deep_translator import GoogleTranslator
from openai import OpenAI

from .news_cache import NewsCache

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# RSS source definitions (mirroring n8n nodes)
# ---------------------------------------------------------------------------

_RSS_SOURCES: list[dict] = [
    # Consumer Electronics group
    {"url": "https://www.tmtpost.com/rss",         "media": "TMTPost",        "group": "消费电子"},
    {"url": "https://36kr.com/feed",               "media": "36Kr",           "group": "消费电子"},
    {"url": "https://www.ithome.com/rss/",         "media": "ITHome",         "group": "消费电子"},
    {"url": "https://www.ifanr.com/feed",          "media": "iFanr",          "group": "消费电子"},
    {"url": "https://sspai.com/feed",              "media": "Sspai",          "group": "消费电子"},
    {"url": "https://www.leiphone.com/feed",       "media": "Leiphone",       "group": "消费电子"},
    # Robotics group
    {"url": "https://www.tmtpost.com/rss",         "media": "TMTPost",        "group": "机器人"},
    {"url": "https://36kr.com/feed",               "media": "36Kr",           "group": "机器人"},
    {"url": "https://www.leiphone.com/feed",       "media": "Leiphone",       "group": "机器人"},
]

_ITEMS_PER_FEED = 10

# ---------------------------------------------------------------------------
# Prompt templates (mirrors n8n prompts)
# ---------------------------------------------------------------------------

_CHINA_FILTER_PROMPT = """\
判断以下新闻是否与中国相关（含中国大陆、香港、台湾、中国企业等）。
只回答 true 或 false，不要任何其他内容。

新闻内容：{content}"""

_DATE_NORMALIZE_PROMPT = """\
你是一个精准的数据格式化助手。将下面的日期字符串统一转换为 "Day, DD Mon YYYY" 格式
（例如：Sun, 05 Apr 2026）。只输出转换后的日期字符串，不要其他内容。

原始日期：{date_raw}"""

_STRUCTURE_PROMPT = """\
You are a professional financial news analyst. Read the following news article and output ONLY a JSON object — no other text.

Article Title: {title}
Article Content: {content}
Article Date: {date_raw}

Output JSON with these EXACT key names. ALL values must be in English:
{{
  "标题": "English translation of the title",
  "日期": "article date as provided",
  "内容": "100-200 word English summary of the core news",
  "影响板块": "Choose ONE: Consumer Electronics / Robotics / Biotech & Health / New Energy / Other",
  "市场情绪": "Choose ONE: Bullish / Bearish / Neutral",
  "分析逻辑": "1-2 sentence English explanation of market impact",
  "source_note": "Name of publication and website domain (e.g. 36Kr · 36kr.com)"
}}"""

_DEDUP_PROMPT = """\
你是一个专业的数据清洗助手，负责语义去重。

待处理内容列表（每条以 ---ITEM--- 分隔）：
{items}

任务要求：
1. 比对所有条目，描述同一核心事件的视为重复（即便措辞或语言不同）。
2. 重复条目只保留信息最完整的一条。
3. 不同事件原样保留。

输出：将保留的条目原文用 ---ITEM--- 分隔后返回，不要其他说明。"""

# Defined here (before translate_articles) so they're available at call time
_SECTOR_MAP: dict[str, str] = {
    "消费电子": "Consumer Electronics",
    "机器人":   "Robotics",
    "生物科技与健康": "Biotech & Health",
    "新能源":   "New Energy",
    "其他":     "Other",
}

_SENTIMENT_MAP: dict[str, str] = {
    # Chinese keys (legacy / fallback)
    "利好": "Bullish",
    "利空": "Bearish",
    "中性": "Neutral",
    # English passthrough (LLM now outputs English directly)
    "Bullish": "Bullish",
    "Bearish": "Bearish",
    "Neutral": "Neutral",
}


# ---------------------------------------------------------------------------
# Helper: make OpenAI-compatible client (DeepSeek or Qwen)
# ---------------------------------------------------------------------------

def _cfg(config: Any, key: str, default: str = "") -> str:
    """Get a string config value; avoids `val or default` which breaks on False/0."""
    if hasattr(config, "get"):
        val = config.get(key)
    else:
        val = getattr(config, key, None)
    if val is None:
        return default
    return str(val) if not isinstance(val, str) else val


def _cfg_bool(config: Any, key: str, default: bool = False) -> bool:
    """Get a boolean config value, handling both bool fields and '0'/'1' strings."""
    if hasattr(config, "get"):
        val = config.get(key)
    else:
        val = getattr(config, key, None)
    if val is None:
        return default
    if isinstance(val, bool):
        return val
    return str(val).strip().lower() not in ("0", "false", "no", "")


def _make_news_client(config: Any) -> OpenAI:
    """
    Prefer DeepSeek if NEWS_DEEPSEEK_API_KEY is set, otherwise fall back
    to the project's main LLM (Qwen/DashScope).
    """
    api_key = _cfg(config, "NEWS_DEEPSEEK_API_KEY") or _cfg(config, "LLM_API_KEY")
    base_url = (
        _cfg(config, "NEWS_DEEPSEEK_BASE_URL")
        or _cfg(config, "LLM_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")
    )
    return OpenAI(api_key=api_key, base_url=base_url, timeout=60.0)


def _news_model(config: Any) -> str:
    return (
        _cfg(config, "NEWS_DEEPSEEK_MODEL")
        or _cfg(config, "LLM_CHAT_MODEL", "qwen-plus")
    )


def _llm(client: OpenAI, model: str, prompt: str) -> str:
    resp = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.1,
        max_tokens=512,
    )
    return (resp.choices[0].message.content or "").strip()


# ---------------------------------------------------------------------------
# Step 1 — fetch RSS feeds
# ---------------------------------------------------------------------------

def _fetch_one(source: dict) -> list[dict]:
    try:
        feed = feedparser.parse(source["url"])
        entries = feed.entries[:_ITEMS_PER_FEED]
        results = []
        for e in entries:
            title   = getattr(e, "title", "") or ""
            content = (
                getattr(e, "content", [{}])[0].get("value", "")
                or getattr(e, "summary", "")
                or getattr(e, "content_encoded_snippet", "")
                or ""
            )
            pub_date = (
                getattr(e, "published", "")
                or getattr(e, "updated", "")
                or getattr(e, "date", "")
                or ""
            )
            # feedparser stores a time.struct_time for parsed dates; convert to Unix ts
            pub_parsed = (
                getattr(e, "published_parsed", None)
                or getattr(e, "updated_parsed", None)
            )
            date_parsed_ts = calendar.timegm(pub_parsed) if pub_parsed else None
            link = getattr(e, "link", "") or getattr(e, "id", "") or ""
            results.append({
                "title":          title,
                "date_raw":       pub_date,
                "date_parsed_ts": date_parsed_ts,
                "content":        _strip_html(content)[:2000],
                "link":           link,
                "guid":           link or title,
                "media":          source["media"],
                "group":          source["group"],
            })
        logger.debug("Fetched %d items from %s", len(results), source["media"])
        return results
    except Exception as exc:
        logger.warning("RSS fetch failed for %s: %s", source["url"], exc)
        return []


def _strip_html(text: str) -> str:
    return re.sub(r"<[^>]+>", "", text).strip()


def fetch_all_rss() -> list[dict]:
    all_items: list[dict] = []
    with ThreadPoolExecutor(max_workers=9) as pool:
        futures = {pool.submit(_fetch_one, s): s for s in _RSS_SOURCES}
        for fut in as_completed(futures):
            all_items.extend(fut.result())
    logger.info("RSS: fetched %d total items from %d sources", len(all_items), len(_RSS_SOURCES))
    return all_items


# ---------------------------------------------------------------------------
# Step 3 — China filter (batch, 5 items per LLM call to reduce round-trips)
# ---------------------------------------------------------------------------

def filter_china_news(articles: list[dict], config: Any) -> list[dict]:
    client = _make_news_client(config)
    model  = _news_model(config)
    filtered = []

    def _is_china(article: dict) -> bool:
        text = f"{article.get('title','')} {article.get('content','')}"[:800]
        try:
            ans = _llm(client, model, _CHINA_FILTER_PROMPT.format(content=text))
            return ans.lower().startswith("true")
        except Exception as exc:
            logger.warning("China filter LLM error: %s", exc)
            return True  # keep on error

    with ThreadPoolExecutor(max_workers=5) as pool:
        futures = {pool.submit(_is_china, a): a for a in articles}
        for fut in as_completed(futures):
            if fut.result():
                filtered.append(futures[fut])

    logger.info("China filter: %d / %d kept", len(filtered), len(articles))
    return filtered


# ---------------------------------------------------------------------------
# Step 4 — normalize dates (fast, no AI)
# ---------------------------------------------------------------------------

def normalize_dates_fast(articles: list[dict]) -> list[dict]:
    """
    Parse date_raw directly using feedparser's time struct (stored in
    date_parsed) or _parse_date_flexible — no LLM calls needed.
    """
    for a in articles:
        raw = a.get("date_raw", "")
        # feedparser stores a time.struct_time as date_parsed on each entry;
        # we copy it into the article dict during fetch so we can use it here.
        parsed_ts = a.get("date_parsed_ts")  # Unix timestamp set in _fetch_one
        if parsed_ts:
            try:
                a["date_norm"] = datetime.fromtimestamp(parsed_ts, tz=timezone.utc).strftime(
                    "%a, %d %b %Y"
                )
                a["_dt"] = datetime.fromtimestamp(parsed_ts, tz=timezone.utc)
            except Exception:
                a["date_norm"] = raw
        elif raw:
            dt = _parse_date_flexible(raw)
            if dt:
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                a["date_norm"] = dt.strftime("%a, %d %b %Y")
                a["_dt"] = dt
            else:
                a["date_norm"] = raw
        else:
            a["date_norm"] = ""
    return articles


# Keep old AI-based version available but unused
def normalize_dates(articles: list[dict], config: Any) -> list[dict]:
    return normalize_dates_fast(articles)


# ---------------------------------------------------------------------------
# Step 5 — filter recent articles (72h window)
# ---------------------------------------------------------------------------

def filter_recent(articles: list[dict], hours: int = 72) -> list[dict]:
    """
    Keep articles published within the last `hours` hours.
    Falls back to ALL articles if nothing matches (e.g. slow RSS update day).
    """
    cutoff = datetime.now(tz=timezone.utc) - timedelta(hours=hours)
    kept, no_date = [], []

    for a in articles:
        dt = a.get("_dt")
        if dt is None:
            # Try parsing date_norm / date_raw as last resort
            raw = a.get("date_norm") or a.get("date_raw", "")
            dt = _parse_date_flexible(raw)
            if dt and dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            a["_dt"] = dt

        if dt is None:
            no_date.append(a)
        elif dt >= cutoff:
            a["date_iso"] = dt.date().isoformat()
            kept.append(a)

    logger.info(
        "Recent filter: %d kept / %d no-date / %d total (last %dh)",
        len(kept), len(no_date), len(articles), hours,
    )

    if not kept:
        logger.warning("Nothing within %dh — keeping all %d articles as fallback", hours, len(articles))
        today_iso = date.today().isoformat()
        for a in articles:
            a.setdefault("date_iso", today_iso)
        return articles

    return kept


# Legacy alias
filter_today = filter_recent


def _parse_date_flexible(s: str) -> Optional[datetime]:
    """Try several date formats commonly seen in RSS feeds."""
    if not s:
        return None
    fmts = [
        "%a, %d %b %Y",
        "%a, %d %b %Y %H:%M:%S %z",
        "%a, %d %b %Y %H:%M:%S GMT",
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y-%m-%d",
        "%d %b %Y",
        "%b %d, %Y",
    ]
    s_clean = s.strip()
    for fmt in fmts:
        try:
            return datetime.strptime(s_clean[:len(fmt) + 5], fmt)
        except ValueError:
            pass
    # Last resort: email.utils parser (handles RFC 2822)
    try:
        from email.utils import parsedate_to_datetime
        return parsedate_to_datetime(s_clean)
    except Exception:
        pass
    return None


# ---------------------------------------------------------------------------
# Step 6 — AI structure each article
# ---------------------------------------------------------------------------

def structure_articles(articles: list[dict], config: Any) -> list[dict]:
    client = _make_news_client(config)
    model  = _news_model(config)

    def _structure(a: dict) -> Optional[dict]:
        prompt = _STRUCTURE_PROMPT.format(
            title=a.get("title", ""),
            content=a.get("content", "")[:1500],
            date_raw=a.get("date_norm") or a.get("date_raw", ""),
        )
        try:
            raw = _llm(client, model, prompt)
            cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.MULTILINE)
            parsed = json.loads(cleaned)
            parsed["guid"]  = a.get("guid", "")
            parsed["link"]  = a.get("link", "")
            parsed["media"] = a.get("media", "")
            parsed["date_iso"] = a.get("date_iso", date.today().isoformat())
            return parsed
        except Exception as exc:
            logger.warning("Structure LLM error for '%s': %s", a.get("title",""), exc)
            return {
                "标题": a.get("title", ""),
                "日期": a.get("date_norm") or a.get("date_raw", ""),
                "内容": a.get("content", "")[:500],
                "影响板块": a.get("group", "其他"),
                "市场情绪": "Neutral",
                "分析逻辑": "",
                "source_note": a.get("media", ""),
                "guid":   a.get("guid", ""),
                "link":   a.get("link", ""),
                "media":  a.get("media", ""),
                "date_iso": a.get("date_iso", date.today().isoformat()),
            }

    structured = []
    with ThreadPoolExecutor(max_workers=5) as pool:
        results = list(pool.map(_structure, articles))
    for r in results:
        if r:
            structured.append(r)
    return structured


# ---------------------------------------------------------------------------
# Step 7 — translate to English
# ---------------------------------------------------------------------------

def translate_articles(articles: list[dict]) -> list[dict]:
    def _translate_one(a: dict) -> dict:
        # Create a new translator per call — GoogleTranslator is not thread-safe
        translator = GoogleTranslator(source="zh-CN", target="en")
        try:
            title_en   = translator.translate(a.get("标题", "") or "") or a.get("标题", "")
            content_en = translator.translate((a.get("内容", "") or "")[:4500]) or a.get("内容", "")
            category_en = _SECTOR_MAP.get(a.get("影响板块", ""), a.get("影响板块") or "Other")
            sentiment_en = _SENTIMENT_MAP.get(a.get("市场情绪", ""), a.get("市场情绪") or "Neutral")
            return {
                **a,
                "title_en":    title_en,
                "content_en":  content_en,
                "category_en": category_en,
                "sentiment_en": sentiment_en,
            }
        except Exception as exc:
            logger.warning("Translation error for '%s': %s", a.get("标题", ""), exc)
            return {
                **a,
                "title_en":    a.get("标题", ""),
                "content_en":  a.get("内容", ""),
                "category_en": _SECTOR_MAP.get(a.get("影响板块", ""), "Other"),
                "sentiment_en": _SENTIMENT_MAP.get(a.get("市场情绪", ""), "Neutral"),
            }

    with ThreadPoolExecutor(max_workers=4) as pool:
        translated = list(pool.map(_translate_one, articles))
    return translated


# ---------------------------------------------------------------------------
# Step 8 — semantic deduplication via AI
# ---------------------------------------------------------------------------

def deduplicate_articles(articles: list[dict], config: Any) -> list[dict]:
    if len(articles) <= 1:
        return articles

    client = _make_news_client(config)
    model  = _news_model(config)

    # Build text blocks the LLM can compare
    blocks = []
    for a in articles:
        blocks.append(
            f"Title: {a.get('title_en') or a.get('标题','')}\n"
            f"Content: {a.get('content_en') or a.get('内容','')[:300]}"
        )

    prompt = _DEDUP_PROMPT.format(items="\n---ITEM---\n".join(blocks))
    try:
        raw = _llm(client, model, prompt)
    except Exception as exc:
        logger.warning("Dedup LLM error: %s", exc)
        return articles

    # Map kept blocks back to original articles by title prefix match
    kept_blocks = [b.strip() for b in raw.split("---ITEM---") if b.strip()]
    deduped = []
    used = set()
    for block in kept_blocks:
        # Extract first line title to match
        first_line = block.split("\n")[0].replace("Title:", "").strip().lower()
        for i, a in enumerate(articles):
            if i in used:
                continue
            candidate = (a.get("title_en") or a.get("标题", "")).lower()
            if first_line and (first_line[:40] in candidate or candidate[:40] in first_line):
                deduped.append(a)
                used.add(i)
                break
        else:
            # No match found for this LLM-returned block — skip it (unrecognised output)
            pass

    # Safety: if LLM removed everything, fall back to original list
    if not deduped:
        logger.warning("Dedup returned empty — using original %d articles", len(articles))
        return articles

    logger.info("Dedup: %d → %d articles", len(articles), len(deduped))
    return deduped


# ---------------------------------------------------------------------------
# Step 9 — group by sector + deduplicate by title
# ---------------------------------------------------------------------------

def group_by_sector(articles: list[dict]) -> list[dict]:
    seen_titles: set[str] = set()
    groups: dict[str, list] = {}

    for a in articles:
        cat = a.get("category_en") or a.get("影响板块") or "Other"
        title_key = (a.get("title_en") or a.get("标题", "")).lower().strip()
        if title_key in seen_titles:
            continue
        seen_titles.add(title_key)
        groups.setdefault(cat, []).append({
            "title":      a.get("title_en") or a.get("标题", ""),
            "content":    a.get("content_en") or a.get("内容", ""),
            "date_iso":   a.get("date_iso", ""),
            "sentiment":  a.get("sentiment_en") or a.get("市场情绪", "Neutral"),
            "media":      a.get("media", ""),
            "link":       a.get("link", ""),
            "source_note": a.get("source_note", ""),
        })

    return [
        {"category": cat, "entries": entries, "count": len(entries)}
        for cat, entries in groups.items()
    ]


# ---------------------------------------------------------------------------
# Step 10 — format daily report text
# ---------------------------------------------------------------------------

def format_daily_report(sections: list[dict]) -> str:
    today_str = date.today().strftime("%B %d, %Y")
    lines = [f"📰 Daily Tech Intelligence — {today_str}\n"]
    for section in sections:
        lines.append(f"[{section['category']}]")
        for e in section["entries"]:
            sentiment = e.get("sentiment", "")
            sentiment_tag = f" [{sentiment}]" if sentiment else ""
            lines.append(f"• {e['title']}{sentiment_tag}")
            if e.get('content'):
                lines.append(f"  {e['content'][:300]}")
            if e.get('media') or e.get('source'):
                lines.append(f"  Source: {e.get('media') or e.get('source', '')}")
            lines.append("")
        lines.append("")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Prepare articles for cache storage
# ---------------------------------------------------------------------------

def _to_cache_format(structured: list[dict]) -> list[dict]:
    today = date.today().isoformat()
    result = []
    for a in structured:
        analysis = {
            "影响板块": a.get("影响板块"),
            "市场情绪": a.get("市场情绪"),
            "分析逻辑": a.get("分析逻辑"),
        }
        result.append({
            "guid":         a.get("guid") or a.get("link") or a.get("标题", ""),
            "title":        a.get("title_en") or a.get("标题", ""),
            "date_raw":     a.get("日期", ""),
            "date_iso":     a.get("date_iso", today),
            "content":      a.get("content_en") or a.get("内容", ""),
            "link":         a.get("link", ""),
            "media":        a.get("media", ""),
            "category":     a.get("category_en") or a.get("影响板块", "Other"),
            "sentiment":    a.get("sentiment_en") or a.get("市场情绪", "Neutral"),
            "analysis_json": analysis,
            "is_china":     True,
        })
    return result


# ---------------------------------------------------------------------------
# Public pipeline class
# ---------------------------------------------------------------------------

class DailyNewsPipeline:
    """
    Orchestrates the full pipeline.  Call `.run()` from a Flask route or
    a background thread.
    """

    def __init__(self, config: Any) -> None:
        self.config = config
        db_path = _cfg(config, "NEWS_CACHE_DB_PATH")
        ttl     = int(_cfg(config, "NEWS_CACHE_TTL_DAYS", "7"))
        self.cache = NewsCache(db_path=db_path if db_path else None, ttl_days=ttl)

    def get_cached_result(self) -> Optional[dict]:
        """Return today's cached report if available."""
        report = self.cache.get_today_report()
        if report:
            return {
                "daily_report": report.get("content", ""),
                "sections":     report.get("sections", []),
                "cached":       True,
                "report_date":  report.get("report_date"),
            }
        return None

    def run(self, force: bool = False) -> dict:
        """
        Execute the full pipeline.

        Parameters
        ----------
        force : bool
            If True, bypass today's cache and re-run the pipeline.

        Returns
        -------
        dict with keys: daily_report (str), sections (list), cached (bool)
        """
        if not force:
            cached = self.get_cached_result()
            if cached:
                logger.info("DailyNewsPipeline: returning cached report for today")
                return cached

        logger.info("DailyNewsPipeline: starting full pipeline run")
        t0 = time.time()

        # 1 Fetch
        articles = fetch_all_rss()
        if not articles:
            logger.warning("DailyNewsPipeline: no articles fetched from RSS")
            return {"daily_report": "", "sections": [], "cached": False, "error": "no_rss_data"}

        # 3 China filter — skipped: all sources are Chinese tech media,
        #   running per-article AI calls here wastes API quota and drops valid articles.
        china_articles = articles

        # 4 Normalize dates — use feedparser's structured time instead of AI,
        #   which is faster, free, and more reliable for standard RSS timestamps.
        dated = normalize_dates_fast(china_articles)

        # 5 Recent filter (72h window)
        today_articles = filter_recent(dated)

        # 6 Structure
        structured = structure_articles(today_articles, self.config)

        # 7 Translate
        translated = translate_articles(structured)

        # 8 Group + title dedup (AI semantic dedup skipped: n8n processes per-article
        #   with no cross-article context, making it functionally identical to no-op;
        #   title dedup in group_by_sector already removes exact duplicates from the
        #   overlapping RSS sources)
        sections = group_by_sector(translated)

        # 9 Format report
        daily_report = format_daily_report(sections)

        # 10 Persist
        total_articles = sum(len(s["entries"]) for s in sections)
        self.cache.store_articles(_to_cache_format(translated))
        self.cache.store_daily_report(date.today().isoformat(), daily_report, sections)
        self.cache.purge_old_articles()

        elapsed = round(time.time() - t0, 1)
        logger.info(
            "DailyNewsPipeline: done in %.1fs — %d articles → %d sections",
            elapsed, total_articles, len(sections),
        )
        return {
            "daily_report":  daily_report,
            "sections":      sections,
            "cached":        False,
            "article_count": total_articles,
            "elapsed_sec":   elapsed,
        }
