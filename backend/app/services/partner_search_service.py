"""
Partner search service — discovers and evaluates Chinese companies as potential
business partners based on a structured client brief.

Two sectors are supported:
  consumer_electronics_brand  — Chinese CE / appliance brands for Saudi distribution
  social_commerce_agency      — Chinese agencies for Saudi social commerce
                                (TikTok / Snapchat / Instagram)

Pipeline (mirrors investment_service.py pattern)
────────────────────────────────────────────────
1. research_candidates()   brief ──► free-text research report  (Qwen + DashScope search)
2. structure_report()      research text ──► structured JSON     (Qwen, JSON mode)

All information is gathered via Qwen's built-in web-search capability
(extra_body={"enable_search": True}), which queries real-time sources so
every data point has an authoritative origin.
"""
from __future__ import annotations

import json
import logging
import re
from datetime import date
from typing import Any

from openai import OpenAI

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Sector configuration
# ---------------------------------------------------------------------------

SECTOR_CONFIGS: dict[str, dict] = {
    "consumer_electronics_brand": {
        "label": "Consumer Electronics & Appliance Brand Partnership",
        "target_type": "Chinese consumer electronics and home appliance manufacturing brands",
        "client_need": (
            "A large Saudi consumer electronics and home appliance distribution group seeking to expand its portfolio of Chinese brands and products. "
            "Target market: Saudi Arabia."
        ),
        "search_hints": (
            "Search strategy:\n"
            "1. Search 'Chinese home appliance brands Saudi Arabia Middle East export SASO certification 2024 2025'\n"
            "2. Search 'Chinese consumer electronics brands global market share IDC GfK ranking'\n"
            "3. Reference China Household Electrical Appliances Association (ceaonline.com.cn) members and white papers\n"
            "4. Reference China Customs / MOFCOM export statistics\n"
            "5. Search saso.gov.sa / saber.org.sa for each brand's certification records\n"
            "6. Search Amazon.sa for each brand's products to confirm Saudi market presence\n\n"
            "Key brands to research (not limited to):\n"
            "Hisense, TCL, Haier, Midea, Gree, Skyworth (Skyworth), Changhong, Konka, AUX, "
            "Galanz, Xiaomi, Huawei, OPPO, Honor"
        ),
        "dimensions": [
            {
                "key": "products",
                "label": "Products & Categories",
                "weight": 0.10,
                "sources": "Brand official website product pages, business registration scope",
                "guidance": "Assess product line breadth (home appliances / smartphones / smart home etc.) and specific categories of interest to a Saudi distributor",
            },
            {
                "key": "market_position",
                "label": "Market Position (China & Global)",
                "weight": 0.20,
                "sources": "IDC / GfK market share reports, China Appliance Association industry rankings, annual reports of listed companies",
                "guidance": "Brand ranking in the Chinese market, global market share / shipment volume, listed status and market cap",
            },
            {
                "key": "manufacturing",
                "label": "Manufacturing Capability (factory scale, capacity)",
                "weight": 0.15,
                "sources": "MIIT above-scale enterprise data, annual report capacity disclosures, factory certifications (ISO/CE)",
                "guidance": "Number and location of factories, annual production capacity, in-house R&D capability, OEM/ODM capability",
            },
            {
                "key": "certifications",
                "label": "SASO/SABER Certification & Compliance",
                "weight": 0.25,
                "sources": "SASO official site saso.gov.sa, SABER platform saber.org.sa, brand official certification pages",
                "guidance": "Whether SASO certification is held, SABER registration status, CE/FCC/RoHS and other international certifications",
            },
            {
                "key": "export_experience",
                "label": "Export Experience",
                "weight": 0.15,
                "sources": "China Customs export data, annual report overseas revenue ratio, company official export performance",
                "guidance": "Overseas revenue ratio, main export regions (whether including Middle East), years of export, agents or subsidiaries in Middle East",
            },
            {
                "key": "saudi_presence",
                "label": "Saudi Market Presence (existing distributors)",
                "weight": 0.15,
                "sources": "Brand official website 'dealer locator' page, Amazon.sa product search, Google News",
                "guidance": "Whether authorised distributors already exist in Saudi Arabia (which may create channel conflict), product availability and sales on Amazon.sa",
            },
        ],
    },
    "social_commerce_agency": {
        "label": "Social Commerce Agency Partnership",
        "target_type": "Chinese social commerce agencies (MCN / digital marketing agencies)",
        "client_need": (
            "A large Saudi distribution group planning to launch Saudi-local social commerce on TikTok, Snapchat, Instagram and similar platforms, "
            "seeking a Chinese agency to manage operations. Target market: Saudi Arabia."
        ),
        "search_hints": (
            "Search strategy:\n"
            "1. Search 'TikTok official certified service provider China Middle East Saudi Arabia 2024 2025'\n"
            "2. Visit TikTok for Business official partner page (ads.tiktok.com/agency)\n"
            "3. Search 'Chinese MCN agencies overseas social commerce Middle East top ranking'\n"
            "4. Search 'Snapchat official partner China agency Middle East'\n"
            "5. Search LinkedIn for Chinese social commerce agencies with Middle East operations\n"
            "6. Search 'Chinese cross-border e-commerce agency Saudi Arabia KSA TikTok Shop'\n\n"
            "Key agencies to research (not limited to):\n"
            "BlueFocus, Hylink, Gravity Media, Huayang United, "
            "Tmall International operators, JD Global operators, TikTok Shop official certified operators, "
            "Xingsheng Media, Inke, Fesoon, Digital Media Group"
        ),
        "dimensions": [
            {
                "key": "platform_cert",
                "label": "Platform Certification (official certified partner)",
                "weight": 0.30,
                "sources": "TikTok for Business partner page, Meta Business partner directory, Snapchat official partners",
                "guidance": "Whether official certified marketing partner for TikTok/Meta/Snapchat, certification tier (Gold/Silver/Bronze)",
            },
            {
                "key": "mena_experience",
                "label": "Middle East Market Experience (especially Saudi/UAE)",
                "weight": 0.30,
                "sources": "Agency official website Middle East case studies, LinkedIn company page, news coverage",
                "guidance": "Whether actual operational cases exist in Saudi Arabia/UAE/Middle East, Middle East revenue ratio, familiarity with local culture and religious sensitivities (Ramadan marketing etc.)",
            },
            {
                "key": "service_scope",
                "label": "Service Scope",
                "weight": 0.20,
                "sources": "Agency official website service pages, proposal materials",
                "guidance": "Whether the agency covers: content production (Arabic localisation), paid ad placement, influencer/KOL resources (local Middle East KOLs), customer service (Arabic), TikTok Shop store operations, data reporting",
            },
            {
                "key": "industry_position",
                "label": "Industry Standing",
                "weight": 0.10,
                "sources": "Industry ranking lists, industry awards, media coverage, listed status",
                "guidance": "Brand recognition in China's digital marketing industry, scale (headcount/annual revenue), awards, media exposure",
            },
            {
                "key": "business_model",
                "label": "Business Model & Track Record",
                "weight": 0.10,
                "sources": "Official website pricing page, industry reputation, client reviews, renewal rate data",
                "guidance": "Fee structure (flat service fee / performance share / hybrid), contract duration, historical client renewal rate, typical success cases and ROI data",
            },
        ],
    },
}

# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------

_RESEARCH_SYSTEM = """\
You are a top-tier China supply-chain and business intelligence consultant specialising in finding Chinese partners for Middle East / Saudi Arabia clients.
You have live web-search capability which you MUST use to retrieve real, current company information.

MANDATORY RULES:
1. ALL output must be in English only.
2. Every data point (revenue, market share, certifications, headcount, rankings, etc.) MUST cite its authoritative source — include the source name and URL where available.
3. Authoritative sources only: official company websites, annual reports, government databases (SASO saso.gov.sa, SABER saber.org.sa, China Customs, MIIT), industry reports (IDC, GfK, China Household Electrical Appliances Association ceaonline.com.cn), stock exchange filings, TikTok for Business partner page, Meta Business partner directory.
4. If a data point cannot be verified through web search, explicitly label it "Unverified — requires due diligence" — never fabricate figures.
5. Write a detailed, source-attributed research report in English."""


def _build_research_prompt(brief: str, sector_key: str,
                           region: str = "", industry: str = "") -> str:
    cfg = SECTOR_CONFIGS[sector_key]
    dim_lines = "\n".join(
        f"  {i+1}. **{d['label']}**\n"
        f"     Authoritative sources: {d['sources']}\n"
        f"     Assessment guidance: {d['guidance']}"
        for i, d in enumerate(cfg["dimensions"])
    )

    # ── When region or industry is explicitly specified, override the hardcoded
    #    sector defaults so the AI searches for the actual companies the user wants,
    #    not the pre-defined brand list. ──────────────────────────────────────────
    if region or industry:
        industry_label = industry if industry else "supplier"
        region_label   = region   if region   else "China"

        client_need_text = (
            f"A business seeking qualified Chinese **{industry_label}** companies"
            + (f" located in **{region_label}**" if region else "")
            + " as potential business partners / suppliers."
        )
        target_type_text = (
            f"{industry_label} companies"
            + (f" in the {region_label} region of China" if region else " in China")
        )
        search_hints_text = (
            f"Search strategy (STRICTLY follow — do NOT substitute other industries or regions):\n"
            f"1. Search '中国 {region_label} {industry_label} 企业' or '{region_label} {industry_label} manufacturer China'\n"
            f"2. Search B2B platforms (alibaba.com, made-in-china.com, globalsources.com) for "
            f"   '{industry_label}' suppliers"
            + (f" in '{region_label}'" if region else "") + "\n"
            f"3. Search Qichacha / Tianyancha for registered '{industry_label}' companies"
            + (f" in {region_label}" if region else "") + "\n"
            f"4. Search Chinese industry association databases for '{industry_label}'"
            + (f" enterprises in {region_label}" if region else "") + "\n"
            f"5. Search export records / China Customs data for '{industry_label}' products"
            + (f" exported from {region_label}" if region else "") + "\n\n"
            f"**IMPORTANT:** Return ONLY {industry_label} companies"
            + (f" headquartered or with main operations in {region_label}" if region else "")
            + f". Do NOT return companies from other industries (e.g. home appliances, electronics) "
            f"or other regions. The user has explicitly specified industry='{industry_label}'"
            + (f" and region='{region_label}'" if region else "") + "."
        )
    else:
        client_need_text  = cfg["client_need"]
        target_type_text  = cfg["target_type"]
        search_hints_text = cfg["search_hints"]

    return f"""## Client Brief

**Client:** {client_need_text}

**Additional Requirements:**
{brief if brief.strip() else "(none provided)"}

## Task

Use live web search to identify **5–6 Chinese {target_type_text}** that best match the requirements above.
For each candidate, gather the following information in full.

{search_hints_text}

## Required Information Per Company

### A. Basic Information
- Full company name (Chinese + English), founded year, HQ city/province
- Listed status (exchange + stock code, or private), registered capital
- Employee count, latest annual revenue (with year and source)
- Core business description (one sentence)

### B. China Operations Status
- Domestic market position and ranking (with source: IDC/GfK/industry association)
- Key product lines relevant to this engagement
- Manufacturing scale (factories, capacity, OEM/ODM capability)
- Notable recent developments in China (past 12 months)

### C. Middle East / Saudi Arabia Operations Status
- Current presence in Saudi Arabia / UAE / GCC (Yes / Limited / None) — verify via official website, Amazon.sa, news
- Existing distributors or partners in Saudi Arabia (channel conflict risk)
- SASO/SABER certification status (check saso.gov.sa and saber.org.sa)
- Any known Saudi or Middle East contracts, partnerships, or marketing activities

### D. Evaluation Dimensions (each MUST include source citation)

{dim_lines}

### E. Assessment
- Key Strengths (3 bullet points)
- Risks / Unverified Items (2 bullet points — explicitly flag anything not confirmed)
- Recommendation: Recommended / Proceed with Caution / Not Recommended + one-sentence reason

---

## End-of-Report Sections (required)

### Saudi / Middle East Industry Insight
- Current state of the Saudi market relevant to this sector (2–3 paragraphs)
- Key trends, regulatory environment (Vision 2030, SASO, Nitaqat), competitive landscape
- Which Chinese brands / agencies are already active and their positioning

### Recommendation Model
- Explain the methodology used to rank companies
- Identify the top pick with detailed rationale
- Provide tiered recommendations: Primary / Alternative / Backup

### Next Steps
- Short term (0–3 months): immediate actions to progress the partnership
- Mid term (3–12 months): validation, pilot, negotiation milestones
- Long term (1–3 years): market development, exclusivity, scaling

### Source Summary
Categorised by authority level: Official Government/Certification | Industry Reports | Company Official | News Media

### Analyst Notes
Data limitations, search date, recommended next verification steps"""


