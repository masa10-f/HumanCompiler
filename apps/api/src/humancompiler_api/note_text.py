# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"""
The visible text of a note, and plain text turned into note HTML.

A task's note is its body: there is no separate description or memo. Lists
show the opening of the note (``note_excerpt``) and search matches its visible
text, which is stored in ``context_notes.content_text`` and rebuilt on every
write by ``note_plain_text``.

Migration 044 rebuilt ``content_text`` for the notes of its time and copied
task descriptions and memos into notes in SQL, by the rules
``note_plain_text`` and ``plain_text_to_note_html`` had then. Attached images
came later (migration 046): their captions are text here and not in 044's SQL,
which no note of that time needed.
"""

import html
import re

# Where a block ends, so its text does not run into the next block's.
_BLOCK_END = re.compile(
    r"<br\s*/?>|</(?:p|h[1-6]|li|tr|pre|blockquote|div|table|ul|ol)\s*>",
    re.IGNORECASE,
)
_CELL_END = re.compile(r"</(?:td|th)\s*>", re.IGNORECASE)
_TAG = re.compile(r"<[^>]*>")
# An <img>, whose quoted attribute values may hold ">".
_IMAGE = re.compile(r'<img\b(?:[^>"]|"[^"]*")*>', re.IGNORECASE)
_IMAGE_ALT = re.compile(r'(?<![\w-])alt="([^"]*)"', re.IGNORECASE)
_SPACES = re.compile(r"[ \t\r 　]+")
# The heading ``note_markdown.agent_append_heading`` puts before agent text.
_AGENT_HEADING = re.compile(r"^エージェントからの追記（.*）$")

NOTE_EXCERPT_LENGTH = 200
# Characters of ``content_text`` loaded with a task to build its excerpt.
NOTE_TEXT_HEAD_LENGTH = 400


def _image_caption(match: re.Match[str]) -> str:
    alt = _IMAGE_ALT.search(match.group(0))
    return f"\n{alt.group(1)}\n" if alt is not None else ""


def note_plain_text(content: str, content_type: str) -> str:
    """The text a reader sees in a note, one block per line, no blank lines.

    Only an HTML note has tags to strip; in a markdown note (the column's
    default, so legacy notes may be one) ``<TODO>`` is the user's text. An
    image is its caption (the alt text), on a line of its own, so search finds
    a figure by what it shows."""
    text = content
    if content_type == "html":
        text = _IMAGE.sub(_image_caption, text)
        text = _BLOCK_END.sub("\n", text)
        text = _CELL_END.sub(" ", text)
        text = html.unescape(_TAG.sub("", text))
    lines = (_SPACES.sub(" ", line).strip() for line in text.split("\n"))
    return "\n".join(line for line in lines if line)


def note_excerpt(text: str | None) -> str | None:
    """The opening of a note as one line, or None for a note without text.

    Headings that mark agent-appended text are skipped: they say who wrote the
    note, not what the task is."""
    if not text:
        return None
    lines = [line for line in text.split("\n") if not _AGENT_HEADING.match(line)]
    joined = " ".join(line for line in lines if line)
    if not joined:
        return None
    if len(joined) <= NOTE_EXCERPT_LENGTH:
        return joined
    return joined[: NOTE_EXCERPT_LENGTH - 1].rstrip() + "…"


def plain_text_to_note_html(text: str) -> str:
    """Plain text as note HTML: one paragraph per non-empty line, escaped."""
    lines = (line.strip() for line in text.split("\n"))
    return "".join(f"<p>{html.escape(line, quote=False)}</p>" for line in lines if line)


# The bold line migration 044 puts above a memo it copies into a note.
MEMO_HEADING_HTML = "<p><strong>メモ</strong></p>"


def former_task_text_html(description: str | None, memo: str | None) -> str:
    """A task's former description and memo as note HTML, as migration 044 writes it.

    The description comes first, then the memo under ``MEMO_HEADING_HTML``;
    empty when neither has text."""
    block = plain_text_to_note_html(description or "")
    memo_html = plain_text_to_note_html(memo or "")
    if memo_html:
        block += MEMO_HEADING_HTML + memo_html
    return block
