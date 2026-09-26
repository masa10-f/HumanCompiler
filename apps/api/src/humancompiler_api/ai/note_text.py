# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com
"""Plain-text extraction for context notes used as AI prompt context."""

import re
from html.parser import HTMLParser

_HTML_START_PATTERN = re.compile(
    r"^\s*<(p|h[1-6]|ul|ol|li|div|pre|blockquote|table)\b", re.IGNORECASE
)
_BLOCK_TAGS = {
    "p",
    "div",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "blockquote",
    "pre",
    "tr",
    "hr",
}
_LIST_TAGS = {"ul", "ol"}
_SKIPPED_TAGS = {"script", "style"}


class _NoteHTMLTextExtractor(HTMLParser):
    """Convert TipTap editor HTML into compact, markdown-like plain text.

    Lists keep their bullets and nesting, and task list items keep their
    checked state (``[x]`` / ``[ ]``) so unfinished TODOs stay visible.
    """

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._lines: list[str] = []
        self._buffer: list[str] = []
        self._prefix = ""
        self._list_depth = 0
        self._pre_depth = 0
        self._skip_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in _SKIPPED_TAGS:
            self._skip_depth += 1
            return
        if tag in _LIST_TAGS:
            self._flush()
            self._list_depth += 1
            return
        if tag == "li":
            self._flush()
            attributes = dict(attrs)
            indent = "  " * max(self._list_depth - 1, 0)
            if attributes.get("data-type") == "taskItem":
                mark = "[x]" if attributes.get("data-checked") == "true" else "[ ]"
                self._prefix = f"{indent}- {mark} "
            else:
                self._prefix = f"{indent}- "
            return
        if tag == "br":
            self._flush()
            return
        if tag in _BLOCK_TAGS:
            self._flush()
        if tag == "pre":
            self._pre_depth += 1
        if tag in {"h1", "h2", "h3", "h4", "h5", "h6"}:
            self._prefix = "#" * int(tag[1]) + " "

    def handle_endtag(self, tag: str) -> None:
        if tag in _SKIPPED_TAGS:
            self._skip_depth = max(self._skip_depth - 1, 0)
            return
        if tag in _LIST_TAGS:
            self._flush()
            self._list_depth = max(self._list_depth - 1, 0)
            self._prefix = ""
            return
        if tag == "li":
            self._flush()
            self._prefix = ""
            return
        if tag == "pre":
            self._flush()
            self._pre_depth = max(self._pre_depth - 1, 0)
            return
        if tag in _BLOCK_TAGS:
            self._flush()

    def handle_data(self, data: str) -> None:
        if self._skip_depth:
            return
        self._buffer.append(data)

    def _flush(self) -> None:
        raw_text = "".join(self._buffer)
        self._buffer = []
        if self._pre_depth:
            text = raw_text.strip("\n")
        else:
            text = " ".join(raw_text.split())
        if not text:
            return
        self._lines.append(f"{self._prefix}{text}")
        self._prefix = ""

    def get_text(self) -> str:
        self.close()
        self._flush()
        return "\n".join(self._lines)


def note_to_plain_text(content: str | None, content_type: str | None = None) -> str:
    """Return note content as plain text suitable for an AI prompt.

    Notes written in the web editor are stored as HTML. Markdown or plain text
    content is returned as-is (trimmed).
    """
    if not content or not content.strip():
        return ""
    if content_type == "html" or _HTML_START_PATTERN.match(content):
        extractor = _NoteHTMLTextExtractor()
        extractor.feed(content)
        return extractor.get_text().strip()
    return content.strip()


def truncate_text(text: str, limit: int) -> str:
    """Truncate text to ``limit`` characters, marking the cut."""
    if len(text) <= limit:
        return text
    return text[:limit].rstrip() + "…（以下省略）"
