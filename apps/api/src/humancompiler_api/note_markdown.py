# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"""
Convert agent-written Markdown into HTML that is safe for the TipTap note editor.

The web note editor loads every note as HTML, so agent Markdown is rendered
here. Raw HTML is escaped and headings are limited to h1-h3 (the levels the
editor supports).

The only image is an attachment of the note's owner,
``![caption](attachment:<uuid>)``, which becomes
``<img data-attachment-id="<uuid>" alt="caption">``: the editor shows it
through a signed URL it asks the API for (see ``note_attachment_refs``). An
image with any other target is never loaded; it stays readable as ``!`` and a
link, as it did when images were disabled altogether. A paragraph that holds
only attachments becomes the images alone, the block form the editor saves.

A bullet list whose items all start with ``[ ]``, ``[x]`` or ``[X]`` becomes a
checklist in the markup TipTap's TaskList and TaskItem parse:
``<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>..``.
If any item has no marker, the whole list stays a plain list with the markers
as text, so a list is never half checklist. Ordered lists are never checklists.

GitHub-style pipe tables become ``<table>`` markup, which TipTap's table
extension loads. Without it a table would be one paragraph of pipes, because
the editor folds the line breaks inside a paragraph into spaces.
"""

import html
import re
from dataclasses import dataclass
from datetime import date

from markdown_it import MarkdownIt
from markdown_it.renderer import RendererHTML
from markdown_it.rules_core import StateCore
from markdown_it.token import Token
from markdown_it.utils import OptionsDict

from humancompiler_api.note_attachment_refs import (
    ATTACHMENT_ID_ATTRIBUTE,
    attachment_id_from_target,
    normalize_caption,
)

_MAX_HEADING_LEVEL = 3
# "[ ]", "[x]" or "[X]" at the start of an item, then a space or nothing.
_TASK_MARKER = re.compile(r"^\[([ xX])\](?: +|$)")


def _clamp_heading(
    self: RendererHTML,
    tokens: list[Token],
    idx: int,
    options: OptionsDict,
    env: dict,
) -> str:
    token = tokens[idx]
    level = int(token.tag[1:])
    if level > _MAX_HEADING_LEVEL:
        token.tag = f"h{_MAX_HEADING_LEVEL}"
    return self.renderToken(tokens, idx, options, env)


def _close_index(tokens: list[Token], open_index: int) -> int:
    """Index of the token that closes the block opened at ``open_index``."""
    opening = tokens[open_index]
    close_type = opening.type.replace("_open", "_close")
    for index in range(open_index + 1, len(tokens)):
        token = tokens[index]
        if token.type == close_type and token.level == opening.level:
            return index
    raise ValueError(f"{opening.type} at {open_index} is not closed")


@dataclass(frozen=True)
class _TaskMarker:
    checked: bool
    inline_index: int
    length: int


def _task_marker(tokens: list[Token], item_index: int) -> _TaskMarker | None:
    """The marker the item's first paragraph starts with, if it has one."""
    if item_index + 2 >= len(tokens):
        return None
    paragraph, inline = tokens[item_index + 1], tokens[item_index + 2]
    if paragraph.type != "paragraph_open" or inline.type != "inline":
        return None
    match = _TASK_MARKER.match(inline.content)
    children = inline.children or []
    if match is None or not children or children[0].type != "text":
        return None
    if not children[0].content.startswith(match.group(0)):
        return None
    return _TaskMarker(match.group(1) != " ", item_index + 2, match.end())


