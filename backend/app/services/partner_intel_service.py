"""
Unified Partner Intelligence service.

Phase 1  Discovery   find_partners()   (delegates to partner_search_service)
Phase 2  Deep Dive   deep_evaluate()   (Qichacha + web + news + LLM)

Score unification
-----------------
Both phases use the same deterministic formula:

  partnerScore = Σ ( dimension.score × dimension.weight × 20 )

where dimension.score ∈ [1, 5] and Σ weights = 1.0  →  score ∈ [0, 100].

Phase 2 can refine individual dimension scores with additional evidence
(registry data, news, web research), but the formula is always computed
in Python — never by the LLM — so scores are always mathematically
consistent between Discovery and Deep Dive.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any, Optional

from openai import OpenAI

from .partner_search_service import SECTOR_CONFIGS, find_partners, compute_weighted_score  # noqa: F401 (re-exported)
from .investment_service import fetch_qichacha_data, fetch_daily_news_for_company

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Shared helpers (duplicated locally to avoid coupling to private internals)
# ---------------------------------------------------------------------------

def _cfg(config: Any, key: str, default: str = "") -> str:
    if hasattr(config, "get"):
        val = config.get(key)
    else:
        val = getattr(config, key, None)
    if val is None:
        return default
    return str(val) if not isinstance(val, str) else val


def _make_client(config: Any) -> OpenAI:
    return OpenAI(
        api_key=_cfg(config, "LLM_API_KEY"),
        base_url=_cfg(config, "LLM_BASE_URL",
                      "https://dashscope.aliyuncs.com/compatible-mode/v1"),
        timeout=300.0,
    )


def _chat(client: OpenAI, model: str, system: str, user: str,
          json_mode: bool = False, search: bool = False) -> str:
    kwargs: dict = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user",   "content": user},
        ],
        "temperature": 0.1,
        "max_tokens": 8000,
    }
    if json_mode:
        kwargs["response_format"] = {"type": "json_object"}
    if search:
        kwargs["extra_body"] = {"enable_search": True}
    resp = client.chat.completions.create(**kwargs)
    return resp.choices[0].message.content or ""


# compute_weighted_score is imported from partner_search_service (single source of truth)

# ---------------------------------------------------------------------------
# Deep evaluation — prompts
# ---------------------------------------------------------------------------

_DEEP_EVAL_SYSTEM = """\
You are a senior business development analyst conducting comprehensive partner \
due-diligence for a Saudi distribution group evaluating Chinese companies.
You have live web-search capability — USE IT to verify and enrich the preset data.

MANDATORY RULES:
1. ALL output must be in English only.
2. Re-evaluate each sector dimension using ALL available evidence: \
   Phase 1 pre-scores, Qichacha registry data, live web search, and news cache.
3. Dimension score (1–5 integer):
     5 = Excellent — confirmed by ≥2 authoritative sources
     4 = Good      — confirmed by 1 authoritative source
     3 = Moderate  — partially verified / indirect evidence only
     2 = Poor      — minimal credible evidence found
     1 = Very poor — absent, negative, or contradicted by authoritative source
4. If Qichacha data confirms a fact → mark "verified": true for that dimension.
5. If new evidence materially changes a pre-score → set "changed": true and \
   explain in "changeReason" citing the specific source.
6. Every factual claim MUST cite an authoritative source \
   (official website, annual report, government database, SASO/SABER, IDC/GfK, etc.).
