"""Qichacha Open API client.

This module keeps the Qichacha credentials on the Flask backend and exposes a
small, safe wrapper for frontend/company-intelligence use.

Official auth used by the screenshots:
  Token    = MD5(AppKey + Timespan + SecretKey).upper()
  Timespan = current Unix timestamp in seconds
  key      = AppKey, sent as a query parameter
"""
from __future__ import annotations

import hashlib
import logging
import os
import time
from typing import Any, Optional

import requests

logger = logging.getLogger(__name__)

DEFAULT_QICHACHA_BASE_URL = "https://api.qichacha.com"

# Common Qichacha status codes that are useful for debugging in the UI.
STATUS_HINTS = {
    "200": "success",
    "100": "no matching result or parameter issue",
    "101": "missing required parameter",
    "102": "invalid parameter format",
    "103": "invalid or expired API key",
    "107": "insufficient balance or API not purchased",
    "115": "API not purchased / no permission",
    "121": "IP is not in the permitted region/whitelist; use a mainland China server or proxy",
    "214": "API package expired or no permission",
}


def cfg(config: Any, key: str, default: str = "") -> str:
    if hasattr(config, "get"):
        val = config.get(key)
    else:
        val = getattr(config, key, None)
    if val is None:
        return default
    return val if isinstance(val, str) else str(val)


def is_configured(config: Any) -> bool:
    return bool(cfg(config, "QICHACHA_KEY") and cfg(config, "QICHACHA_SECRET"))


def make_token(app_key: str, timespan: int | str, secret_key: str) -> str:
    raw = f"{app_key}{timespan}{secret_key}"
    return hashlib.md5(raw.encode("utf-8")).hexdigest().upper()


def qichacha_get(
    path: str,
    params: dict[str, Any],
    config: Any,
    *,
    timeout: int = 15,
    proxies: Optional[dict[str, str]] = None,
) -> dict[str, Any]:
    """Call a Qichacha GET endpoint and return a normalized payload.

    The returned dict intentionally contains both raw and normalized fields so
    the UI can show exact API responses when debugging.
    """
    app_key = cfg(config, "QICHACHA_KEY")
    secret_key = cfg(config, "QICHACHA_SECRET")
    if not app_key or not secret_key:
        raise ValueError("QICHACHA_KEY and QICHACHA_SECRET are not configured")

    base_url = cfg(config, "QICHACHA_BASE_URL", DEFAULT_QICHACHA_BASE_URL).rstrip("/")
    clean_path = path if path.startswith("/") else f"/{path}"
    timespan = int(time.time())
    token = make_token(app_key, timespan, secret_key)

    query = {"key": app_key, **params}
    headers = {
        "Token": token,
        "Timespan": str(timespan),
        "Accept": "application/json",
    }

    if proxies is None:
        proxy_url = cfg(config, "QCC_PROXY") or os.getenv("QCC_PROXY", "")
        proxies = {"http": proxy_url, "https": proxy_url} if proxy_url else None

    response = requests.get(
        f"{base_url}{clean_path}",
        params=query,
        headers=headers,
        timeout=timeout,
        proxies=proxies,
    )
    response.raise_for_status()
    raw = response.json()

    status = str(raw.get("Status", ""))
    normalized = {
        "ok": status == "200",
        "status": status,
        "message": raw.get("Message") or raw.get("message") or STATUS_HINTS.get(status, ""),
        "hint": STATUS_HINTS.get(status, ""),
        "endpoint": clean_path,
        "data": raw.get("Data"),
        "raw": raw,
    }
    if status in {"103", "107", "115", "121", "214"}:
        logger.warning("Qichacha returned Status=%s for %s: %s", status, clean_path, normalized["message"])
    return normalized


def get_basic_details_by_name(keyword: str, config: Any) -> dict[str, Any]:
    """Qichacha risk-control scan by company name or unified social credit code.

    Your purchased API:
      GET /RiskControl/Scan?key=<AppKey>&searchKey=<company>
    """
    keyword = (keyword or "").strip()
    if not keyword:
        raise ValueError("keyword is required")

    return qichacha_get(
        "/RiskControl/Scan",
        {"searchKey": keyword},
        config,
    )