def _mark_task_list(tokens: list[Token], list_index: int) -> None:
    """Turn the bullet list at ``list_index`` into a TipTap task list, if it is one."""
    list_open = tokens[list_index]
    list_close = _close_index(tokens, list_index)
    items = [
        index
        for index in range(list_index + 1, list_close)
        if tokens[index].type == "list_item_open"
        and tokens[index].level == list_open.level + 1
    ]
    markers = [_task_marker(tokens, index) for index in items]
    found = [marker for marker in markers if marker is not None]
    if not items or len(found) != len(items):
        return
    list_open.attrSet("data-type", "taskList")
    for item_index, marker in zip(items, found, strict=True):
        tokens[item_index].attrSet("data-type", "taskItem")
        tokens[item_index].attrSet("data-checked", str(marker.checked).lower())
        inline = tokens[marker.inline_index]
        inline.content = inline.content[marker.length :]
        children = inline.children or []
        children[0].content = children[0].content[marker.length :]
        if not children[0].content:
            children.pop(0)
        # TaskItem's content starts with a paragraph: show the <p> even in a
        # tight list.
        tokens[marker.inline_index - 1].hidden = False
        tokens[marker.inline_index + 1].hidden = False


def _task_lists(state: StateCore) -> None:
    for index, token in enumerate(state.tokens):
        if token.type == "bullet_list_open":
            _mark_task_list(state.tokens, index)


def _alt_text(children: list[Token]) -> str:
    """The text of an image's alt, without its markup.

    ``renderInlineAsText`` drops escaped characters (``\\[``), which are
    ``text_special`` tokens inside an image."""
    parts: list[str] = []
    for child in children:
        if child.type in ("softbreak", "hardbreak"):
            parts.append(" ")
        elif child.children:
            parts.append(_alt_text(child.children))
        else:
            parts.append(child.content)
    return "".join(parts)


def _render_image(
    self: RendererHTML,
    tokens: list[Token],
    idx: int,
    options: OptionsDict,
    env: dict,
) -> str:
    token = tokens[idx]
    target = str(token.attrGet("src") or "")
    alt = _alt_text(token.children or [])
    attachment_id = attachment_id_from_target(target)
    if attachment_id is None:
        # Not loaded: an image from another host would tell that host when the
        # note is opened.
        href = html.escape(target, quote=True)
        return f'!<a href="{href}">{html.escape(alt, quote=False)}</a>'
    caption = html.escape(normalize_caption(alt), quote=True)
    return f'<img {ATTACHMENT_ID_ATTRIBUTE}="{attachment_id}" alt="{caption}">'


def _is_attachment(token: Token) -> bool:
    target = str(token.attrGet("src") or "")
    return token.type == "image" and attachment_id_from_target(target) is not None


def _attachment_blocks(state: StateCore) -> None:
    """Show a paragraph that holds only attachments as the images alone.

    The editor's image is a block, so ``<p><img></p>`` would load as an image
    next to an empty paragraph."""
    tokens = state.tokens
    for index, token in enumerate(tokens):
        if token.type != "inline" or index == 0 or index + 1 >= len(tokens):
            continue
        if tokens[index - 1].type != "paragraph_open":
            continue
        children = [
            child
            for child in token.children or []
            if child.type not in ("softbreak", "hardbreak")
            and not (child.type == "text" and not child.content.strip())
        ]
        if children and all(_is_attachment(child) for child in children):
            token.children = children
            tokens[index - 1].hidden = True
            tokens[index + 1].hidden = True


def _build_parser() -> MarkdownIt:
    # Link validation is left at its default: javascript:, vbscript:, file: and
    # non-image data: URLs are rejected.
    md = MarkdownIt("commonmark", {"html": False})
    md.enable("table")
    md.add_render_rule("heading_open", _clamp_heading)
    md.add_render_rule("heading_close", _clamp_heading)
    md.add_render_rule("image", _render_image)
    md.core.ruler.push("task_lists", _task_lists)
    md.core.ruler.push("attachment_blocks", _attachment_blocks)
    return md


_MD = _build_parser()


def markdown_to_note_html(markdown: str) -> str:
    """Render agent Markdown as HTML for the note editor."""
    return _MD.render(markdown)


def agent_append_heading(agent_name: str, on: date) -> str:
    """Heading block placed before text an agent appended to a note."""
    return (
        f"<p><strong>エージェントからの追記（{on.isoformat()}、"
        f"{html.escape(agent_name)}）</strong></p>"
    )


def append_html(existing: str, block: str) -> str:
    """Append a block to existing note HTML (an empty note becomes the block)."""
    if not existing.strip():
        return block
    return existing + block