_STRUCTURE_SYSTEM = """\
You are a senior business analyst converting a research report into structured JSON.
Output ONLY valid JSON — no markdown fences, no explanatory text. ALL string values must be in English."""

# ── Schema A: candidates only (one call per company list) ────────────────────
_CANDIDATES_SCHEMA = """{
  "candidates": [
    {
      "rank": 1,
      "company_name_cn": "Company Chinese full name",
      "company_name_en": "Company English name / brand",
      "basic_info": {
        "founded": "Year",
        "headquarters": "City, Province",
        "listed": "Listed — Exchange (CODE) | Private",
        "employees": "~X,000",
        "annual_revenue": "RMB Xbn (YYYY) [Source]",
        "core_business": "One-sentence description"
      },
      "china_operations": {
        "market_position": "Domestic ranking / share with source",
        "key_products": "Main product lines relevant to this engagement",
        "manufacturing_scale": "Factory count, capacity, OEM/ODM notes",
        "recent_developments": "Notable China developments in past 12 months"
      },
      "middle_east_operations": {
        "presence": "Active | Limited | None",
        "saudi_details": "SASO cert status, Amazon.sa presence, known distributors",
        "regional_details": "UAE / GCC / broader ME presence",
        "partnerships": "Known ME contracts or partnerships (or 'None identified')"
      },
      "dimensions": {
        "<dimension_key>": {
          "score": 3,
          "evidence": "Key data with figures and dates",
          "source": "Source name or URL",
          "verified": true
        }
      },
      "weighted_score": 0,
      "strengths": ["Strength 1", "Strength 2", "Strength 3"],
      "risks": ["Risk 1", "Risk 2"],
      "recommendation": "Recommended | Proceed with Caution | Not Recommended — one-sentence reason"
    }
  ]
}"""

