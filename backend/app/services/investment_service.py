"""
Investment evaluation service.

Pipeline
────────
1. extract_company_name()    user query ──► canonical Chinese company name (LLM)
2. fetch_qichacha_data()     company name ──► registration / funding JSON  (Qichacha API, optional)
3. web_search_context()      company name ──► recent news + market summary  (Qwen + search)
4. generate_report()         all data ──► structured JSON report  (LLM)

Qichacha integration degrades gracefully: if QICHACHA_KEY / SECRET are not
configured the step is skipped and the LLM synthesises from web search alone.
"""
from __future__ import annotations

import hashlib
import json
import logging
import re
import time
from typing import Any, Optional

import requests
from openai import OpenAI

from .qichacha_service import get_basic_details_by_name, qichacha_get

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Qichacha (企查查) API helpers
# Docs: https://api.qichacha.com
# Auth: Header Token=MD5(Key+Timespan+SecretKey).upper(), Header Timespan=unix_seconds
# ---------------------------------------------------------------------------
_QCC_BASE = "https://api.qichacha.com"


def _qcc_sign(key: str, timespan: int, secret: str) -> str:
    raw = f"{key}{timespan}{secret}"
    return hashlib.md5(raw.encode("utf-8")).hexdigest().upper()


_QCC_NO_PERM = {"115", "214", "103"}   # not purchased / expired / invalid key

def _qcc_get(path: str, params: dict, key: str, secret: str,
             timeout: int = 10, proxies: Optional[dict] = None) -> Optional[dict]:
    """
    Call a Qichacha endpoint; return parsed JSON or None on any error.

    Auth format (new API):
      Header Token   = MD5(Key + Timespan + SecretKey).upper()
      Header Timespan = str(int(time.time()))
      Query  key     = AppKey

    Note: Qichacha restricts access to mainland China IPs (Status=121 if overseas).
    Set QCC_PROXY env var (e.g. http://proxy.example.cn:8080) to route via a
    domestic proxy when the backend runs outside mainland China.
    """
    import os
    timespan = int(time.time())
    # Token = MD5 hash (as per official docs), NOT the raw key
    token = _qcc_sign(key, timespan, secret)
    headers = {
        "Token": token,
        "Timespan": str(timespan),
    }
    _proxies = proxies
    if _proxies is None:
        proxy_url = os.getenv("QCC_PROXY", "")
        if proxy_url:
            _proxies = {"http": proxy_url, "https": proxy_url}
    try:
        resp = requests.get(
            f"{_QCC_BASE}{path}", params=params, headers=headers,
            timeout=timeout, proxies=_proxies,
        )
        resp.raise_for_status()
        data = resp.json()
        status = str(data.get("Status", ""))
        if status == "121":
            logger.warning(
                "Qichacha IP restriction (Status=121): API only accessible from mainland China IPs. "
                "Deploy the backend to a domestic server, or set QCC_PROXY=<proxy-url> in .env."
            )
            return None
        if status in _QCC_NO_PERM:
            logger.warning(
                "Qichacha no-permission %s (Status=%s): log in at https://openapi.qcc.com to verify the API is purchased.",
                path, status,
            )
            return None
        return data
    except Exception as exc:
        logger.warning("Qichacha request failed (%s): %s", path, exc)
        return None


