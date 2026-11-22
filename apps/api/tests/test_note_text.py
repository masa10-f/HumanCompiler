# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"""Visible text of notes, list excerpts, and plain text as note HTML."""

from datetime import date

import pytest

from humancompiler_api.note_markdown import agent_append_heading, markdown_to_note_html
from humancompiler_api.note_text import (
    NOTE_EXCERPT_LENGTH,
    note_excerpt,
    note_plain_text,
    plain_text_to_note_html,
)


def test_plain_text_puts_each_block_on_its_own_line():
    content = (
        "<h2>背景</h2><p>API を <strong>先に</strong>作る</p>"
        "<ul><li><p>one</p></li><li><p>two</p></li></ul>"
        "<p>a<br>b</p><p></p>"
    )

    assert note_plain_text(content, "html") == "背景\nAPI を 先に作る\none\ntwo\na\nb"


def test_plain_text_decodes_entities_and_collapses_spaces():
    content = "<p>a &amp; b &lt;c&gt;&nbsp;&nbsp;d　e</p>"

    assert note_plain_text(content, "html") == "a & b <c> d e"


def test_plain_text_keeps_table_cells_apart_and_checklist_text():
    content = (
        "<table><tbody><tr><th>k</th><th>v</th></tr>"
        "<tr><td>x</td><td>1</td></tr></tbody></table>"
        '<ul data-type="taskList"><li data-type="taskItem" data-checked="true">'
        '<label><input type="checkbox" checked="checked"><span></span></label>'
        "<div><p>done</p></div></li></ul>"
    )

    assert note_plain_text(content, "html") == "k v\nx 1\ndone"


def test_plain_text_of_a_markdown_note_keeps_angle_brackets():
    assert note_plain_text("  <TODO> write\n\n next  ", "markdown") == (
        "<TODO> write\nnext"
    )


@pytest.mark.parametrize("content", ["", "<p></p>", "<p>&nbsp;</p>", "  \n "])
def test_blank_notes_have_no_text_and_no_excerpt(content: str):
    text = note_plain_text(content, "html")

    assert text == ""
    assert note_excerpt(text) is None


def test_excerpt_joins_the_opening_lines():
    assert note_excerpt("背景\nAPI を先に作る") == "背景 API を先に作る"
    assert note_excerpt(None) is None


def test_excerpt_skips_agent_headings():
    html = agent_append_heading("Distiller", date(2026, 11, 6)) + (
        markdown_to_note_html("## Do\n\nIt.")
    )

    assert note_excerpt(note_plain_text(html, "html")) == "Do It."


def test_excerpt_of_only_an_agent_heading_is_none():
    html = agent_append_heading("Distiller", date(2026, 11, 6))

    assert note_excerpt(note_plain_text(html, "html")) is None


def test_long_excerpt_is_cut_with_an_ellipsis():
    excerpt = note_excerpt("x" * 500)

    assert excerpt is not None
    assert len(excerpt) == NOTE_EXCERPT_LENGTH
    assert excerpt.endswith("…")


def test_plain_text_becomes_escaped_paragraphs():
    html = plain_text_to_note_html(" Use <b> & </b>\n\n  second line \n")

    assert html == "<p>Use &lt;b&gt; &amp; &lt;/b&gt;</p><p>second line</p>"
    assert note_plain_text(html, "html") == "Use <b> & </b>\nsecond line"


def test_blank_plain_text_becomes_no_html():
    assert plain_text_to_note_html(" \n\n ") == ""