# ── Schema B: meta sections (summary, insight, recommendation, next steps) ───
_META_SCHEMA = """{
  "sector": "Sector name",
  "search_date": "YYYY-MM-DD",
  "client_brief_summary": "One-sentence summary",

  "summary": {
    "overview": "2-3 sentence executive overview naming all recommended companies and key deciding factors",
    "key_considerations": ["Consideration 1", "Consideration 2", "Consideration 3"]
  },

  "comparison_chart": {
    "criteria": ["Founded", "Revenue", "Employees", "Listed", "SASO Certified", "ME Presence", "Saudi Distributors", "Key Strength"],
    "rows": [
      {
        "company": "Company English name",
        "values": {
          "Founded": "YYYY",
          "Revenue": "RMB Xbn (YYYY)",
          "Employees": "~X,000",
          "Listed": "Yes — SHA:CODE | No",
          "SASO Certified": "Yes | Partial | No | Unverified",
          "ME Presence": "Active | Limited | None",
          "Saudi Distributors": "Yes — [name] | None identified | Unverified",
          "Key Strength": "One short phrase"
        }
      }
    ]
  },

  "industry_insight": {
    "market_overview": "2-3 paragraph overview of Saudi / ME market for this sector",
    "key_trends": ["Trend 1", "Trend 2", "Trend 3", "Trend 4"],
    "regulatory_environment": "SASO, Vision 2030, Nitaqat, and relevant policies",
    "competitive_landscape": "Chinese and international players already active in Saudi/ME"
  },

  "recommendation_model": {
    "methodology": "How companies were ranked (criteria, data sources)",
    "top_pick": "Company English name",
    "top_pick_rationale": "2-3 sentence rationale",
    "tiered_recommendations": [
      {"tier": "Primary",     "company": "Name", "reason": "One-sentence reason"},
      {"tier": "Alternative", "company": "Name", "reason": "One-sentence reason"},
      {"tier": "Backup",      "company": "Name", "reason": "One-sentence reason"}
    ]
  },

  "next_steps": {
    "short_term": ["Action 1 (0-3 months)", "Action 2 (0-3 months)"],
    "mid_term":   ["Action 1 (3-12 months)", "Action 2 (3-12 months)"],
    "long_term":  ["Action 1 (1-3 years)",   "Action 2 (1-3 years)"]
  },

  "authoritative_sources": [
    {"name": "Source name", "url": "URL or empty string", "reliability": "HIGH|MEDIUM|LOW", "type": "Source type"}
  ],
  "analyst_notes": "Data limitations and next verification steps"
}"""


