import csv
import json
import logging
from pathlib import Path
from typing import Any

from alibabacloud_farui20240628 import models as farui_models
from alibabacloud_farui20240628.client import Client as FaruiClient
from alibabacloud_tea_openapi import models as open_api_models
from darabonba.runtime import RuntimeOptions
from openai import OpenAI

from .translation_service import MarkdownTranslationService


logger = logging.getLogger(__name__)


FARUI_MODEL_SYSTEM_PROMPT = """You are a professional AI assistant for QG Group, specialising in legal, investment, and cross-border business intelligence.

Requirements:
1. Always answer in English.
2. For legal and investment questions (especially Chinese law, Saudi-China trade, cross-border compliance), provide thorough analysis with rules, practical steps, and risks.
3. For any other question the user asks — business strategy, market analysis, general knowledge, calculations, etc. — answer it directly and helpfully. Do NOT refuse or deflect.
4. Start with a concise conclusion, then provide supporting detail.
5. If facts are incomplete, still provide a best-effort analysis and clearly state what additional information would sharpen the answer.
6. All output is for reference and informational purposes only, not formal legal advice.
"""

FARUI_APPLICATION_SYSTEM_MESSAGE = (
    "Always answer in English. "
    "Answer any question the user asks — legal, investment, business, or general. "
    "For legal and investment topics, provide structured analysis with risks and next steps. "
    "For all other topics, answer directly and helpfully."
)


