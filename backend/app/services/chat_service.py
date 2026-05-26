import asyncio
import json
from typing import Any

from openai import OpenAI

from .mcp_gateway import McpGateway


SYSTEM_PROMPT = """You are a professional AI assistant for QG Group, specialising in Chinese law, cross-border business, and Saudi-China trade intelligence.

Requirements:
1. Always answer in English.
2. For any question that involves Chinese laws, regulations, or legal provisions, use the available MCP legal tools to retrieve authoritative materials before answering.
3. For questions outside Chinese law (business strategy, market analysis, Saudi trade, general knowledge, calculations, etc.), answer directly using your training knowledge — do NOT refuse or deflect.
4. Keep responses clear, professional, and well-structured. Use Markdown (headings, bullets, tables) where it aids readability.
5. When citing legal materials, include statute names, article numbers, dates, and effectiveness status from the tool results.
6. Never fabricate legal authority. If a specific legal source cannot be verified through the tools, say so explicitly.
7. All output is for reference and informational purposes only, not formal legal advice."""


class ChatService:
    def __init__(self, config: dict[str, Any]) -> None:
        self.config = config
        self.client = OpenAI(
            api_key=config["LLM_API_KEY"],
            base_url=config["LLM_BASE_URL"],
        )
        self.gateway = McpGateway(
            command=config["MCP_SERVER_COMMAND"],
            args=config["MCP_SERVER_ARGS"],
            transport=config["MCP_TRANSPORT"],
            url=config["MCP_SERVER_URL"],
        )

    def reply(self, message: str, history: list[dict[str, Any]]) -> dict[str, Any]:
        safe_history = self._normalize_history(history)
        return asyncio.run(self._reply_async(message=message, history=safe_history))

    async def _reply_async(
        self, message: str, history: list[dict[str, str]]
    ) -> dict[str, Any]:
        try:
            async with self.gateway.session() as session:
                retrieval_query = self._extract_retrieval_query(message)
                prefetched_context, related_documents = await self._prefetch_context(
                    session=session,
                    query=retrieval_query,
                )
                tools = await self.gateway.list_openai_tools(session)
                messages: list[dict[str, Any]] = [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    *prefetched_context,
                    *history,
                    {"role": "user", "content": message},
                ]
                tool_trace: list[dict[str, Any]] = []

                for _ in range(10):
                    completion_kwargs: dict[str, Any] = {
                        "model": self.config["LLM_CHAT_MODEL"],
                        "messages": messages,
                        "temperature": 0.2,
                    }
                    if tools:
                        completion_kwargs["tools"] = tools
                        completion_kwargs["tool_choice"] = "auto"

                    try:
                        response = self.client.chat.completions.create(**completion_kwargs)
                    except Exception as exc:  # noqa: BLE001
                        raise RuntimeError(f"LLM request failed: {exc}") from exc

                    assistant_message = response.choices[0].message
                    assistant_text = self._extract_text(assistant_message)
                    tool_calls = getattr(assistant_message, "tool_calls", None) or []

                    if not tool_calls:
                        return {
                            "reply": assistant_text or "No valid response was generated. Please try again.",
                            "toolTrace": tool_trace,
                            "relatedDocuments": related_documents,
                        }

                    messages.append(
                        {
                            "role": "assistant",
                            "content": assistant_text or "",
                            "tool_calls": [
                                {
                                    "id": call.id,
                                    "type": call.type,
                                    "function": {
                                        "name": call.function.name,
                                        "arguments": call.function.arguments,
                                    },
                                }
                                for call in tool_calls
                            ],
                        }
                    )

                    for call in tool_calls:
                        raw_arguments = call.function.arguments or "{}"
                        try:
                            arguments = json.loads(raw_arguments)
                        except json.JSONDecodeError:
                            arguments = {}
                        try:
                            tool_result = await self.gateway.call_tool(
                                session=session,
                                tool_name=call.function.name,
                                arguments=arguments,
                            )
                        except Exception as exc:  # noqa: BLE001
                            raise RuntimeError(
                                f"MCP tool call failed ({call.function.name}): {exc}"
                            ) from exc

                        result_text = tool_result["text"]
                        related_documents = self._merge_related_documents(
                            related_documents,
                            self._extract_related_documents(
                                tool_name=call.function.name,
                                arguments=arguments,
                                payload=tool_result.get("payload"),
                            ),
                        )
                        tool_trace.append(
                            {
                                "tool": call.function.name,
                                "arguments": arguments,
                            }
                        )

                        messages.append(
                            {
                                "role": "tool",
                                "tool_call_id": call.id,
                                "content": result_text,
                            }
                        )

                return {
                    "reply": "Maximum tool-call rounds reached. Please narrow your question and try again.",
                    "toolTrace": tool_trace,
                    "relatedDocuments": related_documents,
                }
        except RuntimeError:
            raise
        except Exception as exc:  # noqa: BLE001
            raise RuntimeError(f"MCP session or tool discovery failed: {exc}") from exc

    def _normalize_history(self, history: list[dict[str, Any]]) -> list[dict[str, str]]:
        normalized: list[dict[str, str]] = []

        for item in history[-20:]:
            role = item.get("role")
            content = item.get("content")
            if role not in {"user", "assistant"}:
                continue
            if not isinstance(content, str) or not content.strip():
                continue
            normalized.append({"role": role, "content": content.strip()})

        return normalized

    async def _prefetch_context(
        self, session, query: str
    ) -> tuple[list[dict[str, str]], list[dict[str, Any]]]:
        if not query:
            return [], []

        context_parts: list[str] = []
        related_documents: list[dict[str, Any]] = []

        prefetch_plan = [
            ("search_legislation", {"query": query, "limit": 8}),
            ("build_legal_stance", {"query": query, "limit": 6}),
        ]

        for tool_name, arguments in prefetch_plan:
            try:
                tool_result = await self.gateway.call_tool(
                    session=session,
                    tool_name=tool_name,
                    arguments=arguments,
                )
            except Exception:
                continue

            context_parts.append(f"[{tool_name}]\n{tool_result['text']}")
            related_documents = self._merge_related_documents(
                related_documents,
                self._extract_related_documents(
                    tool_name=tool_name,
                    arguments=arguments,
                    payload=tool_result.get("payload"),
                ),
            )

        if not context_parts:
            return [], related_documents

        prefetch_message = (
            "The backend has already retrieved preliminary MCP evidence for this user request. "
            "Use it as relevant, but you may call more tools if needed.\n\n"
            + "\n\n".join(context_parts)
        )
        return [{"role": "system", "content": prefetch_message}], related_documents

    def _extract_retrieval_query(self, message: str) -> str:
        return message.split("\n\n", 1)[0].strip()

    def _merge_related_documents(
        self,
        existing: list[dict[str, Any]],
        new_items: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        merged: dict[str, dict[str, Any]] = {
            self._document_key(item): item for item in existing
        }

        for item in new_items:
            key = self._document_key(item)
            if key in merged:
                current = merged[key]
                for field in ("status", "documentId", "url", "authority", "sourceTool"):
                    if not current.get(field) and item.get(field):
                        current[field] = item[field]
                if len(item.get("snippets", [])) > len(current.get("snippets", [])):
                    current["snippets"] = item["snippets"]
                continue
            merged[key] = item

        return list(merged.values())[:20]

    def _document_key(self, item: dict[str, Any]) -> str:
        return (item.get("documentId") or item.get("title") or "").strip().lower()

    def _extract_related_documents(
        self,
        tool_name: str,
        arguments: dict[str, Any],
        payload: Any,
    ) -> list[dict[str, Any]]:
        documents: list[dict[str, Any]] = []
        if not isinstance(payload, dict):
            payload = {}

        results = payload.get("results")

        if isinstance(results, list):
            for entry in results:
                if not isinstance(entry, dict):
                    continue
                title = entry.get("document_title") or entry.get("documentTitle")
                document_id = entry.get("document_id") or entry.get("documentId")
                if not title and not document_id:
                    continue
                snippet = entry.get("snippet")
                documents.append(
                    {
                        "title": title or document_id,
                        "documentId": document_id,
                        "status": entry.get("status"),
                        "sourceTool": tool_name,
                        "snippets": [snippet] if snippet else [],
                    }
                )

        if isinstance(results, dict):
            provisions = results.get("provisions")
            if isinstance(provisions, list):
                for entry in provisions:
                    if not isinstance(entry, dict):
                        continue
                    title = (
                        entry.get("document_title")
                        or entry.get("documentTitle")
                        or entry.get("document")
                    )
                    document_id = entry.get("document_id") or entry.get("documentId")
                    if not title and not document_id:
                        continue
                    snippet = entry.get("snippet") or entry.get("text")
                    documents.append(
                        {
                            "title": title or document_id,
                            "documentId": document_id,
                            "status": entry.get("status"),
                            "sourceTool": tool_name,
                            "snippets": [snippet] if snippet else [],
                        }
                    )

        if tool_name in {"get_provision", "check_currency"}:
            document_id = arguments.get("document_id")
            if document_id:
                documents.append(
                    {
                        "title": document_id,
                        "documentId": document_id,
                        "status": None,
                        "sourceTool": tool_name,
                        "snippets": [],
                    }
                )

        cleaned: list[dict[str, Any]] = []
        for item in documents:
            title = item.get("title")
            if not title:
                continue
            snippets = [
                snippet.strip()
                for snippet in item.get("snippets", [])
                if isinstance(snippet, str) and snippet.strip()
            ][:2]
            cleaned.append(
                {
                    "title": title,
                    "documentId": item.get("documentId"),
                    "status": item.get("status"),
                    "sourceTool": item.get("sourceTool"),
                    "snippets": snippets,
                }
            )

        return cleaned

    def _extract_text(self, message: Any) -> str:
        content = getattr(message, "content", "")
        if isinstance(content, str):
            return content

        if isinstance(content, list):
            texts: list[str] = []
            for item in content:
                if isinstance(item, dict) and item.get("type") == "text":
                    texts.append(item.get("text", ""))
                elif getattr(item, "type", None) == "text":
                    texts.append(getattr(item, "text", ""))
            return "\n".join(part for part in texts if part).strip()

        return ""