7. Flag unverifiable claims as "Unverified — requires due diligence".
8. Return ONLY valid JSON — no markdown fences, no explanation."""


def _build_deep_eval_prompt(
    company_name_cn: str,
    company_name_en: str,
    sector_key: str,
    preset_dimensions: dict,
    qichacha_data: dict,
    web_research: str,
    news_data: Optional[dict],
) -> str:
    cfg = SECTOR_CONFIGS[sector_key]
    company_display = (
        f"{company_name_en} ({company_name_cn})" if company_name_en else company_name_cn
    )

    # Build dimension schema block with pre-scores
    dim_lines = []
    for d in cfg["dimensions"]:
        preset = preset_dimensions.get(d["key"]) or {}
        pre_score   = preset.get("score", "N/A")
        pre_evidence = str(preset.get("evidence", "no prior evidence"))[:200]
        pre_source   = str(preset.get("source", ""))
        dim_lines.append(
            f'  "{d["key"]}": {{\n'
            f'    "label": "{d["label"]}",\n'
            f'    "weight": {d["weight"]},\n'
            f'    "authoritative_sources": "{d["sources"]}",\n'
            f'    "assessment_guidance": "{d["guidance"]}",\n'
            f'    "pre_score": {pre_score},\n'
            f'    "pre_evidence": "{pre_evidence}",\n'
            f'    "pre_source": "{pre_source}"\n'
            f"  }}"
        )
    dim_schema = "{\n" + ",\n".join(dim_lines) + "\n}"

    # Registry section
    registry_section = ""
    if qichacha_data.get("basic_info"):
        registry_section = (
            "## Qichacha Registry Data (official Chinese business registry — cite as 'Qichacha')\n"
            + json.dumps(qichacha_data["basic_info"], ensure_ascii=False, indent=2)[:3000]
        )
        if qichacha_data.get("financing"):
            registry_section += (
                "\n\n## Financing History (Qichacha)\n"
                + json.dumps(qichacha_data["financing"], ensure_ascii=False, indent=2)[:1500]
            )
        if qichacha_data.get("shareholders"):
            registry_section += (
                "\n\n## Shareholders (Qichacha)\n"
                + json.dumps(qichacha_data["shareholders"], ensure_ascii=False, indent=2)[:1500]
            )
    else:
        registry_section = "## Qichacha Registry Data\n(Not available — web search is the primary source)"

    # News section
    news_section = ""
    if news_data:
        articles = news_data.get("company_articles", [])
        if articles:
            news_section = "## Daily Tech News Cache (company-specific articles)\n"
            for a in articles[:6]:
                news_section += (
                    f"- [{a.get('date', '')}] {a.get('title', '')}"
                    f"  (Sentiment: {a.get('sentiment', '')}, Source: {a.get('source', '')})\n"
                    f"  {str(a.get('content', ''))[:300]}\n"
                )

    dim_keys = [d["key"] for d in cfg["dimensions"]]

    output_schema = """{
  "companyName": "English Name Chinese Name — e.g. 'Hisense Group 海信集团'",
  "sectorKey": \"""" + sector_key + """\",
  "dimensions": {
    "<each key from the schema above>": {
      "score": 1,
      "evidence": "Key finding with specific figures / dates / source citation",
      "source": "Source name or URL",
      "verified": false,
      "preScore": 3,
      "changed": false,
      "changeReason": "Leave empty string if score unchanged"
    }
  },
  "partnerVerdict": "HIGHLY_RECOMMENDED | RECOMMENDED | NEUTRAL | CAUTIOUS | NOT_RECOMMENDED",
  "summary": "3–5 sentence executive summary focused on partnership potential",
  "companyProfile": {
    "foundingYear": "", "headquarters": "", "legalRepresentative": "",
    "registeredCapital": "", "operatingStatus": "", "businessScope": "", "companySize": ""
  },
  "developmentHistory": [
    { "milestone": "", "date": "", "detail": "", "source": "" }
  ],
  "coreTeam": [
    { "name": "", "title": "", "background": "" }
  ],
  "businessAnalysis": {
    "productDescription": "",
    "revenueModel": "",
    "partnershipSynergies": [""],
    "partnershipRisks": [""]
  },
  "marketAnalysis": {
    "targetMarket": "", "marketSize": "", "competitors": [""], "marketPosition": ""
  },
  "partnershipHistory": [
    { "partner": "", "type": "", "date": "", "outcome": "", "source": "" }
  ],
  "recentNews": [
    { "title": "", "date": "", "source": "", "sourceUrl": "",
      "sentiment": "POSITIVE | NEUTRAL | NEGATIVE", "summary": "" }
  ],
  "riskFactors": [
    { "category": "", "level": "LOW | MEDIUM | HIGH | CRITICAL", "description": "" }
  ],
  "partnershipRecommendation": {
    "verdict": "",
    "rationale": "",
    "idealPartnershipType": "",
    "collaborationOpportunities": [""],
    "dueDiligenceQuestions": [""],
    "nextSteps": [""]
  },
  "sources": [
    { "name": "", "url": "", "type": "Official Registry | News Media | Company Website | Industry Report | Government | Other",
      "reliability": "HIGH | MEDIUM | LOW", "note": "" }
  ]
}"""

    return f"""## Deep Partner Evaluation Task

