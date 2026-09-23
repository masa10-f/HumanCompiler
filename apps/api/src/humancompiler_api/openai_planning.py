"""Responses API function calling for reasoning-based weekly planning."""

import logging
from typing import Any

from openai import OpenAI

logger = logging.getLogger(__name__)


def create_planning_function_call(
    client: OpenAI,
    model: str,
    messages: list[dict[str, Any]],
    function: dict[str, Any],
    max_output_tokens: int,
) -> Any:
    """Preserve high reasoning and the existing function argument contract."""
    response = client.responses.create(
        model=model,
        input=messages,
        tools=[{"type": "function", **function, "strict": False}],
        tool_choice={"type": "function", "name": function["name"]},
        reasoning={"effort": "high"},
        max_output_tokens=max_output_tokens,
        store=False,
    )
    if response.status != "completed":
        reason = getattr(getattr(response, "incomplete_details", None), "reason", None)
        error = getattr(response, "error", None)
        logger.warning(
            "Weekly planning response did not complete: status=%s reason=%s "
            "error_code=%s error_message=%s",
            response.status,
            reason,
            getattr(error, "code", None),
            getattr(error, "message", None),
        )
        if response.status == "incomplete":
            if reason == "max_output_tokens":
                raise ValueError(
                    "週間計画の生成が出力上限に達しました。対象タスクや入力を減らして、もう一度生成してください。"
                )
            if reason == "content_filter":
                raise ValueError(
                    "週間計画の生成が安全性フィルタで途中停止しました。入力内容を調整してください。"
                )
            raise ValueError(
                "週間計画の生成が途中で停止しました。もう一度生成してください。"
            )
        raise ValueError(
            "週間計画の生成に失敗しました。入力内容を確認し、もう一度生成してください。"
        )
    for item in response.output:
        if item.type == "function_call" and item.name == function["name"]:
            return item
    raise ValueError("Weekly planning response has no expected function call")
