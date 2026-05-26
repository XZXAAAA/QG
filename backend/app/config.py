import json
import os
from dataclasses import dataclass, field

from dotenv import load_dotenv


load_dotenv()


@dataclass
class Config:
    DEBUG: bool = os.getenv("FLASK_DEBUG", "0") == "1"
    LLM_BASE_URL: str = os.getenv(
        "LLM_BASE_URL",
        "https://dashscope.aliyuncs.com/compatible-mode/v1",
    )
    LLM_API_KEY: str = os.getenv("LLM_API_KEY", "")
    LLM_CHAT_MODEL: str = os.getenv("LLM_CHAT_MODEL", "qwen-plus")
    CORS_ORIGINS: list[str] = field(
        default_factory=lambda: json.loads(
            os.getenv(
                "CORS_ORIGINS_JSON",
                '["http://127.0.0.1:5173", "http://localhost:5173"]',
            )
        )
    )
    MCP_SERVER_COMMAND: str = os.getenv("MCP_SERVER_COMMAND", "npx")
    MCP_SERVER_ARGS: list[str] = field(
        default_factory=lambda: json.loads(
            os.getenv(
                "MCP_SERVER_ARGS_JSON",
                '["-y", "@ansvar/chinese-law-mcp"]',
            )
        )
    )
    MCP_TRANSPORT: str = os.getenv("MCP_TRANSPORT", "auto")
    MCP_SERVER_URL: str = os.getenv(
        "MCP_SERVER_URL",
        "https://chinese-law-mcp.vercel.app/mcp",
    )
    FARUI_ENDPOINT: str = os.getenv(
        "FARUI_ENDPOINT",
        "farui.cn-hangzhou.aliyuncs.com",
    )
    FARUI_REGION_ID: str = os.getenv("FARUI_REGION_ID", "cn-hangzhou")
    FARUI_APP_ID: str = os.getenv("FARUI_APP_ID", "farui")
    FARUI_WORKSPACE_ID: str = os.getenv("FARUI_WORKSPACE_ID", "default")
    FARUI_ACCESS_KEY_ID: str = os.getenv("FARUI_ACCESS_KEY_ID", "")
    FARUI_ACCESS_KEY_SECRET: str = os.getenv("FARUI_ACCESS_KEY_SECRET", "")
    FARUI_ACCESS_KEY_FILE: str = os.getenv("FARUI_ACCESS_KEY_FILE", "")
    FARUI_DEFAULT_DEEP_THINK: bool = os.getenv(
        "FARUI_DEFAULT_DEEP_THINK",
        "1",
    ) == "1"
    FARUI_DEFAULT_ONLINE_SEARCH: bool = os.getenv(
        "FARUI_DEFAULT_ONLINE_SEARCH",
        "1",
    ) == "1"
    FARUI_USE_MODEL_FALLBACK: bool = os.getenv(
        "FARUI_USE_MODEL_FALLBACK",
        "1",
    ) == "1"
    FARUI_MODEL_BASE_URL: str = os.getenv(
        "FARUI_MODEL_BASE_URL",
        "https://dashscope.aliyuncs.com/compatible-mode/v1",
    )
    FARUI_MODEL_API_KEY: str = os.getenv(
        "FARUI_MODEL_API_KEY",
    ) or os.getenv(
        "LLM_API_KEY",
        "",
    )
    FARUI_MODEL_NAME: str = os.getenv("FARUI_MODEL_NAME", "farui-plus")
    # Contract review model — defaults to LLM_CHAT_MODEL when empty.
    # Set to "qwen-max" for higher-quality contract analysis on production.
    CONTRACT_ANALYSIS_MODEL: str = os.getenv("CONTRACT_ANALYSIS_MODEL", "")
    # 企查查 API — optional; investment module degrades gracefully without it.
    QICHACHA_KEY: str = os.getenv("QICHACHA_KEY", "")
    QICHACHA_SECRET: str = os.getenv("QICHACHA_SECRET", "")
    QICHACHA_BASE_URL: str = os.getenv("QICHACHA_BASE_URL", "https://api.qichacha.com")
    QCC_PROXY: str = os.getenv("QCC_PROXY", "")
    # n8n daily-news webhook integration (optional, kept for backward compat)
    N8N_NEWS_ENABLED: bool = os.getenv("N8N_NEWS_ENABLED", "0") == "1"
    N8N_NEWS_WEBHOOK_URL: str = os.getenv("N8N_NEWS_WEBHOOK_URL", "")
    N8N_NEWS_AUTH_TOKEN: str = os.getenv("N8N_NEWS_AUTH_TOKEN", "")
    N8N_NEWS_TIMEOUT_SEC: int = int(os.getenv("N8N_NEWS_TIMEOUT_SEC", "15"))

    # ── Native daily-news pipeline (Python replacement for n8n) ──────────────
    # DeepSeek API for news processing (falls back to LLM_API_KEY / LLM_BASE_URL)
    NEWS_DEEPSEEK_API_KEY: str = os.getenv("NEWS_DEEPSEEK_API_KEY", "")
    NEWS_DEEPSEEK_BASE_URL: str = os.getenv(
        "NEWS_DEEPSEEK_BASE_URL", "https://api.deepseek.com"
    )
    NEWS_DEEPSEEK_MODEL: str = os.getenv("NEWS_DEEPSEEK_MODEL", "deepseek-chat")
    # SQLite cache location (defaults to backend/news_cache.db)
    NEWS_CACHE_DB_PATH: str = os.getenv("NEWS_CACHE_DB_PATH", "")
    # How many days to keep cached articles before purging
    NEWS_CACHE_TTL_DAYS: int = int(os.getenv("NEWS_CACHE_TTL_DAYS", "7"))
    # Enable/disable the native pipeline (True by default)
    NEWS_PIPELINE_ENABLED: bool = os.getenv("NEWS_PIPELINE_ENABLED", "1") == "1"
