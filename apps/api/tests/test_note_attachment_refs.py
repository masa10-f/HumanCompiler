# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"""Attachment references in notes: HTML, Markdown, search text and AI context."""

from uuid import UUID

import pytest

from humancompiler_api.ai.note_text import note_to_plain_text
from humancompiler_api.note_attachment_refs import (
    CAPTION_MAX_LENGTH,
    attachment_markdown,
    attachment_references,
    normalize_caption,
)
from humancompiler_api.note_markdown import markdown_to_note_html
from humancompiler_api.note_markdown_out import note_html_to_markdown
from humancompiler_api.note_text import note_excerpt, note_plain_text

ID = UUID("11111111-2222-4333-8444-555555555555")
OTHER = UUID("99999999-8888-4777-8666-555555555555")
IMG = f'<img data-attachment-id="{ID}" alt="損失の推移">'


def test_markdown_reference_becomes_an_image_without_a_url() -> None:
    html = markdown_to_note_html(f"前\n\n![損失の推移](attachment:{ID})\n\n後")

    assert html == f"<p>前</p>\n{IMG}\n<p>後</p>\n"
    assert "src=" not in html


def test_reference_id_is_written_in_lower_case() -> None:
    html = markdown_to_note_html(f"![a](attachment:{str(ID).upper()})")

    assert f'data-attachment-id="{ID}"' in html


def test_caption_is_escaped_and_loses_its_markup() -> None:
    markdown = f'![図 \\[1\\] **太字** "引用" <b>&](attachment:{ID})'

    html = markdown_to_note_html(markdown)

    assert html == (
        f'<img data-attachment-id="{ID}" '
        'alt="図 [1] 太字 &quot;引用&quot; &lt;b&gt;&amp;">'
    )


@pytest.mark.parametrize(
    "markdown",
    [
        "![外部](https://example.com/a.png)",
        "![data](data:image/png;base64,AAAA)",
        "![not an id](attachment:1234)",
        f"![with a path](attachment:{ID}/../x)",
        f"![other scheme](attachments:{ID})",
    ],
)
def test_any_other_image_is_never_loaded(markdown: str) -> None:
    html = markdown_to_note_html(markdown)

    assert "<img" not in html


def test_external_image_stays_a_link_as_before() -> None:
    html = markdown_to_note_html("![外部](https://example.com/a.png)")

    assert html == '<p>!<a href="https://example.com/a.png">外部</a></p>\n'


def test_raw_html_image_is_still_shown_as_text() -> None:
    html = markdown_to_note_html(f'<img data-attachment-id="{ID}" src="x">')

    assert "<img" not in html
    assert "&lt;img" in html


def test_image_inside_text_stays_in_its_paragraph() -> None:
    html = markdown_to_note_html(f"図 ![a](attachment:{ID}) を参照")

    assert html == f'<p>図 <img data-attachment-id="{ID}" alt="a"> を参照</p>\n'


def test_images_in_lists_and_tables() -> None:
    html = markdown_to_note_html(
        f"- ![a](attachment:{ID})\n\n| 図 |\n|---|\n| ![b](attachment:{OTHER}) |"
    )

    assert f'<li><img data-attachment-id="{ID}" alt="a"></li>' in html
    assert f'<td><img data-attachment-id="{OTHER}" alt="b"></td>' in html


def test_html_to_markdown_and_back_keeps_the_image() -> None:
    html = f"<p>前</p>{IMG}<p>後</p>"

    markdown = note_html_to_markdown(html)

    assert markdown == f"前\n\n![損失の推移](attachment:{ID})\n\n後"
    assert markdown_to_note_html(markdown) == f"<p>前</p>\n{IMG}\n<p>後</p>\n"


def test_caption_with_brackets_round_trips() -> None:
    html = f'<img data-attachment-id="{ID}" alt="図 [1] a\\b">'

    markdown = note_html_to_markdown(html)

    assert markdown == f"![図 \\[1\\] a\\\\b](attachment:{ID})"
    assert markdown_to_note_html(markdown) == html


def test_external_image_in_html_keeps_its_url_in_markdown() -> None:
    markdown = note_html_to_markdown('<p><img src="https://e.com/a.png" alt="x"></p>')

    assert markdown == "![x](https://e.com/a.png)"


def test_image_with_a_bad_id_is_not_a_reference() -> None:
    html = '<img data-attachment-id="nope" alt="x">'

    assert "attachment:" not in note_html_to_markdown(html)
    assert attachment_references(html, "html") == {}


@pytest.mark.parametrize(
    "written",
    [
        str(ID).replace("-", ""),
        "{" + str(ID) + "}",
        f"urn:uuid:{ID}",
    ],
    ids=["no-hyphens", "braces", "urn"],
)
def test_only_the_usual_form_of_an_id_is_a_reference(written: str) -> None:
    # UUID() reads these too, but the cleanup looks for the hyphenated text.
    html = f'<img data-attachment-id="{written}" alt="x">'

    assert attachment_references(html, "html") == {}
    assert "attachment:" not in note_html_to_markdown(html)


def test_references_of_an_html_note() -> None:
    html = (
        f"<p>a</p>{IMG}"
        f'<p><img alt="二番目 &amp; 最後" data-attachment-id="{str(OTHER).upper()}"></p>'
        f'<img data-attachment-id="{ID}" alt="同じ画像の二度目">'
        '<img src="https://example.com/x.png" alt="外部">'
    )

    assert attachment_references(html, "html") == {
        ID: "損失の推移",
        OTHER: "二番目 & 最後",
    }


def test_references_of_a_markdown_note() -> None:
    markdown = f"text ![図 \\[1\\]](attachment:{ID}) and ![x](https://e.com/a.png)"

    assert attachment_references(markdown, "markdown") == {ID: "図 [1]"}


def test_reference_written_as_text_is_not_a_reference() -> None:
    html = f"<p>&lt;img data-attachment-id=&quot;{ID}&quot;&gt;</p><pre>{ID}</pre>"

    assert attachment_references(html, "html") == {}


def test_caption_is_one_line_of_limited_length() -> None:
    assert normalize_caption("  図\n\t1 \r\n 損失 ") == "図 1 損失"
    assert len(normalize_caption("あ" * 600)) == CAPTION_MAX_LENGTH
    assert attachment_markdown(ID, "a\nb") == f"![a b](attachment:{ID})"


def test_search_text_holds_the_caption() -> None:
    text = note_plain_text(f"<p>前</p>{IMG}<p>後</p>", "html")

    assert text == "前\n損失の推移\n後"
    assert str(ID) not in text


def test_search_text_of_a_caption_with_special_characters() -> None:
    html = (
        f'<p>a<img data-attachment-id="{ID}" alt="x &gt; y &amp; &quot;z&quot;">b</p>'
    )

    assert note_plain_text(html, "html") == 'a\nx > y & "z"\nb'


def test_image_without_a_caption_adds_no_line() -> None:
    html = f'<p>a</p><img data-attachment-id="{ID}" alt=""><p>b</p>'

    assert note_plain_text(html, "html") == "a\nb"


def test_task_excerpt_reads_the_caption() -> None:
    assert note_excerpt(note_plain_text(IMG, "html")) == "損失の推移"


def test_ai_context_gets_the_caption_and_the_id_only() -> None:
    text = note_to_plain_text(
        f"<h2>結果</h2><p>前</p>{IMG}<ul><li>{IMG}</li></ul>", "html"
    )

    assert text == (
        f"## 結果\n前\n![損失の推移](attachment:{ID})\n- ![損失の推移](attachment:{ID})"
    )
    assert "http" not in text
