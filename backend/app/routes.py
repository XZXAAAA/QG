from datetime import date
from flask import Blueprint, current_app, jsonify, request

from .services.chat_service import ChatService
from .services.contract_service import analyze_contract, extract_text
from .services.contract_store import ContractStore
from .services.farui_service import FaruiService
from .services.investment_service import evaluate_company, fetch_daily_news_for_company
from .services.qichacha_service import get_basic_details_by_name, is_configured
from .services.daily_news_service import DailyNewsPipeline
from .services.news_cache import NewsCache
from .services.partner_search_service import find_partners, SECTOR_CONFIGS as PARTNER_SECTOR_CONFIGS
from .services.partner_intel_service import deep_evaluate


api_bp = Blueprint("api", __name__)

# Module-level store — persists for the lifetime of the Flask process.
# Both upload and analyze share this single instance.
_contract_store = ContractStore()


@api_bp.get("/health")
def health_check():
    return jsonify(
        {
            "status": "ok",
            "model": current_app.config["LLM_CHAT_MODEL"],
            "mcpTransport": current_app.config["MCP_TRANSPORT"],
            "mcpCommand": current_app.config["MCP_SERVER_COMMAND"],
            "mcpArgs": current_app.config["MCP_SERVER_ARGS"],
            "mcpUrl": current_app.config["MCP_SERVER_URL"],
            "faruiAppId": current_app.config["FARUI_APP_ID"],
            "faruiWorkspaceId": current_app.config["FARUI_WORKSPACE_ID"],
            "faruiHasAccessKey": bool(
                current_app.config["FARUI_ACCESS_KEY_ID"]
                or current_app.config["FARUI_ACCESS_KEY_FILE"]
            ),
            "faruiModelFallback": current_app.config["FARUI_USE_MODEL_FALLBACK"],
        }
    )


@api_bp.post("/chat")
def chat():
    payload = request.get_json(silent=True) or {}
    message = (payload.get("message") or "").strip()
    history = payload.get("history") or []

    if not message:
        return jsonify({"error": "message is required"}), 400

    if not current_app.config["LLM_API_KEY"]:
        return jsonify({"error": "LLM_API_KEY is not configured on the server"}), 500

    service = ChatService(current_app.config)

    try:
        result = service.reply(message=message, history=history)
        return jsonify(result)
    except Exception as exc:  # noqa: BLE001
        current_app.logger.exception("Chat request failed")
        error_payload = {
            "error": f"Request failed: {type(exc).__name__}: {exc}",
        }
        if current_app.config["DEBUG"]:
            error_payload["hint"] = (
                "Check Flask terminal logs. Common causes: MCP server failed to start, "
                "invalid LLM_API_KEY, or the model rejected certain DashScope/OpenAI-compatible parameters."
            )
        return jsonify(error_payload), 500


@api_bp.post("/farui/chat")
def farui_chat():
    payload = request.get_json(silent=True) or {}
    message = (payload.get("message") or "").strip()
    history = payload.get("history") or []
    deep_think = payload.get("deepThink")
    online_search = payload.get("onlineSearch")

    if not message:
        return jsonify({"error": "message is required"}), 400

    service = FaruiService(current_app.config)

    try:
        result = service.reply(
            message=message,
            history=history,
            deep_think=deep_think,
            online_search=online_search,
        )
        return jsonify(result)
    except Exception as exc:  # noqa: BLE001
        current_app.logger.exception("Tongyi FaRui request failed")
        return jsonify({"error": f"Legal consultation service error: {type(exc).__name__}: {exc}"}), 500


# ---------------------------------------------------------------------------
# Contract review
# ---------------------------------------------------------------------------

MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB


@api_bp.post("/contract/upload")
def contract_upload():
    """
    Accept a raw file body (PDF or DOCX) and extract its text server-side.

    Query param:
      filename=<original filename including extension>  (required for type detection)

    Returns:
      {"file_id": "<uuid>", "chars": <int>, "filename": "<str>"}
    """
    filename = (request.args.get("filename") or "upload.bin").strip()
    file_bytes = request.get_data()

    if not file_bytes:
        return jsonify({"error": "Request body is empty. Send the file as raw bytes."}), 400

    if len(file_bytes) > MAX_UPLOAD_BYTES:
        return jsonify({"error": "File exceeds the 10 MB size limit."}), 413

    try:
        text = extract_text(file_bytes, filename)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 422
    except Exception as exc:  # noqa: BLE001
        current_app.logger.exception("Contract text extraction failed")
        return jsonify({"error": f"Text extraction failed: {type(exc).__name__}: {exc}"}), 500

    file_id = _contract_store.save(text)
    return jsonify({"file_id": file_id, "chars": len(text), "filename": filename})