def _build_candidates_prompt(research_text: str, sector_key: str) -> str:
    cfg = SECTOR_CONFIGS[sector_key]
    dim_keys = [d["key"] for d in cfg["dimensions"]]
    return (
        "ALL string values must be in English.\n\n"
        f"Extract ALL candidate companies from the research report below and structure them as JSON.\n"
        f"Include EVERY company mentioned in the research — do not truncate the list.\n"
        f"Sector: {cfg['label']}\n"
        f"Dimension keys (include all of these in every candidate's 'dimensions' object): {dim_keys}\n"
        f"Set 'weighted_score' to 0 for every candidate — it is computed server-side.\n\n"
        f"JSON Schema:\n{_CANDIDATES_SCHEMA}\n\n"
        f"Research report:\n{research_text[:12000]}"
    )


def _build_meta_prompt(research_text: str, sector_key: str) -> str:
    cfg = SECTOR_CONFIGS[sector_key]
    return (
        "ALL string values must be in English.\n\n"
        f"Using the research report below, generate the analysis and recommendation sections as JSON.\n"
        f"Sector: {cfg['label']}\n\n"
        f"JSON Schema:\n{_META_SCHEMA}\n\n"
        f"Research report:\n{research_text[:12000]}"
    )


# ---------------------------------------------------------------------------
# Core pipeline functions
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
          json_mode: bool = False, search: bool = False,
          max_tokens: int = 8000) -> str:
    kwargs: dict = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user",   "content": user},
        ],
        "temperature": 0.1,
        "max_tokens": max_tokens,
    }
    if json_mode:
        kwargs["response_format"] = {"type": "json_object"}
    if search:
        kwargs["extra_body"] = {"enable_search": True}
    resp = client.chat.completions.create(**kwargs)
    return resp.choices[0].message.content or ""


def compute_weighted_score(dimensions: dict, sector_key: str) -> int:
    """
    Deterministic weighted score — mirrors frontend computeWeightedScore().
    Formula: Σ (dimension.score × weight × 20), clamped to [0, 100].
    Always computed in Python; never trusted from LLM output.
    """
    dims = SECTOR_CONFIGS.get(sector_key, {}).get("dimensions", [])
    total = 0.0
    for dim in dims:
        raw = (dimensions.get(dim["key"]) or {}).get("score", 0)
        score = float(raw) if raw else 0.0
        total += score * dim["weight"] * 20
    return max(0, min(100, round(total)))