def fetch_qichacha_data(company_name: str, config: Any) -> dict:
    """
    Returns a dict with keys: basic_info, shareholders, financing.
    Falls back to empty structures if the API is not configured or calls fail.

    Endpoints (per official docs at https://api.qichacha.com):
      Basic info:   GET /EnterpriseInfo/Verify   params: key, searchKey
      Shareholders: GET /ECISHRHIS/GetList        params: key, searchKey, pageIndex, pageSize
      Financing:    GET /ECIFinancing/GetList      params: key, searchKey, pageIndex, pageSize
    """
    key = _cfg(config, "QICHACHA_KEY")
    secret = _cfg(config, "QICHACHA_SECRET")
    result: dict = {"basic_info": {}, "shareholders": [], "financing": []}

    if not (key and secret):
        logger.info("Qichacha not configured — skipping registry lookup")
        return result

    # Proxy from QCC_PROXY env var (required when running outside mainland China)
    import os
    proxy_url = os.getenv("QCC_PROXY", "")
    proxies = {"http": proxy_url, "https": proxy_url} if proxy_url else None

    # 1. Basic company info — endpoint shown in the Qichacha console screenshot.
    #    GET /ECIV4/GetBasicDetailsByName?key=<AppKey>&keyword=<company>
    try:
        basic = get_basic_details_by_name(company_name, config)
        if basic.get("ok"):
            result["basic_info"] = basic.get("data") or {}
            logger.info("Qichacha basic_info fetched for: %s", company_name)
        else:
            logger.warning(
                "Qichacha basic_info not fetched for %s: Status=%s Message=%s",
                company_name, basic.get("status"), basic.get("message"),
            )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Qichacha basic details request failed: %s", exc)

    # 2. Shareholder list — keep as optional enrichment. Different Qichacha
    # accounts may need this product purchased separately.
    try:
        sh = qichacha_get(
            "/ECISHRHIS/GetList",
            {"searchKey": company_name, "pageIndex": 1, "pageSize": 20},
            config, proxies=proxies,
        )
        if sh.get("ok"):
            result["shareholders"] = (sh.get("data") or {}).get("Result", [])
    except Exception as exc:  # noqa: BLE001
        logger.info("Qichacha shareholder enrichment skipped: %s", exc)

    # 3. Financing history — keep as optional enrichment.
    try:
        fin = qichacha_get(
            "/ECIFinancing/GetList",
            {"searchKey": company_name, "pageIndex": 1, "pageSize": 20},
            config, proxies=proxies,
        )
        if fin.get("ok"):
            result["financing"] = (fin.get("data") or {}).get("Result", [])
    except Exception as exc:  # noqa: BLE001
        logger.info("Qichacha financing enrichment skipped: %s", exc)

    return result


# ---------------------------------------------------------------------------
# System prompts
# ---------------------------------------------------------------------------

_EXTRACT_PROMPT = """\
You are a Chinese business information assistant.
Extract the canonical Chinese company name from the user's query.
Return ONLY the company name as a JSON object: {"company_name": "..."}.
If no specific company is mentioned, return {"company_name": ""}.
Do not add any explanation."""

_SEARCH_PROMPT = """\
You are a business development analyst helping a company identify and evaluate \
potential Chinese business partners.

Using your web search capability, research the company "{company}" thoroughly \
and gather the following information:

1. Company overview — founding year, headquarters, business model, core products \
   or services, company scale (employees, revenue if available).
2. Core team — key founders and executives, their backgrounds, industry experience, \
   and professional networks.
3. Development milestones — major funding rounds, key contracts won, expansions, \
   product launches, notable achievements (with dates).
4. Partnership track record — known collaborations, joint ventures, strategic \
   alliances, and their outcomes.
5. Recent news — any notable developments from the past 12 months (new products, \
   partnerships, awards, controversies, regulatory issues).
6. Market standing — industry position, competitive advantages, customer base, \
   differentiators vs competitors.
7. Partnership risks — financial stability concerns, regulatory exposure, \
   reputational issues, or operational red flags.

IMPORTANT: For every factual claim, explicitly state the source (publication name, \
official filing, company website, government database, etc.) and the date of the \
information. Reliability of information is critical to the user.

Write a comprehensive, source-attributed research report in English."""