@api_bp.post("/contract/analyze")
def contract_analyze():
    """
    Run AI contract review on a previously uploaded file.

    Body (JSON):
      {"file_id": "<uuid returned by /contract/upload>"}

    Returns the full analysis JSON (riskScore, clauseAnalysis, suggestions, …).
    """
    payload = request.get_json(silent=True) or {}
    file_id = (payload.get("file_id") or "").strip()

    if not file_id:
        return jsonify({"error": "file_id is required."}), 400

    text = _contract_store.get(file_id)
    if text is None:
        return jsonify(
            {"error": "file_id not found. The session may have expired — please upload the file again."}
        ), 404

    if not current_app.config.get("LLM_API_KEY"):
        return jsonify({"error": "Backend is missing LLM_API_KEY configuration."}), 500

    # Build optional FaRui service for supplementary legal opinion.
    # Non-fatal: if FaRui is not configured the analysis still runs.
    farui_service = None
    try:
        farui_service = FaruiService(current_app.config)
    except Exception:  # noqa: BLE001
        pass

    try:
        result = analyze_contract(
            contract_text=text,
            config=current_app.config,
            farui_service=farui_service,
        )
        return jsonify(result)
    except RuntimeError as exc:
        current_app.logger.exception("Contract analysis failed")
        return jsonify({"error": str(exc)}), 500
    except Exception as exc:  # noqa: BLE001
        current_app.logger.exception("Unexpected error during contract analysis")
        return jsonify({"error": f"Unexpected error: {type(exc).__name__}: {exc}"}), 500



# ---------------------------------------------------------------------------
# Qichacha company registry lookup
# ---------------------------------------------------------------------------

@api_bp.get("/qichacha/status")
def qichacha_status():
    """Return whether Qichacha credentials are configured on the backend."""
    return jsonify({
        "ok": True,
        "configured": is_configured(current_app.config),
        "baseUrl": current_app.config.get("QICHACHA_BASE_URL", "https://api.qichacha.com"),
        "hasProxy": bool(current_app.config.get("QCC_PROXY")),
    })


@api_bp.get("/qichacha/company")
def qichacha_company_get():
    """Direct Qichacha company basic-info lookup.

    Query:
      keyword=<company name / unified social credit code>
    """
    keyword = (request.args.get("keyword") or "").strip()
    if not keyword:
        return jsonify({"ok": False, "error": "keyword is required"}), 400
    try:
        return jsonify(get_basic_details_by_name(keyword, current_app.config))
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400
    except Exception as exc:  # noqa: BLE001
        current_app.logger.exception("Qichacha company lookup failed")
        return jsonify({"ok": False, "error": f"{type(exc).__name__}: {exc}"}), 500


@api_bp.post("/qichacha/company")
def qichacha_company_post():
    """POST variant for frontend integrations. Body: {"keyword": "..."}."""
    payload = request.get_json(silent=True) or {}
    keyword = (payload.get("keyword") or "").strip()
    if not keyword:
        return jsonify({"ok": False, "error": "keyword is required"}), 400
    try:
        return jsonify(get_basic_details_by_name(keyword, current_app.config))
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400
    except Exception as exc:  # noqa: BLE001
        current_app.logger.exception("Qichacha company lookup failed")
        return jsonify({"ok": False, "error": f"{type(exc).__name__}: {exc}"}), 500

# ---------------------------------------------------------------------------
# Investment evaluation
# ---------------------------------------------------------------------------