**Company:** {company_display}
**Sector:** {cfg['label']}
**Client Need:** {cfg['client_need']}

---
## Evaluation Dimension Schema (with Phase 1 Discovery pre-scores to verify / refine):
{dim_schema}

---
{registry_section}

---
## Live Web Research Summary (use web search to verify and expand this)
{web_research[:5000]}

---
{news_section}

---
## Required Output JSON Schema:
{output_schema}

CRITICAL CONSTRAINTS:
- "dimensions" object MUST include ALL keys: {dim_keys}
- Do NOT output "partnerScore" — it is computed automatically from dimensions.
- Minimum 3 entries in "sources".
- Every "developmentHistory" and "partnershipHistory" item MUST have a non-empty "source".
- All string values must be in English."""


# ---------------------------------------------------------------------------
# Public entry point — Phase 2
# ---------------------------------------------------------------------------

def deep_evaluate(
    sector_key: str,
    company_name_cn: str,
    company_name_en: str,
    preset_dimensions: dict,
    preset_weighted_score: int,
    config: Any,
) -> dict:
    """
    Comprehensive due-diligence evaluation for a single company already
    identified in Phase 1 Partner Discovery.

    Parameters
    ----------
    sector_key            : Must be in SECTOR_CONFIGS
    company_name_cn       : Chinese company name
    company_name_en       : English company name (may be empty)
    preset_dimensions     : Dimension scores dict from Phase 1 discovery
    preset_weighted_score : Weighted score from Phase 1 (used as fallback)
    config                : Flask app.config (or equivalent)

    Returns
    -------
    Deep evaluation report dict.
    partnerScore is computed from refined dimensions via compute_weighted_score(),
    not by the LLM, ensuring consistency with the Phase 1 score.
    """
    if sector_key not in SECTOR_CONFIGS:
        raise ValueError(
            f"Unknown sector '{sector_key}'. Valid: {list(SECTOR_CONFIGS.keys())}"
        )
    if not _cfg(config, "LLM_API_KEY"):
        raise ValueError("LLM_API_KEY is not configured")

    company_display = company_name_en or company_name_cn
    logger.info("PartnerIntel deep_evaluate: %s (%s)", company_display, sector_key)

    client = _make_client(config)
    model  = _cfg(config, "LLM_CHAT_MODEL", "qwen-plus")

    # ── Step 1: Qichacha registry lookup ─────────────────────────────────────
    lookup_name = company_name_cn or company_name_en
    qichacha_data = fetch_qichacha_data(lookup_name, config)
    qcc_has_data = bool(qichacha_data.get("basic_info"))
    logger.info("PartnerIntel: Qichacha fetched=%s for %s", qcc_has_data, lookup_name)

    # ── Step 2: Web search research ───────────────────────────────────────────
    logger.info("PartnerIntel: web search for %s", company_display)
    sector_label = SECTOR_CONFIGS[sector_key]["label"]
    try:
        web_research = _chat(
            client, model,
            (
                f"You are a business intelligence analyst researching '{company_display}' "
                f"as a potential partner in the '{sector_label}' sector for a Saudi client.\n"
                "Use live web search to find: official website, certifications (SASO/SABER if applicable), "
                "market position and share, recent news (2024–2025), key executives, "
                "partnerships, financial health, and any controversies.\n"
                "Cite every data point with source name and URL. Write in English only."
            ),
            (
                f"Please research {company_display} thoroughly for a Saudi business development "
                f"assessment in the {sector_label} sector. "
                "Focus on certifications, market position, international presence, "
                "and any red flags."
            ),
            search=True,
        )
    except Exception as exc:
        logger.warning("PartnerIntel: web search failed: %s", exc)
        web_research = f"Web search unavailable. Company: {company_display}"

    # ── Step 3: Daily news cache ──────────────────────────────────────────────
    news_data = fetch_daily_news_for_company(company_display, config)
    logger.info(
        "PartnerIntel: news fetched=%s (%d articles)",
        news_data is not None,
        len((news_data or {}).get("company_articles", [])),
    )

    # ── Step 4: LLM deep evaluation (JSON mode) ───────────────────────────────
    prompt = _build_deep_eval_prompt(
        company_name_cn, company_name_en, sector_key,
        preset_dimensions, qichacha_data, web_research, news_data,
    )
    logger.info("PartnerIntel: generating deep evaluation report…")
    try:
        raw_json = _chat(client, model, _DEEP_EVAL_SYSTEM, prompt, json_mode=True)
    except Exception as exc:
        logger.exception("PartnerIntel: LLM call failed")
        raise RuntimeError(f"Deep evaluation LLM call failed: {exc}") from exc

    # ── Parse ─────────────────────────────────────────────────────────────────
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw_json.strip(), flags=re.MULTILINE)
    try:
        report = json.loads(cleaned)
    except json.JSONDecodeError:
        logger.warning("PartnerIntel: JSON parse failed — using preset skeleton")
        report = {}

    # Ensure required fields
    fallback_name = f"{company_name_en} {company_name_cn}".strip()
    report.setdefault("companyName",              fallback_name)
    report.setdefault("sectorKey",                sector_key)
    report.setdefault("sector",                   SECTOR_CONFIGS[sector_key]["label"])
    report.setdefault("dimensions",               preset_dimensions)
    report.setdefault("partnerVerdict",           "NEUTRAL")
    report.setdefault("summary",                  "")
    report.setdefault("companyProfile",           {})
    report.setdefault("developmentHistory",       [])
    report.setdefault("coreTeam",                 [])
    report.setdefault("businessAnalysis",         {})
    report.setdefault("marketAnalysis",           {})
    report.setdefault("partnershipHistory",       [])
    report.setdefault("recentNews",               [])
    report.setdefault("riskFactors",              [])
    report.setdefault("partnershipRecommendation",{})
    report.setdefault("sources",                  [])

    # ── Deterministic score computation ───────────────────────────────────────
    refined_dims = report.get("dimensions") or {}
    computed_score = compute_weighted_score(refined_dims, sector_key)

    # If dimensions were empty / malformed, fall back to preset score
    if computed_score == 0 and preset_weighted_score:
        computed_score = preset_weighted_score
        report["dimensions"] = preset_dimensions

    report["partnerScore"] = computed_score
    report["presetScore"]  = preset_weighted_score   # Phase 1 score preserved for UI

    report["_meta"] = {
        "sector_key":           sector_key,
        "company_cn":           company_name_cn,
        "company_en":           company_name_en,
        "qiChaChaConfigured":   bool(
            _cfg(config, "QICHACHA_KEY") and _cfg(config, "QICHACHA_SECRET")
        ),
        "qiChaChaDataFetched":  qcc_has_data,
        "newsCacheIncluded":    news_data is not None,
        "newsArticleCount":     len((news_data or {}).get("company_articles", [])),
        "presetScore":          preset_weighted_score,
        "computedScore":        computed_score,
    }

    logger.info(
        "PartnerIntel deep_evaluate done: score=%d (preset=%d, delta=%+d)",
        computed_score, preset_weighted_score, computed_score - preset_weighted_score,
    )
    return report