_REPORT_SYSTEM_PROMPT = """\
You are a senior business development analyst writing a structured partner \
evaluation report for a company seeking potential Chinese business partners.

Based on the research context provided, produce a JSON report. \
Return ONLY valid JSON — no markdown fences, no explanation.

Required schema:
{
  "companyName": "English name first, then Chinese name — e.g. 'Haier Group 海尔集团公司'",
  "partnerScore": 0-100,
  "partnerVerdict": "HIGHLY_RECOMMENDED | RECOMMENDED | NEUTRAL | CAUTIOUS | NOT_RECOMMENDED",
  "summary": "3-5 sentence executive summary focused on partnership potential",
  "companyProfile": {
    "foundingYear": "string",
    "headquarters": "string",
    "legalRepresentative": "string",
    "registeredCapital": "string",
    "operatingStatus": "string",
    "businessScope": "string",
    "companySize": "string"
  },
  "developmentHistory": [
    {
      "milestone": "string",
      "date": "string",
      "detail": "string",
      "source": "string"
    }
  ],
  "coreTeam": [
    { "name": "string", "title": "string", "background": "string" }
  ],
  "businessAnalysis": {
    "productDescription": "string",
    "revenueModel": "string",
    "partnershipSynergies": ["string"],
    "partnershipRisks": ["string"]
  },
  "marketAnalysis": {
    "targetMarket": "string",
    "marketSize": "string",
    "competitors": ["string"],
    "marketPosition": "string"
  },
  "partnershipHistory": [
    {
      "partner": "string",
      "type": "string",
      "date": "string",
      "outcome": "string",
      "source": "string"
    }
  ],
  "recentNews": [
    {
      "title": "string",
      "date": "string",
      "source": "string",
      "sourceUrl": "string",
      "sentiment": "POSITIVE | NEUTRAL | NEGATIVE",
      "summary": "string"
    }
  ],
  "riskFactors": [
    { "category": "string", "level": "LOW | MEDIUM | HIGH | CRITICAL", "description": "string" }
  ],
  "partnershipRecommendation": {
    "verdict": "string",
    "rationale": "string",
    "idealPartnershipType": "string",
    "collaborationOpportunities": ["string"],
    "dueDiligenceQuestions": ["string"],
    "nextSteps": ["string"]
  },
  "sources": [
    {
      "name": "string",
      "url": "string",
      "type": "Official Registry | News Media | Company Website | Industry Report | Government | Other",
      "reliability": "HIGH | MEDIUM | LOW",
      "note": "string"
    }
  ]
}

Rules:
- partnerScore: 0 = strongly avoid as partner, 100 = ideal partnership candidate.
- partnerVerdict: HIGHLY_RECOMMENDED = excellent fit, RECOMMENDED = good fit, \
  NEUTRAL = acceptable with caution, CAUTIOUS = significant concerns, \
  NOT_RECOMMENDED = avoid.
- Every developmentHistory and partnershipHistory item MUST include a source field.
- Every recentNews item MUST include source and sourceUrl (use empty string if URL unknown).
- Every factual claim in businessAnalysis and marketAnalysis (revenue figures, market size, \
  competitor names, market position claims) MUST be traceable to at least one entry in the \
  sources array — reference the source name explicitly in the field value where possible.
- Every riskFactor MUST include a description that mentions the source of evidence or explicitly \
  states "Unverified — requires due diligence" if no authoritative source confirms the risk.
- sources array must list ALL sources referenced — minimum 3 entries.
- Reliability: HIGH = official registry / government / major verified media, \
  MEDIUM = reputable industry press, LOW = unverified / single source.
- Be objective; explicitly note data gaps.
- All string values must be in English."""


# ---------------------------------------------------------------------------
# Core pipeline functions
# ---------------------------------------------------------------------------

def _cfg(config: Any, key: str, default: str = "") -> str:
    """Get a string config value from either a Flask dict-config or a dataclass.

    Avoids the `value or default` anti-pattern, which incorrectly overrides
    falsy values like False, 0, or empty string with the default.
    """
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


def _make_client(config: Any) -> OpenAI:
    return OpenAI(
        api_key=_cfg(config, "LLM_API_KEY"),
        base_url=_cfg(config, "LLM_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1"),
        timeout=240.0,  # web-search + report generation can each take ~90s
    )