@api_bp.post("/investment/evaluate")
def investment_evaluate():
    """
    Run an AI-powered investment evaluation for a company.

    Body (JSON):
      {"query": "<company name or question about a company>"}

    Returns a structured investment report JSON.
    """
    payload = request.get_json(silent=True) or {}
    query = (payload.get("query") or "").strip()
    # Optional supplementary JSON uploaded by the user (news data, industry report, etc.)
    extra_json = payload.get("extra_json")  # may be dict, list, or None

    if not query:
        return jsonify({"error": "query cannot be empty"}), 400

    if not current_app.config.get("LLM_API_KEY"):
        return jsonify({"error": "Backend is missing LLM_API_KEY configuration."}), 500

    try:
        result = evaluate_company(query, current_app.config, extra_json=extra_json)
        return jsonify(result)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:  # noqa: BLE001
        current_app.logger.exception("Investment evaluation failed")
        return jsonify({"error": f"Evaluation failed: {type(exc).__name__}: {exc}"}), 500


@api_bp.get("/investment/news")
def investment_news():
    """
    Return cached daily news, optionally filtered by company keyword.

    Query params:
      company=<company name>   (optional — returns company-specific articles + today's report)
      days=<int>               (optional — look-back window, default 1)
    """
    company = (request.args.get("company") or "").strip()
    try:
        days = int(request.args.get("days", 1))
    except (ValueError, TypeError):
        return jsonify({"ok": False, "error": "days must be an integer"}), 400

    payload = fetch_daily_news_for_company(company or "", current_app.config)
    if payload is None:
        return jsonify({
            "ok": False,
            "error": "No news data available. Run /investment/news/refresh to populate the cache.",
        }), 404
    return jsonify({"ok": True, "data": payload})


@api_bp.post("/investment/news/refresh")
def investment_news_refresh():
    """
    Trigger a full pipeline run to refresh today's news cache.

    Body (JSON, all optional):
      {"force": true}   — bypass today's cache even if it exists
    """
    payload = request.get_json(silent=True) or {}
    force = bool(payload.get("force", False))

    if not current_app.config.get("NEWS_PIPELINE_ENABLED", True):
        return jsonify({"ok": False, "error": "NEWS_PIPELINE_ENABLED is false"}), 503

    if not current_app.config.get("LLM_API_KEY"):
        return jsonify({"ok": False, "error": "LLM_API_KEY not configured"}), 500

    try:
        pipeline = DailyNewsPipeline(current_app.config)
        result = pipeline.run(force=force)
        return jsonify({"ok": True, "data": result})
    except Exception as exc:
        current_app.logger.exception("News pipeline refresh failed")
        return jsonify({"ok": False, "error": f"{type(exc).__name__}: {exc}"}), 500


@api_bp.get("/investment/news/today")
def investment_news_today():
    """Return today's cached articles (all sectors, no AI filtering)."""
    db_path = current_app.config.get("NEWS_CACHE_DB_PATH") or ""
    cache = NewsCache(db_path=db_path)
    articles = cache.get_today_articles()
    report = cache.get_today_report()
    return jsonify({
        "ok": True,
        "date": date.today().isoformat(),
        "article_count": len(articles),
        "articles": articles,
        "daily_report": report.get("content", "") if report else "",
        "sections": report.get("sections", []) if report else [],
    })


@api_bp.get("/investment/news/search")
def investment_news_search():
    """
    Full-text search the news cache for a company or keyword.

    Query:
      q=<search term>    (required)
      days=<int>         (optional, default 7)
    """
    q = (request.args.get("q") or "").strip()
    try:
        days = int(request.args.get("days", 7))
    except (ValueError, TypeError):
        return jsonify({"ok": False, "error": "days must be an integer"}), 400

    if not q:
        return jsonify({"ok": False, "error": "q parameter is required"}), 400

    db_path = current_app.config.get("NEWS_CACHE_DB_PATH") or ""
    cache = NewsCache(db_path=db_path)
    articles = cache.search_by_company(q, days=days)
    return jsonify({
        "ok": True,
        "query": q,
        "days": days,
        "count": len(articles),
        "articles": articles,
    })


@api_bp.get("/investment/news/stats")
def investment_news_stats():
    """Return cache statistics (article counts, DB health)."""
    db_path = current_app.config.get("NEWS_CACHE_DB_PATH") or ""
    cache = NewsCache(db_path=db_path)
    return jsonify({"ok": True, "stats": cache.stats()})


# ---------------------------------------------------------------------------
# Partner search
# ---------------------------------------------------------------------------

