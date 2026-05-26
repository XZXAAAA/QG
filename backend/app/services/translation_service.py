import logging
import re
from typing import Any

from deep_translator import GoogleTranslator


logger = logging.getLogger(__name__)


INLINE_CODE_RE = re.compile(r"(`+)([^`]+?)\1")
MARKDOWN_LINK_RE = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")
IMAGE_LINK_RE = re.compile(r"!\[([^\]]*)\]\(([^)]+)\)")
URL_RE = re.compile(r"https?://[^\s)]+")
CJK_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]")


class MarkdownTranslationService:
    def __init__(self, source: str = "auto", target: str = "en") -> None:
        self.translator = GoogleTranslator(source=source, target=target)

    def translate_markdown(self, text: str) -> str:
        if not text or not self._needs_translation(text):
            return text

        translated_lines: list[str] = []
        in_code_block = False

        for line in text.splitlines():
            stripped = line.strip()

            if stripped.startswith("```") or stripped.startswith("~~~"):
                in_code_block = not in_code_block
                translated_lines.append(line)
                continue

            if in_code_block or not stripped:
                translated_lines.append(line)
                continue

            if self._is_table_divider(stripped):
                translated_lines.append(line)
                continue

            translated_lines.append(self._translate_line(line))

        return "\n".join(translated_lines)

    def translate_text(self, text: Any) -> Any:
        if not isinstance(text, str) or not text.strip() or not self._needs_translation(text):
            return text

        try:
            return self.translator.translate(text)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Translation failed, returning original text: %s", exc)
            return text

    def _translate_line(self, line: str) -> str:
        indent_match = re.match(r"^\s*", line)
        indent = indent_match.group(0) if indent_match else ""
        content = line[len(indent) :]

        if content.count("|") >= 2:
            return indent + self._translate_table_row(content)

        prefix_match = re.match(r"^(#{1,6}\s+|>\s+|[-*+]\s+|\d+\.\s+|-\s+\[[ xX]\]\s+)", content)
        if prefix_match:
            prefix = prefix_match.group(0)
            body = content[len(prefix) :]
            return indent + prefix + self._translate_inline(body)

        return indent + self._translate_inline(content)

    def _translate_table_row(self, row: str) -> str:
        leading_pipe = row.startswith("|")
        trailing_pipe = row.endswith("|")
        parts = row.split("|")
        translated_parts: list[str] = []

        for index, part in enumerate(parts):
            if (index == 0 and leading_pipe) or (index == len(parts) - 1 and trailing_pipe):
                translated_parts.append(part)
                continue
            translated_parts.append(self._translate_inline(part))

        return "|".join(translated_parts)

    def _translate_inline(self, text: str) -> str:
        masked_text, placeholders = self._mask_special_tokens(text)
        if not self._needs_translation(masked_text):
            return self._restore_placeholders(masked_text, placeholders)

        try:
            translated = self.translator.translate(masked_text)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Inline translation failed, returning original text: %s", exc)
            translated = masked_text

        return self._restore_placeholders(translated, placeholders)

    def _mask_special_tokens(self, text: str) -> tuple[str, dict[str, str]]:
        placeholders: dict[str, str] = {}
        counter = 0

        def reserve(value: str) -> str:
            nonlocal counter
            token = f"__PH_{counter}__"
            placeholders[token] = value
            counter += 1
            return token

        def replace_image(match: re.Match[str]) -> str:
            return reserve(match.group(0))

        def replace_link(match: re.Match[str]) -> str:
            translated_label = self.translate_text(match.group(1))
            return reserve(f"[{translated_label}]({match.group(2)})")

        masked = IMAGE_LINK_RE.sub(replace_image, text)
        masked = MARKDOWN_LINK_RE.sub(replace_link, masked)
        masked = INLINE_CODE_RE.sub(lambda match: reserve(match.group(0)), masked)
        masked = URL_RE.sub(lambda match: reserve(match.group(0)), masked)

        return masked, placeholders

    def _restore_placeholders(self, text: str, placeholders: dict[str, str]) -> str:
        restored = text
        for key, value in placeholders.items():
            restored = restored.replace(key, value)
        return restored

    def _needs_translation(self, text: str) -> bool:
        return bool(CJK_RE.search(text))

    def _is_table_divider(self, stripped: str) -> bool:
        return bool(stripped) and set(stripped) <= {"|", "-", ":", " "}