def fetch_daily_news_for_company(
    company_name: str, config: Any
) -> Optional[dict[str, Any]]:
    """
    Return relevant daily news for a company.

    Priority order:
      1. Native SQLite cache (NewsCache) — company-specific keyword search
      2. Fallback: n8n webhook (legacy, only if N8N_NEWS_ENABLED=1)

    The returned dict always has:
      {
        "company_articles": [{"title", "content", "date", "sentiment", "source"}, ...],
        "daily_report": str,   # today's full formatted report (may be empty)
        "source": "cache" | "n8n" | None,
      }
    """
    from .news_cache import NewsCache
    from .daily_news_service import DailyNewsPipeline

    # ── 1. Try native cache ──────────────────────────────────────────────────
    if _cfg_bool(config, "NEWS_PIPELINE_ENABLED", default=True):
        db_path = _cfg(config, "NEWS_CACHE_DB_PATH")
        ttl = int(_cfg(config, "NEWS_CACHE_TTL_DAYS", "7"))
        cache = NewsCache(db_path=db_path or None, ttl_days=ttl)

        company_articles = cache.search_by_company(company_name, days=7) if company_name else []
        today_report = cache.get_today_report()

        # If cache is empty for today, run the pipeline (non-blocking best-effort)
        if not cache.get_today_articles():
            try:
                logger.info("Cache empty — running DailyNewsPipeline for fresh data")
                pipeline = DailyNewsPipeline(config)
                pipeline.run()
                company_articles = cache.search_by_company(company_name, days=1) if company_name else []
                today_report = cache.get_today_report()
            except Exception as exc:
                logger.warning("DailyNewsPipeline background run failed: %s", exc)

        report_text = today_report.get("content", "") if today_report else ""

        # Build a clean list for LLM context
        clean_articles = [
            {
                "title":     a.get("title", ""),
                "content":   (a.get("content") or "")[:600],
                "date":      a.get("date_iso", ""),
                "sentiment": a.get("sentiment", ""),
                "source":    a.get("media", ""),
                "category":  a.get("category", ""),
            }
            for a in company_articles
        ]

        if clean_articles or report_text:
            return {
                "company_articles": clean_articles,
                "daily_report":     report_text,
                "source":           "cache",
            }

    # ── 2. Fallback: legacy n8n webhook ─────────────────────────────────────
    if not _cfg_bool(config, "N8N_NEWS_ENABLED", default=False):
        return None

    webhook_url = _cfg(config, "N8N_NEWS_WEBHOOK_URL")
    if not webhook_url:
        return None

    headers = {"Accept": "application/json"}
    token = _cfg(config, "N8N_NEWS_AUTH_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"

    timeout_sec = int(_cfg(config, "N8N_NEWS_TIMEOUT_SEC", "15"))
    try:
        resp = requests.get(
            webhook_url,
            headers=headers,
            params={"company": company_name},
            timeout=timeout_sec,
        )
        resp.raise_for_status()
        payload = resp.json()
        if isinstance(payload, dict):
            payload["source"] = "n8n"
            return payload
        return {"items": payload, "source": "n8n"}
    except Exception as exc:
        logger.warning("n8n daily-news webhook failed: %s", exc)
        return None


# Keep old name as alias so existing callers don't break
fetch_n8n_daily_news = fetch_daily_news_for_company


def _chat(client: OpenAI, model: str, system: str, user: str,
          json_mode: bool = False, search: bool = False) -> str:
    kwargs: dict = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "temperature": 0.2,
    }
    if json_mode:
        kwargs["response_format"] = {"type": "json_object"}
    if search:
        kwargs["extra_body"] = {"enable_search": True}
    resp = client.chat.completions.create(**kwargs)
    return resp.choices[0].message.content or ""


def extract_company_name(query: str, config: Any) -> str:
    """Use LLM to extract a canonical Chinese company name from the user query."""
    client = _make_client(config)
    model = _cfg(config, "LLM_CHAT_MODEL", "qwen-plus")
    raw = _chat(client, model, _EXTRACT_PROMPT, query, json_mode=True)
    try:
        return json.loads(raw).get("company_name", "").strip()
    except Exception:
        # Fallback: treat the whole query as the company name
        return query.strip()


def web_search_context(company_name: str, config: Any) -> str:
    """
    Ask Qwen (with web search enabled) to research the company.
    Returns a free-text research summary.
    """
    client = _make_client(config)
    model = _cfg(config, "LLM_CHAT_MODEL", "qwen-plus")
    system = _SEARCH_PROMPT.format(company=company_name)
    user = (
        f"Please research the Chinese company '{company_name}'. "
        "Provide as much factual detail as you can find, especially on "
        "funding rounds, key personnel, products, and recent news."
    )
    try:
        return _chat(client, model, system, user, search=True)
    except Exception as exc:
        logger.warning("Web search step failed: %s", exc)
        return f"Web search unavailable. Company: {company_name}"


def _parse_report(raw: str) -> dict:
    """Strip markdown fences and parse JSON; fill defaults on parse failure."""
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip(), flags=re.MULTILINE)
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError:
        logger.warning("Report JSON parse failed; returning skeleton")
        data = {}

    defaults = {
        "companyName": "",
        "partnerScore": 50,
        "partnerVerdict": "NEUTRAL",
        "summary": "",
        "companyProfile": {},
        "developmentHistory": [],
        "coreTeam": [],
        "businessAnalysis": {},
        "marketAnalysis": {},
        "partnershipHistory": [],
        "recentNews": [],
        "riskFactors": [],
        "partnershipRecommendation": {},
        "sources": [],
    }
    for k, v in defaults.items():
        data.setdefault(k, v)

    score = data.get("partnerScore", 50)
    try:
        data["partnerScore"] = max(0, min(100, int(score)))
    except (TypeError, ValueError):
        data["partnerScore"] = 50

    return data


