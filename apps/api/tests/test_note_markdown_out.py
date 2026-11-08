# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"""Tests for converting note HTML (TipTap output) to Markdown for agents."""

import pytest

from humancompiler_api.note_markdown import markdown_to_note_html
from humancompiler_api.note_markdown_out import note_html_to_markdown


def test_task_list_round_trip() -> None:
    html = markdown_to_note_html("- [ ] a\n- [x] b")

    markdown = note_html_to_markdown(html)

    assert "- [ ] a" in markdown
    assert "- [x] b" in markdown
    # Feeding the output back reproduces the same checklist state.
    assert markdown_to_note_html(markdown) == html


def test_nested_task_list_round_trip() -> None:
    html = markdown_to_note_html("- [ ] parent\n  - [x] child\n- [x] other")

    markdown = note_html_to_markdown(html)

    assert markdown == "- [ ] parent\n  - [x] child\n- [x] other"
    assert markdown_to_note_html(markdown) == html


def test_common_blocks() -> None:
    html = (
        "<h1>Title</h1><h2>Sub</h2>"
        "<p>Some <strong>bold</strong>, <em>italic</em> and <code>code</code>.</p>"
        "<ul><li><p>one</p><ul><li><p>nested</p></li></ul></li><li><p>two</p></li></ul>"
        "<ol><li><p>first</p></li><li><p>second</p></li></ol>"
        '<pre><code class="language-python">print("hi")\n</code></pre>'
        '<p><a href="https://example.com/x">link</a></p>'
        "<blockquote><p>quoted</p></blockquote>"
        "<hr>"
    )

    markdown = note_html_to_markdown(html)

    assert "# Title" in markdown
    assert "## Sub" in markdown
    assert "**bold**" in markdown
    assert "*italic*" in markdown
    assert "`code`" in markdown
    assert "- one\n  - nested\n- two" in markdown
    assert "1. first\n2. second" in markdown
    assert '```python\nprint("hi")\n```' in markdown
    assert "[link](https://example.com/x)" in markdown
    assert "> quoted" in markdown
    assert "---" in markdown


def test_image_and_unknown_tags() -> None:
    html = (
        '<p><img src="https://example.com/a.png" alt="alt text"></p>'
        "<custom-box>kept text</custom-box>"
        "<p>a <span>inline span</span> b</p>"
    )

    markdown = note_html_to_markdown(html)

    assert "![alt text](https://example.com/a.png)" in markdown
    assert "kept text" in markdown
    assert "a inline span b" in markdown


def test_script_and_style_content_is_dropped() -> None:
    markdown = note_html_to_markdown(
        "<p>hi</p><script>alert(1)</script><style>p{}</style>"
    )

    assert markdown == "hi"


@pytest.mark.parametrize("html", ["", "   ", "<p></p>", "<p><br></p>", "\n<p> </p>\n"])
def test_blank(html: str) -> None:
    assert note_html_to_markdown(html) == ""


def test_real_editor_html() -> None:
    # What the web editor (TipTap StarterKit + Link + TaskList/TaskItem +
    # CodeBlockLowlight, see context-note-extensions.ts) saves: task items carry
    # a checkbox label and wrap their content in a div, links get target/rel
    # attributes, and code blocks get a language class.
    html = (
        "<h2>今週の進め方</h2>"
        "<p>方針は<strong>小さく出す</strong>こと。詳細は"
        '<a target="_blank" rel="noopener noreferrer nofollow" '
        'class="text-blue-600 underline" href="https://example.com/spec">仕様</a>'
        "を参照。<br>次の行。</p>"
        '<ul data-type="taskList">'
        '<li data-checked="true" data-type="taskItem">'
        '<label><input type="checkbox" checked="checked"><span></span></label>'
        "<div><p>設計をレビューする</p></div></li>"
        '<li data-checked="false" data-type="taskItem">'
        '<label><input type="checkbox"><span></span></label>'
        "<div><p>実装する</p>"
        '<ul data-type="taskList">'
        '<li data-checked="true" data-type="taskItem">'
        '<label><input type="checkbox" checked="checked"><span></span></label>'
        "<div><p>テストを書く</p></div></li>"
        "</ul></div></li>"
        "</ul>"
        '<pre><code class="language-typescript">const x: number = 1;\n'
        "console.log(x);</code></pre>"
        "<p></p>"
    )

    assert note_html_to_markdown(html) == (
        "## 今週の進め方\n"
        "\n"
        "方針は**小さく出す**こと。詳細は[仕様](https://example.com/spec)を参照。  \n"
        "次の行。\n"
        "\n"
        "- [x] 設計をレビューする\n"
        "- [ ] 実装する\n"
        "  - [x] テストを書く\n"
        "\n"
        "```typescript\n"
        "const x: number = 1;\n"
        "console.log(x);\n"
        "```"
    )


def test_empty_task_item_is_kept() -> None:
    html = markdown_to_note_html("- [ ] a\n- [ ]\n- [x] c")

    markdown = note_html_to_markdown(html)

    assert markdown == "- [ ] a\n- [ ]\n- [x] c"
    assert markdown_to_note_html(markdown) == html


def test_code_block_containing_fence_gets_longer_fence() -> None:
    html = "<pre><code>a\n```\nb</code></pre>"

    assert note_html_to_markdown(html) == "````\na\n```\nb\n````"


def test_plain_list_item_with_two_paragraphs_keeps_them_apart() -> None:
    html = "<ul><li><p>one</p><p>more</p></li></ul>"

    assert note_html_to_markdown(html) == "- one\n\n  more"


def test_table_round_trips() -> None:
    markdown = "| タスク | 割当 |\n| --- | --- |\n| A \\| B | 6h |\n| `x` | 4h |"
    html = markdown_to_note_html(markdown)

    assert note_html_to_markdown(html) == markdown
    assert markdown_to_note_html(note_html_to_markdown(html)) == html


def test_editor_table_markup_becomes_pipe_table() -> None:
    # The markup the TipTap table extension saves: a scroll wrapper, header
    # cells in the first body row and every cell's text in a paragraph.
    html = (
        '<div class="tableWrapper"><table style="min-width: 50px;"><colgroup>'
        '<col style="min-width: 25px;"><col style="min-width: 25px;"></colgroup>'
        "<tbody><tr><th><p>タスク</p></th><th><p>割当</p></th></tr>"
        "<tr><td><p>a | b</p></td><td><p>6h</p></td></tr></tbody></table></div>"
    )

    assert note_html_to_markdown(html) == (
        "| タスク | 割当 |\n| --- | --- |\n| a \\| b | 6h |"
    )
