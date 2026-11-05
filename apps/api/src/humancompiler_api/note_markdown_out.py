# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"""
Convert note HTML (what the TipTap editor saves) into Markdown for agents.

This is the reverse of ``note_markdown.markdown_to_note_html``. TipTap task lists
become ``- [ ]`` / ``- [x]`` items, which ``markdown_to_note_html`` turns back
into the same checklist. Both markups are accepted:

* the minimal markup the Markdown converter writes:
  ``<li data-type="taskItem" data-checked="true"><p>..</p></li>``
* the markup the editor itself saves, where an item also holds a checkbox label
  and wraps its content in a ``div``.

Anything Markdown cannot express (underline, colours, unknown tags) is reduced
to its text. ``script`` and ``style`` content is dropped.
"""

import re

from bs4.element import Tag
from markdownify import ATX, MarkdownConverter

_LANGUAGE_CLASS = re.compile(r"^language-(\S+)$")
_BACKTICK_RUN = re.compile(r"`+")
_MIN_FENCE = 3


def _code_language(pre: Tag) -> str:
    """Language of a TipTap code block (``<pre><code class="language-x">``)."""
    code = pre.find("code")
    if not isinstance(code, Tag):
        return ""
    classes = code.get("class")
    if not isinstance(classes, list):
        return ""
    for name in classes:
        match = _LANGUAGE_CLASS.match(name)
        if match is not None:
            return match.group(1)
    return ""


def _is_checked(item: Tag) -> bool:
    marker = item.get("data-checked")
    if isinstance(marker, str):
        return marker.lower() == "true"
    checkbox = item.find("input", attrs={"type": "checkbox"})
    return isinstance(checkbox, Tag) and checkbox.has_attr("checked")


class _NoteMarkdownConverter(MarkdownConverter):
    def convert_li(self, el: Tag, text: str, parent_tags: set[str]) -> str:
        # markdownify's stubs omit the convert_* hooks.
        item: str = super().convert_li(el, text, parent_tags)  # type: ignore[misc]
        if el.get("data-type") != "taskItem":
            return item
        box = "[x]" if _is_checked(el) else "[ ]"
        if not item.strip():
            # An empty checklist item still counts as an item.
            return f"- {box}\n"
        return f"- {box} {item[2:]}"

    def convert_p(self, el: Tag, text: str, parent_tags: set[str]) -> str:
        # In a list item the editor puts the text in a <p>; keep a nested list
        # directly under it instead of separating them with a blank line.
        if "li" in parent_tags and "_inline" not in parent_tags:
            following = el.find_next_sibling()
            if isinstance(following, Tag) and following.name in ("ul", "ol"):
                return text.strip(" \t\r\n") + "\n"
        converted: str = super().convert_p(el, text, parent_tags)  # type: ignore[misc]
        return converted

    def convert_pre(self, el: Tag, text: str, parent_tags: set[str]) -> str:
        if not text:
            return ""
        code = text.strip("\n")
        # A fence longer than any backtick run in the code keeps it intact.
        longest = max((len(run) for run in _BACKTICK_RUN.findall(code)), default=0)
        fence = "`" * max(_MIN_FENCE, longest + 1)
        return f"\n\n{fence}{_code_language(el)}\n{code}\n{fence}\n\n"


def note_html_to_markdown(html: str) -> str:
    """Render note HTML as Markdown. Blank notes give an empty string."""
    if not html.strip():
        return ""
    converter = _NoteMarkdownConverter(heading_style=ATX, bullets="-")
    markdown: str = converter.convert(html)
    return markdown.strip()
