# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

"""Rendering daily notes as Markdown for agents."""

from uuid import UUID

from humancompiler_api.daily_note_markdown import daily_note_markdown, schedule_payload
from humancompiler_api.routers.daily_plans import DailyPlanDocumentV1

TASK = UUID("11111111-1111-4111-8111-111111111111")
QUICK = UUID("22222222-2222-4222-8222-222222222222")


def render(blocks: list[dict]) -> str:
    return daily_note_markdown(DailyPlanDocumentV1.model_validate({"blocks": blocks}))


def test_renders_blocks_in_order_and_keeps_lines_in_one_list():
    markdown = render(
        [
            {
                "id": "t1",
                "type": "text",
                "text": "今日の目標",
                "content": {
                    "type": "heading",
                    "attrs": {"level": 2},
                    "content": [{"type": "text", "text": "今日の目標"}],
                },
            },
            {
                "id": "e1",
                "type": "timed_line",
                "start": "09:00",
                "end": "10:00",
                "title": "定例",
                "completed": True,
            },
            {
                "id": "b1",
                "type": "timed_line",
                "start": "12:00",
                "end": "13:00",
                "title": "昼食",
                "kind": "break",
            },
            {
                "id": "s1",
                "type": "schedule_directive",
                "mode": "task",
                "work_type": "focused_work",
                "title": "論文",
                "task_ref": {"source": "task", "id": str(TASK)},
                "allowed_windows": [{"start": "13:00", "end": "16:00"}],
                "note": "第3章から",
            },
            {
                "id": "c1",
                "type": "checklist_item",
                "title": "メール返信",
                "checked": False,
                "task_ref": {"source": "quick_task", "id": str(QUICK)},
            },
            {"id": "t2", "type": "text", "text": "メモ"},
        ]
    )

    assert markdown == (
        "## 今日の目標\n\n"
        "- 09:00〜10:00 定例（完了）\n"
        "- 12:00〜13:00 [休憩] 昼食\n"
        f"- /schedule 13:00〜16:00 論文（集中作業） (task_id: {TASK})\n"
        "  メモ:\n"
        "  第3章から\n"
        f"- [ ] メール返信 (quick_task_id: {QUICK})\n\n"
        "メモ"
    )


def test_rich_text_keeps_lists_marks_and_links():
    markdown = render(
        [
            {
                "id": "t1",
                "type": "text",
                "text": "",
                "content": {
                    "type": "taskList",
                    "content": [
                        {
                            "type": "taskItem",
                            "attrs": {"checked": True},
                            "content": [
                                {
                                    "type": "paragraph",
                                    "content": [
                                        {
                                            "type": "text",
                                            "text": "資料",
                                            "marks": [
                                                {"type": "bold"},
                                                {
                                                    "type": "link",
                                                    "attrs": {
                                                        "href": "https://example.com/a?b=1&c=2"
                                                    },
                                                },
                                            ],
                                        },
                                        {"type": "text", "text": " を <読む>"},
                                    ],
                                }
                            ],
                        }
                    ],
                },
            }
        ]
    )

    assert markdown == "- [x] [**資料**](https://example.com/a?b=1&c=2) を <読む>"


def test_empty_note_is_empty():
    assert render([]) == ""
    assert render([{"id": "t1", "type": "text", "text": ""}]) == ""


def test_schedule_lists_assignments_by_start_time():
    plan = {
        "assignments": [
            {
                "task_id": f"quick_{QUICK}",
                "task_title": "メール",
                "start_time": "13:00",
                "duration_hours": 0.5,
            },
            {
                "task_id": str(TASK),
                "task_title": "論文",
                "start_time": "09:00",
                "duration_hours": 1.5,
                "source": "task",
            },
        ]
    }

    assert schedule_payload(plan) == [
        {
            "start_time": "09:00",
            "duration_minutes": 90,
            "title": "論文",
            "task_id": str(TASK),
        },
        {
            "start_time": "13:00",
            "duration_minutes": 30,
            "title": "メール",
            "quick_task_id": str(QUICK),
        },
    ]
    assert schedule_payload(None) is None
    assert schedule_payload({}) is None