def _parse_json_report(raw: str, sector_key: str) -> dict:
    """Strip markdown fences and parse JSON; build a safe skeleton on failure."""
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip(),
                     flags=re.MULTILINE)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        logger.warning("Partner search JSON parse failed; returning raw text skeleton")
        return {
            "sector": SECTOR_CONFIGS[sector_key]["label"],
            "search_date": date.today().isoformat(),
            "parse_error": True,
            "raw_research": raw[:3000],
            "summary": {"overview": "JSON parsing failed — see raw_research.", "key_considerations": []},
            "candidates": [],
            "comparison_chart": {"criteria": [], "rows": []},
            "industry_insight": {"market_overview": "", "key_trends": [], "regulatory_environment": "", "competitive_landscape": ""},
            "recommendation_model": {"methodology": "", "top_pick": "", "top_pick_rationale": "", "tiered_recommendations": []},
            "next_steps": {"short_term": [], "mid_term": [], "long_term": []},
            "authoritative_sources": [],
            "analyst_notes": "JSON parsing failed — raw research text preserved in raw_research field.",
        }


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def find_partners(brief: str, sector_key: str, config: Any,
                  region: str = "", industry: str = "") -> dict:
    """
    Full pipeline: client brief ──► structured partner comparison report.

    Parameters
    ----------
    brief      : Free-text client requirements (may be empty)
    sector_key : "consumer_electronics_brand" | "social_commerce_agency"
    config     : Flask app.config or equivalent dict / dataclass
    region     : Optional — restrict search to a specific China region/city (e.g. "威海")
    industry   : Optional — override the default industry focus (e.g. "渔具", "fishing gear")

    Returns
    -------
    Structured dict with candidates, scores, top3 recommendation, sources.
    """
    if sector_key not in SECTOR_CONFIGS:
        raise ValueError(
            f"Unknown sector '{sector_key}'. "
            f"Valid: {list(SECTOR_CONFIGS.keys())}"
        )

    if not _cfg(config, "LLM_API_KEY"):
        raise ValueError("LLM_API_KEY is not configured")

    client = _make_client(config)
    model  = _cfg(config, "LLM_CHAT_MODEL", "qwen-plus")

    logger.info(
        "PartnerSearch: sector=%s region=%r industry=%r, searching candidates…",
        sector_key, region, industry,
    )

    # ── Phase 1: Discovery + research via web search ─────────────────────────
    research_prompt = _build_research_prompt(brief, sector_key,
                                             region=region, industry=industry)
    try:
        research_text = _chat(
            client, model,
            _RESEARCH_SYSTEM, research_prompt,
            search=True,
        )
    except Exception as exc:
        logger.exception("PartnerSearch: research phase failed")
        raise RuntimeError(f"Partner search failed (research phase): {exc}") from exc

    logger.info(
        "PartnerSearch: research complete (%d chars); structuring…",
        len(research_text),
    )

    # ── Phase 2a: Structure candidates (dedicated call, high token budget) ──────
    try:
        raw_candidates = _chat(
            client, model,
            _STRUCTURE_SYSTEM,
            _build_candidates_prompt(research_text, sector_key),
            json_mode=True,
            max_tokens=12000,
        )
    except Exception as exc:
        logger.exception("PartnerSearch: candidates structuring failed")
        return {
            "sector": SECTOR_CONFIGS[sector_key]["label"],
            "search_date": date.today().isoformat(),
            "structure_error": True,
            "raw_research": research_text,
            "summary": {"overview": "", "key_considerations": []},
            "candidates": [],
            "comparison_chart": {"criteria": [], "rows": []},
            "industry_insight": {"market_overview": "", "key_trends": [], "regulatory_environment": "", "competitive_landscape": ""},
            "recommendation_model": {"methodology": "", "top_pick": "", "top_pick_rationale": "", "tiered_recommendations": []},
            "next_steps": {"short_term": [], "mid_term": [], "long_term": []},
            "authoritative_sources": [],
            "analyst_notes": f"Structuring error: {exc}",
        }

    candidates_obj = _parse_json_report(raw_candidates, sector_key)
    candidates_list = candidates_obj.get("candidates", [])
    logger.info("PartnerSearch: structured %d candidates", len(candidates_list))

    # ── Phase 2b: Structure meta sections (summary/insight/recommendation) ────
    try:
        raw_meta = _chat(
            client, model,
            _STRUCTURE_SYSTEM,
            _build_meta_prompt(research_text, sector_key),
            json_mode=True,
            max_tokens=8000,
        )
        meta_obj = _parse_json_report(raw_meta, sector_key)
    except Exception as exc:
        logger.warning("PartnerSearch: meta structuring failed (%s) — using empty meta", exc)
        meta_obj = {}

    # ── Merge candidates + meta into one report ───────────────────────────────
    report = {**meta_obj, "candidates": candidates_list}

    # ── Overwrite weighted_score for every candidate using the deterministic
    #    Python formula — LLM-computed scores are unreliable (often return
    #    a raw 1-5 average instead of a 0-100 weighted sum).
    for candidate in report.get("candidates", []):
        dims = candidate.get("dimensions") or {}
        candidate["weighted_score"] = compute_weighted_score(dims, sector_key)

    # Ensure required top-level fields exist
    report.setdefault("sector",       SECTOR_CONFIGS[sector_key]["label"])
    report.setdefault("search_date",  date.today().isoformat())
    report.setdefault("summary",      {"overview": "", "key_considerations": []})
    report.setdefault("candidates",   [])
    report.setdefault("comparison_chart", {"criteria": [], "rows": []})
    report.setdefault("industry_insight", {"market_overview": "", "key_trends": [], "regulatory_environment": "", "competitive_landscape": ""})
    report.setdefault("recommendation_model", {"methodology": "", "top_pick": "", "top_pick_rationale": "", "tiered_recommendations": []})
    report.setdefault("next_steps",   {"short_term": [], "mid_term": [], "long_term": []})
    report.setdefault("authoritative_sources", [])
    report.setdefault("analyst_notes", "")
    report["_meta"] = {
        "sector_key":      sector_key,
        "brief_length":    len(brief),
        "region":          region,
        "industry":        industry,
        "research_chars":  len(research_text),
        "candidate_count": len(report.get("candidates", [])),
    }

    logger.info(
        "PartnerSearch: done — %d candidates found",
        len(report.get("candidates", [])),
    )
    return report
