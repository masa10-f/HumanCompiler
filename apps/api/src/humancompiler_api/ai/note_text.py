# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com
"""Plain-text extraction for context notes used as AI prompt context."""

import re
from collections.abc import Sequence
from html.parser import HTMLParser
from uuid import UUID

from sqlalchemy import ColumnElement
from sqlmodel import Session, and_, col, func, or_, select

from humancompiler_api.models import ContextNote, NoteSection
from humancompiler_api.note_attachment_refs import (
    ATTACHMENT_ID_ATTRIBUTE,
    attachment_markdown,
    parse_attachment_id,
)

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
_BACKTICK_RUN = re.compile(r"`+")


def _code_fence_for(code: str) -> str:
    """Return a backtick fence longer than any backtick run inside ``code``."""
    longest = max((len(run) for run in _BACKTICK_RUN.findall(code)), default=0)
    return "`" * max(3, longest + 1)


class _NoteHTMLTextExtractor(HTMLParser):
    """Convert TipTap editor HTML into compact, markdown-like plain text.

    Lists keep their bullets and nesting, and task list items keep their
    checked state (``[x]`` / ``[ ]``) so unfinished TODOs stay visible. An
    attached image is its reference, ``![caption](attachment:<id>)``, on a line
    of its own: the caption and the id, never the image.
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
        if tag == "img":
            attributes = dict(attrs)
            attachment_id = parse_attachment_id(attributes.get(ATTACHMENT_ID_ATTRIBUTE))
            if attachment_id is not None and not self._skip_depth:
                self._flush()
                reference = attachment_markdown(
                    attachment_id, attributes.get("alt") or ""
                )
                self._lines.append(f"{self._prefix}{reference}")
                self._prefix = ""
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
        if self._pre_depth:
            # Keep code blocks fenced so their lines (e.g. "# comment") are
            # not mistaken for Markdown headings or list items.
            fence = _code_fence_for(text)
            self._lines.extend([fence, text, fence])
        else:
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


def _notes_of(
    owner_id: UUID,
    section: NoteSection,
    project_ids: Sequence[UUID],
    goal_ids: Sequence[UUID],
    task_ids: Sequence[UUID],
) -> ColumnElement[bool] | None:
    """The owner's notes of ``section`` on the given items; None for no items."""
    conditions = []
    if project_ids:
        conditions.append(col(ContextNote.project_id).in_(project_ids))
    if goal_ids:
        conditions.append(col(ContextNote.goal_id).in_(goal_ids))
    if task_ids:
        conditions.append(col(ContextNote.task_id).in_(task_ids))
    if not conditions:
        return None
    return and_(
        ContextNote.user_id == owner_id,
        ContextNote.section == section.value,
        or_(*conditions),
    )


def load_note_text_lengths(
    session: Session,
    owner_id: UUID,
    *,
    project_ids: Sequence[UUID] = (),
    goal_ids: Sequence[UUID] = (),
    task_ids: Sequence[UUID] = (),
    section: NoteSection = NoteSection.OVERVIEW,
) -> tuple[dict[UUID, int], dict[UUID, int], dict[UUID, int]]:
    """How many characters of visible text each note has, without loading it.

    For saying that a long note is there. Notes without text are left out.
    Returns ``(project_notes, goal_notes, task_notes)`` keyed by entity ID.
    """
    where = _notes_of(owner_id, section, project_ids, goal_ids, task_ids)
    if where is None:
        return {}, {}, {}

    rows = session.exec(
        select(
            ContextNote.project_id,
            ContextNote.goal_id,
            ContextNote.task_id,
            func.length(ContextNote.content_text),
        ).where(where, col(ContextNote.content_text) != "")
    ).all()

    project_notes: dict[UUID, int] = {}
    goal_notes: dict[UUID, int] = {}
    task_notes: dict[UUID, int] = {}
    for project_id, goal_id, task_id, length in rows:
        if project_id:
            project_notes[project_id] = length
        elif goal_id:
            goal_notes[goal_id] = length
        elif task_id:
            task_notes[task_id] = length
    return project_notes, goal_notes, task_notes


def load_note_texts(
    session: Session,
    owner_id: UUID,
    *,
    project_ids: Sequence[UUID] = (),
    goal_ids: Sequence[UUID] = (),
    task_ids: Sequence[UUID] = (),
    section: NoteSection = NoteSection.OVERVIEW,
) -> tuple[dict[UUID, str], dict[UUID, str], dict[UUID, str]]:
    """Load non-empty note texts for projects, goals, and tasks in one query.

    The overviews unless ``section`` asks for the logs. Returns
    ``(project_notes, goal_notes, task_notes)`` keyed by entity ID.
    """
    where = _notes_of(owner_id, section, project_ids, goal_ids, task_ids)
    if where is None:
        return {}, {}, {}

    notes = session.exec(select(ContextNote).where(where)).all()

    project_notes: dict[UUID, str] = {}
    goal_notes: dict[UUID, str] = {}
    task_notes: dict[UUID, str] = {}
    for note in notes:
        text = note_to_plain_text(note.content, note.content_type)
        if not text:
            continue
        if note.project_id:
            project_notes[note.project_id] = text
        elif note.goal_id:
            goal_notes[note.goal_id] = text
        elif note.task_id:
            task_notes[note.task_id] = text
    return project_notes, goal_notes, task_notes