@api_bp.get("/partner/sectors")
def partner_sectors():
    """Return the list of supported partner-search sectors and their dimension configs."""
    return jsonify({
        "ok": True,
        "sectors": {
            key: {
                "label":      cfg["label"],
                "target_type": cfg["target_type"],
                "dimensions": [
                    {
                        "key":    d["key"],
                        "label":  d["label"],
                        "weight": d["weight"],
                    }
                    for d in cfg["dimensions"]
                ],
            }
            for key, cfg in PARTNER_SECTOR_CONFIGS.items()
        },
    })


@api_bp.post("/partner/search")
def partner_search():
    """
    Discover and evaluate Chinese partner companies for a client brief.

    Body (JSON):
      {
        "sector":  "consumer_electronics_brand" | "social_commerce_agency",
        "brief":   "<free-text client requirements>",   (optional)
      }

    Returns a structured comparison report with scored candidates, top-3
    recommendation, and authoritative source citations.

    Note: This endpoint calls Qwen with web search enabled and may take
    60–120 seconds to complete.
    """
    payload    = request.get_json(silent=True) or {}
    sector_key = (payload.get("sector")   or "").strip()
    brief      = (payload.get("brief")    or "").strip()
    region     = (payload.get("region")   or "").strip()
    industry   = (payload.get("industry") or "").strip()

    if not sector_key:
        return jsonify({"ok": False, "error": "sector is required"}), 400

    if sector_key not in PARTNER_SECTOR_CONFIGS:
        valid = list(PARTNER_SECTOR_CONFIGS.keys())
        return jsonify({"ok": False, "error": f"Invalid sector. Valid: {valid}"}), 400

    if not current_app.config.get("LLM_API_KEY"):
        return jsonify({"ok": False, "error": "LLM_API_KEY not configured"}), 500

    try:
        result = find_partners(brief=brief, sector_key=sector_key,
                               config=current_app.config,
                               region=region, industry=industry)
        return jsonify({"ok": True, "data": result})
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400
    except Exception as exc:  # noqa: BLE001
        current_app.logger.exception("Partner search failed")
        return jsonify({"ok": False, "error": f"{type(exc).__name__}: {exc}"}), 500


@api_bp.post("/partner/deep-evaluate")
def partner_deep_evaluate():
    """
    Phase 2: Deep-dive evaluation for a company identified in Partner Discovery.

    Body (JSON):
      {
        "sector_key":            "consumer_electronics_brand",
        "company_name_cn":       "海信集团",
        "company_name_en":       "Hisense Group",
        "preset_dimensions":     { "<dim_key>": {"score": 4, ...}, ... },
        "preset_weighted_score": 82
      }

    Returns the full deep evaluation report.
    partnerScore is computed from refined dimensions using the same deterministic
    formula as Phase 1, ensuring score consistency across both phases.
    """
    payload              = request.get_json(silent=True) or {}
    sector_key           = (payload.get("sector_key")       or "").strip()
    company_name_cn      = (payload.get("company_name_cn")  or "").strip()
    company_name_en      = (payload.get("company_name_en")  or "").strip()
    preset_dimensions    = payload.get("preset_dimensions")  or {}
    try:
        preset_weighted_score = int(payload.get("preset_weighted_score") or 0)
    except (TypeError, ValueError):
        preset_weighted_score = 0

    if not sector_key:
        return jsonify({"ok": False, "error": "sector_key is required"}), 400
    if not (company_name_cn or company_name_en):
        return jsonify({"ok": False, "error": "company_name_cn or company_name_en is required"}), 400
    if not current_app.config.get("LLM_API_KEY"):
        return jsonify({"ok": False, "error": "LLM_API_KEY not configured"}), 500

    try:
        result = deep_evaluate(
            sector_key=sector_key,
            company_name_cn=company_name_cn,
            company_name_en=company_name_en,
            preset_dimensions=preset_dimensions,
            preset_weighted_score=preset_weighted_score,
            config=current_app.config,
        )
        return jsonify({"ok": True, "data": result})
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400
    except Exception as exc:  # noqa: BLE001
        current_app.logger.exception("Partner deep evaluation failed")
        return jsonify({"ok": False, "error": f"{type(exc).__name__}: {exc}"}), 500
