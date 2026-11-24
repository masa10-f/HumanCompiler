# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"""
How a note refers to its attached images.

A note never holds an image or its URL, only the attachment's id and caption:

* in note HTML (what the editor saves):
  ``<img data-attachment-id="<uuid>" alt="caption">``, with no ``src``;
* in Markdown (what agents read and write): ``![caption](attachment:<uuid>)``.

``note_markdown`` and ``note_markdown_out`` convert between the two. The web
resolves an id to a short-lived signed URL when it shows the note.
"""

import re
from html.parser import HTMLParser
from uuid import UUID

ATTACHMENT_ID_ATTRIBUTE = "data-attachment-id"
ATTACHMENT_SCHEME = "attachment:"
CAPTION_MAX_LENGTH = 500

_UUID = r"[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}"
_CANONICAL_UUID = re.compile(_UUID)
_ATTACHMENT_TARGET = re.compile(rf"^{ATTACHMENT_SCHEME}({_UUID})$")
# The alt may hold escaped brackets (``\]``), as ``attachment_markdown`` writes.
_MARKDOWN_IMAGE = re.compile(
    rf"!\[((?:\\.|[^\]\\])*)\]\({ATTACHMENT_SCHEME}({_UUID})\)"
)
_MARKDOWN_UNESCAPE = re.compile(r"\\([\\\[\]])")
_SPACES = re.compile(r"\s+")


def normalize_caption(caption: str) -> str:
    """A caption as one line: runs of whitespace become one space."""
    return _SPACES.sub(" ", caption).strip()[:CAPTION_MAX_LENGTH].rstrip()


def attachment_id_from_target(target: str) -> UUID | None:
    """The id in a Markdown image target ``attachment:<uuid>``, else None."""
    match = _ATTACHMENT_TARGET.match(target)
    return UUID(match.group(1)) if match is not None else None


def parse_attachment_id(value: str | None) -> UUID | None:
    """The id in a ``data-attachment-id`` attribute, or None if it is not one.

    Only the usual hyphenated form counts (in either case), as in a Markdown
    target: the cleanup looks for that text in notes, so an id written any
    other way that ``UUID()`` reads must not attach an image."""
    if not value or _CANONICAL_UUID.fullmatch(value) is None:
        return None
    return UUID(value)


def attachment_markdown(attachment_id: UUID, caption: str) -> str:
    """The Markdown reference to an attachment, to put in a note."""
    alt = normalize_caption(caption)
    for char in ("\\", "[", "]"):
        alt = alt.replace(char, f"\\{char}")
    return f"![{alt}]({ATTACHMENT_SCHEME}{attachment_id})"


class _ReferenceParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.references: dict[UUID, str] = {}

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag != "img":
            return
        attributes = dict(attrs)
        attachment_id = parse_attachment_id(attributes.get(ATTACHMENT_ID_ATTRIBUTE))
        if attachment_id is not None:
            self.references.setdefault(attachment_id, attributes.get("alt") or "")


def attachment_references(content: str, content_type: str) -> dict[UUID, str]:
    """The attachments a note refers to, each with the caption the note gives it.

    An attachment referred to twice keeps its first caption."""
    if content_type == "html":
        parser = _ReferenceParser()
        parser.feed(content)
        parser.close()
        return parser.references
    references: dict[UUID, str] = {}
    for match in _MARKDOWN_IMAGE.finditer(content):
        caption = _MARKDOWN_UNESCAPE.sub(r"\1", match.group(1))
        references.setdefault(UUID(match.group(2)), caption)
    return references