class FaruiService:
    def __init__(self, config: dict[str, Any]) -> None:
        self.config = config
        self.runtime = RuntimeOptions(read_timeout=60000, connect_timeout=10000)
        self.workspace_id = (config.get("FARUI_WORKSPACE_ID") or "default").strip()
        self.app_id = (config.get("FARUI_APP_ID") or "farui").strip()
        self.translation_service = MarkdownTranslationService(target="en")

        access_key_id, access_key_secret = self._resolve_access_keys()
        self.application_client: FaruiClient | None = None
        if access_key_id and access_key_secret:
            sdk_config = open_api_models.Config(
                access_key_id=access_key_id,
                access_key_secret=access_key_secret,
                endpoint=config["FARUI_ENDPOINT"],
                region_id=config["FARUI_REGION_ID"],
                read_timeout=60000,
                connect_timeout=10000,
            )
            self.application_client = FaruiClient(sdk_config)

        self.model_client: OpenAI | None = None
        if config.get("FARUI_USE_MODEL_FALLBACK") and config.get("FARUI_MODEL_API_KEY"):
            self.model_client = OpenAI(
                api_key=config["FARUI_MODEL_API_KEY"],
                base_url=config["FARUI_MODEL_BASE_URL"],
            )

    def reply(
        self,
        message: str,
        history: list[dict[str, Any]],
        deep_think: bool | None = None,
        online_search: bool | None = None,
    ) -> dict[str, Any]:
        safe_history = self._normalize_history(history)
        use_deep_think = (
            self.config["FARUI_DEFAULT_DEEP_THINK"]
            if deep_think is None
            else bool(deep_think)
        )
        use_online_search = (
            self.config["FARUI_DEFAULT_ONLINE_SEARCH"]
            if online_search is None
            else bool(online_search)
        )

        application_error: Exception | None = None
        if self.application_client is not None:
            try:
                return self._reply_with_application(
                    message=message,
                    history=safe_history,
                    deep_think=use_deep_think,
                    online_search=use_online_search,
                )
            except Exception as exc:  # noqa: BLE001
                application_error = exc
                logger.warning("Tongyi FaRui application API failed: %s", exc)

        if self.model_client is not None:
            result = self._reply_with_model_fallback(
                message=message,
                history=safe_history,
            )
            if application_error is not None:
                result["warnings"] = [
                    "Tongyi FaRui application API is currently unavailable, so the system switched to model fallback.",
                ]
                result["fallbackReason"] = str(application_error)
            return result

        if application_error is not None:
            raise RuntimeError(
                f"Tongyi FaRui request failed: {application_error}"
            ) from application_error

        raise RuntimeError(
            "No Tongyi FaRui configuration is available. Configure AccessKey credentials or enable model fallback."
        )

    def _reply_with_application(
        self,
        message: str,
        history: list[dict[str, str]],
        deep_think: bool,
        online_search: bool,
    ) -> dict[str, Any]:
        thread = farui_models.RunLegalAdviceConsultationRequestThread(
            messages=self._build_application_thread(history, message)
        )
        request = farui_models.RunLegalAdviceConsultationRequest(
            app_id=self.app_id,
            stream=False,
            thread=thread,
            extra=farui_models.RunLegalAdviceConsultationRequestExtra(
                deep_think=deep_think,
                online_search=online_search,
            ),
        )

        response = self.application_client.run_legal_advice_consultation_with_options(
            self.workspace_id,
            request,
            {},
            self.runtime,
        )
        body = response.body

        if not body or not body.success:
            message_text = getattr(body, "message", None) or getattr(body, "code", None)
            raise RuntimeError(message_text or "Tongyi FaRui application API did not return a successful response.")

        contents = self._parse_contents(body.contents)
        laws = self._search_related_laws(query=message)
        translated_reply = self.translation_service.translate_markdown(
            (body.response_markdown or "").strip() or "No valid answer was returned."
        )

        return {
            "reply": translated_reply,
            "mode": "farui_application",
            "requestId": body.request_id,
            "status": body.status,
            "references": {
                "laws": self._translate_laws(laws),
                "cases": [self.translation_service.translate_text(item) for item in contents["cases"]],
                "search": self._translate_search_items(contents["search"]),
            },
            "reasoning": self.translation_service.translate_markdown(contents["reasoning"]),
            "usage": self._usage_to_dict(body.usage),
            "extra": self._parse_json_like(body.extra),
        }

    def _reply_with_model_fallback(
        self,
        message: str,
        history: list[dict[str, str]],
    ) -> dict[str, Any]:
        messages: list[dict[str, str]] = [
            {"role": "system", "content": FARUI_MODEL_SYSTEM_PROMPT},
            *history,
            {"role": "user", "content": message},
        ]
        response = self.model_client.chat.completions.create(
            model=self.config["FARUI_MODEL_NAME"],
            messages=messages,
            temperature=0.2,
        )
        assistant_message = response.choices[0].message
        reply = assistant_message.content or "No valid answer was returned."

        usage = getattr(response, "usage", None)
        usage_payload = None
        if usage is not None:
            usage_payload = {
                "inputTokens": getattr(usage, "prompt_tokens", None),
                "outputTokens": getattr(usage, "completion_tokens", None),
                "totalTokens": getattr(usage, "total_tokens", None),
            }

        return {
            "reply": self.translation_service.translate_markdown(reply.strip()),
            "mode": "farui_model_fallback",
            "requestId": getattr(response, "id", None),
            "status": "completed",
            "references": {
                "laws": [],
                "cases": [],
                "search": [],
            },
            "reasoning": "",
            "usage": usage_payload,
            "extra": {
                "deepThink": False,
                "onlineSearch": False,
            },
        }

    def _search_related_laws(self, query: str) -> list[dict[str, Any]]:
        if self.application_client is None or not query.strip():
            return []

        request = farui_models.RunSearchLawQueryRequest(
            app_id=self.app_id,
            query=query.strip(),
            page_param=farui_models.RunSearchLawQueryRequestPageParam(
                page_number=1,
                page_size=5,
            ),
        )

        try:
            response = self.application_client.run_search_law_query_with_options(
                self.workspace_id,
                request,
                {},
                self.runtime,
            )
        except Exception:  # noqa: BLE001
            logger.exception("Tongyi FaRui law search failed")
            return []

        body = response.body
        if not body or not body.success or body.data is None:
            return []

        laws: list[dict[str, Any]] = []
        for item in body.data.law_result or []:
            law = getattr(item, "law_domain", None)
            if law is None:
                continue
            laws.append(
                {
                    "lawId": law.law_id,
                    "lawItemId": law.law_item_id,
                    "lawName": law.law_name,
                    "lawTitle": law.law_title,
                    "lawOrder": law.law_order,
                    "timeliness": law.timeliness,
                    "releaseDate": law.release_year_month_date,
                    "implementDate": law.implement_year_month_date,
                    "issuingNo": law.issuing_no,
                    "sourceContent": law.law_source_content,
                    "similarity": getattr(item, "similarity", None),
                }
            )

        return laws

    def _translate_laws(self, laws: list[dict[str, Any]]) -> list[dict[str, Any]]:
        translated: list[dict[str, Any]] = []
        for law in laws:
            translated.append(
                {
                    **law,
                    "lawName": self.translation_service.translate_text(law.get("lawName")),
                    "lawTitle": self.translation_service.translate_text(law.get("lawTitle")),
                    "lawOrder": self.translation_service.translate_text(law.get("lawOrder")),
                    "sourceContent": self.translation_service.translate_text(
                        law.get("sourceContent")
                    ),
                    "timeliness": self.translation_service.translate_text(law.get("timeliness")),
                }
            )
        return translated

    def _translate_search_items(self, items: list[Any]) -> list[Any]:
        translated: list[Any] = []
        for item in items:
            if isinstance(item, str):
                translated.append(self.translation_service.translate_text(item))
                continue
            if isinstance(item, dict):
                translated_item = {}
                for key, value in item.items():
                    translated_item[key] = self.translation_service.translate_text(value)
                translated.append(translated_item)
                continue
            translated.append(item)
        return translated

    def _build_application_thread(
        self,
        history: list[dict[str, str]],
        message: str,
    ) -> list[farui_models.RunLegalAdviceConsultationRequestThreadMessages]:
        # Tongyi FaRui API has a limit of 14000 characters for input
        MAX_INPUT_LENGTH = 13000  # Leave buffer for system message and overhead

        messages: list[farui_models.RunLegalAdviceConsultationRequestThreadMessages] = [
            farui_models.RunLegalAdviceConsultationRequestThreadMessages(
                role="system",
                content=FARUI_APPLICATION_SYSTEM_MESSAGE,
            )
        ]

        # Budget: subtract system message and current user message from the limit
        budget = MAX_INPUT_LENGTH - len(FARUI_APPLICATION_SYSTEM_MESSAGE) - len(message)

        # Select history that fits within the budget, keeping the most recent turns.
        # Iterate from newest to oldest to decide what fits, then reverse so the
        # final message list is in correct chronological order (oldest → newest).
        recent = history[-10:]  # cap at last 10 exchanges
        selected: list[dict[str, str]] = []
        for item in reversed(recent):
            item_length = len(item["content"])
            if budget <= 0:
                break
            if item_length > budget:
                # Partially include this message to fill remaining budget
                selected.append({**item, "content": item["content"][:budget]})
                budget = 0
                break
            selected.append(item)
            budget -= item_length

        # Restore chronological order (selected was built newest-first)
        for item in reversed(selected):
            messages.append(
                farui_models.RunLegalAdviceConsultationRequestThreadMessages(
                    role=item["role"],
                    content=item["content"],
                )
            )

        # Always include the current user message (truncate only if it alone is too long)
        safe_message = message[:MAX_INPUT_LENGTH] if len(message) > MAX_INPUT_LENGTH else message
        messages.append(
            farui_models.RunLegalAdviceConsultationRequestThreadMessages(
                role="user",
                content=safe_message,
            )
        )
        return messages

    def _normalize_history(self, history: list[dict[str, Any]]) -> list[dict[str, str]]:
        normalized: list[dict[str, str]] = []
        for item in history[-20:]:
            role = item.get("role")
            content = item.get("content")
            if role not in {"user", "assistant", "system"}:
                continue
            if not isinstance(content, str) or not content.strip():
                continue
            normalized.append({"role": role, "content": content.strip()})
        return normalized

    def _resolve_access_keys(self) -> tuple[str, str]:
        access_key_id = (self.config.get("FARUI_ACCESS_KEY_ID") or "").strip()
        access_key_secret = (self.config.get("FARUI_ACCESS_KEY_SECRET") or "").strip()
        if access_key_id and access_key_secret:
            return access_key_id, access_key_secret

        key_file = (self.config.get("FARUI_ACCESS_KEY_FILE") or "").strip()
        if not key_file:
            return "", ""

        try:
            with Path(key_file).expanduser().open(
                "r",
                encoding="utf-8-sig",
                newline="",
            ) as handle:
                reader = csv.DictReader(handle)
                first_row = next(reader, None) or {}
        except Exception:  # noqa: BLE001
            logger.exception("Failed to read Tongyi FaRui access key file")
            return "", ""

        return (
            (first_row.get("AccessKey ID") or "").strip(),
            (first_row.get("AccessKey Secret") or "").strip(),
        )

    def _parse_contents(self, raw_contents: str | None) -> dict[str, Any]:
        parsed = self._parse_json_like(raw_contents)
        result = {
            "reasoning": "",
            "cases": [],
            "search": [],
        }

        if not isinstance(parsed, list):
            return result

        case_set: set[str] = set()
        search_items: list[Any] = []
        reasoning_parts: list[str] = []

        for item in parsed:
            if not isinstance(item, dict):
                continue

            content_type = item.get("contentType") or item.get("type")
            if content_type == "deepThink" and isinstance(item.get("content"), str):
                reasoning_parts.append(item["content"].strip())

            for case_item in item.get("caseList") or []:
                if isinstance(case_item, str) and case_item.strip() and case_item not in case_set:
                    case_set.add(case_item)

            for search_item in item.get("searchList") or []:
                if isinstance(search_item, (str, dict)):
                    search_items.append(search_item)

        result["reasoning"] = "\n\n".join(part for part in reasoning_parts if part)
        result["cases"] = list(case_set)
        result["search"] = search_items[:5]
        return result

    def _parse_json_like(self, payload: Any) -> Any:
        if isinstance(payload, (dict, list)):
            return payload
        if not isinstance(payload, str) or not payload.strip():
            return None
        try:
            return json.loads(payload)
        except json.JSONDecodeError:
            return payload

    def _usage_to_dict(self, usage: Any) -> dict[str, Any] | None:
        if usage is None:
            return None
        return {
            "inputTokens": getattr(usage, "input_tokens", None),
            "outputTokens": getattr(usage, "output_tokens", None),
            "totalTokens": getattr(usage, "total_tokens", None),
        }
