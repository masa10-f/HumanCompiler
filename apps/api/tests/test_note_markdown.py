# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com


"""
Tests for agent Markdown to note HTML conversion
"""

from datetime import date

from humancompiler_api.note_markdown import (
    agent_append_heading,
    append_html,
    markdown_to_note_html,
)


def test_markdown_to_note_html_basic():
    html = markdown_to_note_html(
        "段落です\n\n**強調**\n\n- 項目1\n- 項目2\n- [ ] タスク\n\n"
        "```python\nprint(1)\n```\n\n[a](https://example.com)\n"
    )
    assert "<p>段落です</p>" in html
    assert "<strong>強調</strong>" in html
    assert "<ul>" in html and "<li>項目1</li>" in html
    # A list where only some items have a checkbox stays a plain list.
    assert "[ ] タスク" in html
    assert "taskList" not in html
    assert "<pre><code" in html and "print(1)" in html
    assert '<a href="https://example.com">a</a>' in html


def test_markdown_to_note_html_neutralises_unsafe_input():
    html = markdown_to_note_html(
        "<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n"
    )
    assert "&lt;" in html
    assert "<script" not in html
    assert "<img" not in html

    html = markdown_to_note_html("[x](javascript:alert(1))")
    assert 'href="javascript:' not in html

    html = markdown_to_note_html("![a](https://example.com/a.png)")
    assert "<img" not in html

    html = markdown_to_note_html("#### 見出し\n\n###### 小見出し")
    assert "<h3>見出し</h3>" in html
    assert "<h3>小見出し</h3>" in html
    assert "<h4" not in html and "<h6" not in html


def test_markdown_to_note_html_keeps_h1_to_h3():
    html = markdown_to_note_html("# a\n\n## b\n\n### c")
    assert "<h1>a</h1>" in html
    assert "<h2>b</h2>" in html
    assert "<h3>c</h3>" in html


def test_agent_append_heading_escapes_name():
    heading = agent_append_heading("<b>x</b>", date(2026, 11, 2))
    assert "&lt;b&gt;" in heading
    assert "<b>" not in heading
    assert heading == (
        "<p><strong>エージェントからの追記（2026-11-02、"
        "&lt;b&gt;x&lt;/b&gt;）</strong></p>"
    )


def test_append_html_on_empty_and_existing():
    assert append_html("", "<p>x</p>") == "<p>x</p>"
    assert append_html("  \n ", "<p>x</p>") == "<p>x</p>"
    assert append_html("<p>a</p>", "<p>x</p>") == "<p>a</p><p>x</p>"


def test_task_list_uses_tiptap_markup():
    html = markdown_to_note_html("- [ ] やること\n- [x] 済み\n- [X] **太字** も\n")
    assert html == (
        '<ul data-type="taskList">\n'
        '<li data-type="taskItem" data-checked="false">\n<p>やること</p>\n</li>\n'
        '<li data-type="taskItem" data-checked="true">\n<p>済み</p>\n</li>\n'
        '<li data-type="taskItem" data-checked="true">\n'
        "<p><strong>太字</strong> も</p>\n</li>\n"
        "</ul>\n"
    )


def test_nested_task_list():
    html = markdown_to_note_html("- [ ] 親\n  - [x] 子\n")
    assert html == (
        '<ul data-type="taskList">\n'
        '<li data-type="taskItem" data-checked="false">\n<p>親</p>\n'
        '<ul data-type="taskList">\n'
        '<li data-type="taskItem" data-checked="true">\n<p>子</p>\n</li>\n'
        "</ul>\n</li>\n</ul>\n"
    )


def test_plain_list_is_unchanged():
    assert markdown_to_note_html("- a\n- b\n") == (
        "<ul>\n<li>a</li>\n<li>b</li>\n</ul>\n"
    )
    # An ordered list is never a task list.
    assert markdown_to_note_html("1. [ ] a\n") == "<ol>\n<li>[ ] a</li>\n</ol>\n"
    # A marker needs a space or the end of the line after it.
    assert markdown_to_note_html("- [x]a\n") == "<ul>\n<li>[x]a</li>\n</ul>\n"


def test_mixed_list_stays_a_plain_list():
    html = markdown_to_note_html("- [ ] a\n- b\n- [x] c\n")
    assert html == "<ul>\n<li>[ ] a</li>\n<li>b</li>\n<li>[x] c</li>\n</ul>\n"


def test_empty_task_item():
    html = markdown_to_note_html("- [ ]\n- [x] done\n")
    assert html == (
        '<ul data-type="taskList">\n'
        '<li data-type="taskItem" data-checked="false">\n<p></p>\n</li>\n'
        '<li data-type="taskItem" data-checked="true">\n<p>done</p>\n</li>\n'
        "</ul>\n"
    )


def test_task_item_escapes_raw_html():
    html = markdown_to_note_html('- [ ] <script>x</script> <img src=x onerror="y">\n')
    assert html.startswith('<ul data-type="taskList">')
    assert "<script" not in html
    assert "<img" not in html
    assert "&lt;script&gt;x&lt;/script&gt;" in html


def test_pipe_table_becomes_table_markup():
    html = markdown_to_note_html(
        "| タスク | 割当 |\n|---|---|\n| AGSでPT信号を取得する | 6h |\n| 論文を読む | 1.2h |\n"
    )
    assert html == (
        "<table>\n<thead>\n<tr>\n<th>タスク</th>\n<th>割当</th>\n</tr>\n</thead>\n"
        "<tbody>\n<tr>\n<td>AGSでPT信号を取得する</td>\n<td>6h</td>\n</tr>\n"
        "<tr>\n<td>論文を読む</td>\n<td>1.2h</td>\n</tr>\n</tbody>\n</table>\n"
    )


def test_table_cells_escape_raw_html():
    html = markdown_to_note_html("| a |\n|---|\n| <script>x</script> |\n")
    assert "<script" not in html
    assert "<td>&lt;script&gt;x&lt;/script&gt;</td>" in html
