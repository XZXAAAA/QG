import json
import os
import logging
from contextlib import asynccontextmanager

from mcp import ClientSession
from mcp.client.stdio import StdioServerParameters, stdio_client
from mcp.client.streamable_http import streamable_http_client


logger = logging.getLogger(__name__)


class McpGateway:
    def __init__(
        self,
        command: str,
        args: list[str],
        transport: str = "auto",
        url: str | None = None,
    ) -> None:
        self.command = self._resolve_command(command)
        self.args = args
        self.transport = transport
        self.url = url

    @asynccontextmanager
    async def session(self):
        if self.transport == "streamable_http":
            async with self._streamable_http_session() as session:
                yield session
            return

        if self.transport == "stdio":
            async with self._stdio_session() as session:
                yield session
            return

        stdio_exc: Exception | None = None
        try:
            stdio_session = self._stdio_session()
            session = await stdio_session.__aenter__()
        except Exception as exc:  # noqa: BLE001
            stdio_exc = exc
            stdio_session = None
        else:
            try:
                yield session
            finally:
                await stdio_session.__aexit__(None, None, None)
            return

        if not self.url:
            raise RuntimeError(
                f"Local MCP startup failed and MCP_SERVER_URL is not configured: {stdio_exc}"
            ) from stdio_exc

        logger.warning(
            "Local MCP stdio startup failed, falling back to remote MCP URL %s: %s",
            self.url,
            stdio_exc,
        )

        try:
            http_session = self._streamable_http_session()
            session = await http_session.__aenter__()
        except Exception as http_exc:  # noqa: BLE001
            raise RuntimeError(
                "Both local MCP and remote MCP connections failed. "
                f"Local error: {stdio_exc}; Remote error: {http_exc}"
            ) from http_exc
        else:
            try:
                yield session
            finally:
                await http_session.__aexit__(None, None, None)
            return

    @asynccontextmanager
    async def _stdio_session(self):
        server_params = StdioServerParameters(command=self.command, args=self.args)
        async with stdio_client(server_params) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                yield session

    @asynccontextmanager
    async def _streamable_http_session(self):
        if not self.url:
            raise RuntimeError("MCP_SERVER_URL is not configured")
        async with streamable_http_client(self.url) as (read, write, _):
            async with ClientSession(read, write) as session:
                await session.initialize()
                yield session

    async def list_openai_tools(self, session: ClientSession) -> list[dict]:
        result = await session.list_tools()
        openai_tools: list[dict] = []

        for tool in result.tools:
            schema = getattr(tool, "inputSchema", None) or getattr(
                tool, "input_schema", None
            )

            openai_tools.append(
                {
                    "type": "function",
                    "function": {
                        "name": tool.name,
                        "description": tool.description or "",
                        "parameters": schema
                        or {
                            "type": "object",
                            "properties": {},
                        },
                    },
                }
            )

        return openai_tools

    async def call_tool(
        self, session: ClientSession, tool_name: str, arguments: dict
    ) -> dict:
        result = await session.call_tool(tool_name, arguments)
        return self._tool_result_to_payload(result)

    def _resolve_command(self, command: str) -> str:
        if os.name == "nt" and command.lower() == "npx":
            return "npx.cmd"
        return command

    def _tool_result_to_payload(self, result) -> dict:
        parts: list[str] = []
        parsed_payload = None

        structured_content = getattr(result, "structuredContent", None) or getattr(
            result, "structured_content", None
        )
        if structured_content:
            parsed_payload = structured_content
            parts.append(
                json.dumps(structured_content, ensure_ascii=False, indent=2)
            )

        for item in getattr(result, "content", []) or []:
            if getattr(item, "text", None):
                text = item.text
                if parsed_payload is None:
                    try:
                        parsed_payload = json.loads(text)
                    except Exception:  # noqa: BLE001
                        parsed_payload = None
                parts.append(text)
                continue

            if hasattr(item, "model_dump"):
                dumped = item.model_dump()
                if parsed_payload is None:
                    parsed_payload = dumped
                parts.append(json.dumps(dumped, ensure_ascii=False, indent=2))
                continue

            parts.append(str(item))

        is_error = getattr(result, "isError", False) or getattr(result, "is_error", False)
        text = "\n\n".join(parts) if parts else "Tool returned an empty result."
        if is_error and parts:
            text = "Tool call returned an error:\n" + "\n\n".join(parts)

        return {
            "text": text,
            "payload": parsed_payload,
            "is_error": is_error,
        }