def generate_report(
    company_name: str,
    qichacha_data: dict,
    search_context: str,
    config: Any,
    extra_json: Optional[Any] = None,
) -> dict:
    """Synthesise all gathered data into a structured JSON investment report."""
    client = _make_client(config)
    model = _cfg(config, "LLM_CHAT_MODEL", "qwen-plus")

    # Build a rich context block
    context_parts = [f"## Target Company\n{company_name}\n"]

    if qichacha_data.get("basic_info"):
        context_parts.append(
            "## Qichacha Registry Data (official company registration source)\n"
            + json.dumps(qichacha_data["basic_info"], ensure_ascii=False, indent=2)
        )
    if qichacha_data.get("financing"):
        context_parts.append(
            "## Financing History (source: Qichacha — official business registry)\n"
            + json.dumps(qichacha_data["financing"], ensure_ascii=False, indent=2)
        )
    if qichacha_data.get("shareholders"):
        context_parts.append(
            "## Shareholders (source: Qichacha — official business registry)\n"
            + json.dumps(qichacha_data["shareholders"], ensure_ascii=False, indent=2)
        )

    # User-supplied supplementary JSON (e.g. news feed, industry report)
    if extra_json is not None:
        try:
            extra_str = json.dumps(extra_json, ensure_ascii=False, indent=2)
        except Exception:
            extra_str = str(extra_json)
        context_parts.append(
            "## Supplementary Data (user-uploaded JSON)\n" + extra_str
        )

    context_parts.append(f"## Web Research Summary\n{search_context}")
    context = "\n\n".join(context_parts)

    user_msg = (
        f"Generate a comprehensive investment evaluation report for '{company_name}'.\n\n"
        f"CONTEXT:\n{context[:12000]}"  # guard token limit
    )

    raw = _chat(
        client, model,
        _REPORT_SYSTEM_PROMPT, user_msg,
        json_mode=True, search=False,
    )
    report = _parse_report(raw)
    if not report.get("companyName"):
        report["companyName"] = company_name
    return report


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def evaluate_company(query: str, config: Any, extra_json: Optional[Any] = None) -> dict:
    """
    Full pipeline: query ──► investment report dict.

    extra_json: optional user-supplied data (news feed, industry report, etc.)
                injected into the LLM context as a supplementary section.

    Raises on fatal errors (missing API key etc.).
    """
    if not _cfg(config, "LLM_API_KEY"):
        raise ValueError("LLM_API_KEY is not configured")

    # Step 1 — extract company name
    company_name = extract_company_name(query, config)
    if not company_name:
        company_name = query.strip()

    logger.info("Investment evaluation for: %s", company_name)

    # Step 2 — Qichacha registry (degrades gracefully if unconfigured or API fails)
    qichacha_data = fetch_qichacha_data(company_name, config)
    qcc_has_data = bool(qichacha_data.get("basic_info"))

    # Step 3 — web search (always runs; primary data source when Qichacha unavailable)
    search_ctx = web_search_context(company_name, config)

    # Step 3.5 — fetch cached / pipeline news for this company
    company_news = fetch_daily_news_for_company(company_name, config)

    # Step 4 — synthesise report
    merged_extra: Optional[Any] = None
    news_block: Optional[dict] = None
    if company_news:
        news_block = {
            "companySpecificArticles": company_news.get("company_articles", []),
            "todayDailyReport":        company_news.get("daily_report", ""),
            "newsSource":              company_news.get("source", ""),
        }

    if extra_json is not None and news_block is not None:
        merged_extra = {
            "userSupplementaryData": extra_json,
            "newsContext":           news_block,
        }
    elif extra_json is not None:
        merged_extra = extra_json
    elif news_block is not None:
        merged_extra = {"newsContext": news_block}

    report = generate_report(
        company_name, qichacha_data, search_ctx, config, extra_json=merged_extra
    )
    report["_meta"] = {
        "query": query,
        "extractedCompany": company_name,
        "qiChaChaConfigured": bool(_cfg(config, "QICHACHA_KEY") and _cfg(config, "QICHACHA_SECRET")),
        "qiChaChaDataFetched": qcc_has_data,
        "extraJsonIncluded": extra_json is not None,
        "newsCacheIncluded": company_news is not None,
        "newsSource": (company_news or {}).get("source"),
    }
    return report
