# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"""
Convert agent-written Markdown into HTML that is safe for the TipTap note editor.

The web note editor loads every note as HTML, so agent Markdown is rendered
here. Raw HTML is escaped, images are disabled and headings are limited to h1-h3
(the levels the editor supports).
"""

import html
from datetime import date

from markdown_it import MarkdownIt
from markdown_it.renderer import RendererHTML
from markdown_it.token import Token
from markdown_it.utils import OptionsDict

_MAX_HEADING_LEVEL = 3


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


def _build_parser() -> MarkdownIt:
    # Link validation is left at its default: javascript:, vbscript:, file: and
    # non-image data: URLs are rejected.
    md = MarkdownIt("commonmark", {"html": False})
    md.disable("image")
    md.add_render_rule("heading_open", _clamp_heading)
    md.add_render_rule("heading_close", _clamp_heading)
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
