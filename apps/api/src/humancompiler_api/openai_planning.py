"""Responses API function calling for reasoning-based weekly planning."""

from typing import Any

from openai import OpenAI


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
        raise ValueError("Weekly planning response did not complete")
    for item in response.output:
        if item.type == "function_call" and item.name == function["name"]:
            return item
    raise ValueError("Weekly planning response has no expected function call")
