"""
OpenAI client wrapper for AI services using latest Responses API
"""

import json
import logging
import os
import re
from datetime import datetime
from uuid import UUID

from openai import (
    RateLimitError,
    AuthenticationError,
    APIConnectionError,
    APIError,
    OpenAI,
)
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from humancompiler_api.ai.models import TaskPlan, WeeklyPlanContext, WeeklyPlanResponse
from humancompiler_api.ai.task_utils import filter_valid_tasks
from humancompiler_api.config import settings
from humancompiler_api.crypto import get_crypto_service
from humancompiler_api.models import UserSettings

logger = logging.getLogger(__name__)


class OpenAIClient:
    """OpenAI client using Responses API and Chat Completions API with GPT-5"""

    def __init__(self, api_key: str | None = None, model: str | None = None):
        """Initialize OpenAI client with optional user-specific API key"""
        # Use GPT-5 as default (latest flagship model)
        default_model = "gpt-5"  # GPT-5 flagship model for advanced planning

        if api_key:
            logger.info(
                f"Initializing OpenAI client with user API key (model: {model or default_model})"
            )
            self.client = OpenAI(api_key=api_key)
            self.model = model or default_model
        elif (
            not settings.openai_api_key
            or settings.openai_api_key == "your_openai_api_key"
            or settings.openai_api_key == "development-key-not-available"
        ):
            logger.warning(
                "OpenAI API key not configured - AI features will not be available"
            )
            self.client = None
            self.model = default_model
        else:
            logger.info(
                f"Initializing OpenAI client with system API key (model: {default_model})"
            )
            self.client = OpenAI(api_key=settings.openai_api_key)
            self.model = default_model

    def is_available(self) -> bool:
        """Check if OpenAI client is available"""
        return self.client is not None

    @classmethod
    async def create_for_user(
        cls, user_id: UUID, session: AsyncSession
    ) -> "OpenAIClient":
        """Create OpenAI client for a specific user with their API key"""
        # Get user settings
        result = await session.execute(
            select(UserSettings).where(UserSettings.user_id == user_id)
        )
        user_settings = result.scalar_one_or_none()

        if user_settings and user_settings.openai_api_key_encrypted:
            try:
                # Decrypt API key
                api_key = get_crypto_service().decrypt(
                    user_settings.openai_api_key_encrypted
                )
                if api_key:
                    logger.info(
                        f"Successfully decrypted OpenAI API key for user {user_id}"
                    )
                    return cls(api_key=api_key, model=user_settings.openai_model)
                else:
                    logger.warning(
                        f"Failed to decrypt OpenAI API key for user {user_id}"
                    )
            except Exception as e:
                logger.error(f"Error decrypting OpenAI API key for user {user_id}: {e}")
                logger.error(f"Crypto error type: {type(e).__name__}")

        # Fall back to system API key or no client
        return cls()

    async def generate_weekly_plan(
        self, context: WeeklyPlanContext
    ) -> WeeklyPlanResponse:
        """Generate weekly plan using OpenAI Responses API"""
        try:
            logger.info(f"Generating weekly plan for user {context.user_id}")

            # Check if OpenAI client is available
            if not self.is_available():
                logger.warning("OpenAI client is not available")
                return self._create_unavailable_response(context)

            # Log diagnostic information
            logger.info(f"Starting plan generation with model: {self.model}")
            logger.info(
                f"Context: {len(context.tasks)} tasks, {len(context.projects)} projects"
            )

            # Create structured input for Chat Completions API
            planning_context = self._format_planning_context(context)

            # Use Chat Completions API directly (Responses API is experimental/not available)
            logger.info(f"Using Chat Completions API with model {self.model}")
            return self._use_chat_completions_api(context, planning_context)

        except RateLimitError as e:
            logger.warning(f"OpenAI rate limit exceeded: {e}")
            return self._create_error_response(
                context,
                "リクエストが多すぎます。しばらく待ってから再度お試しください。",
            )
        except AuthenticationError as e:
            logger.error(f"OpenAI authentication failed: {e}")
            return self._create_error_response(
                context, "AI サービスの認証に失敗しました。"
            )
        except APIConnectionError as e:
            logger.error(f"OpenAI connection failed: {e}")
            return self._create_error_response(
                context, "AI サービスへの接続に失敗しました。"
            )
        except APIError as e:
            logger.error(f"OpenAI API error: {e}")
            logger.error(
                f"API error details - status: {getattr(e, 'status_code', 'N/A')}, type: {getattr(e, 'type', 'N/A')}"
            )
            return self._create_error_response(
                context, f"AI サービスでエラーが発生しました: {str(e)}"
            )
        except Exception as e:
            logger.error(f"Unexpected error generating weekly plan: {e}")
            logger.error(f"Error type: {type(e).__name__}")
            logger.error(f"Model being used: {self.model}")
            logger.error(f"Client available: {self.is_available()}")
            return self._create_error_response(
                context,
                f"予期しないエラーが発生しました: {str(e)}",
            )

    def _create_unavailable_response(
        self, context: WeeklyPlanContext
    ) -> WeeklyPlanResponse:
        """Create response when OpenAI is unavailable"""
        return WeeklyPlanResponse(
            success=False,
            week_start_date=context.week_start_date.strftime("%Y-%m-%d"),
            total_planned_hours=0.0,
            task_plans=[],
            recommendations=[
                "OpenAI APIキーが設定されていません。設定画面でAPIキーを登録してください。"
            ],
            insights=[
                "AI機能を使用するには、有効なOpenAI APIキーの設定が必要です。",
                "設定画面からAPIキーを入力し、AI機能を有効にしてください。",
            ],
            generated_at=datetime.now(),
        )

    def _create_error_response(
        self, context: WeeklyPlanContext, error_message: str
    ) -> WeeklyPlanResponse:
        """Create error response"""
        return WeeklyPlanResponse(
            success=False,
            week_start_date=context.week_start_date.strftime("%Y-%m-%d"),
            total_planned_hours=0.0,
            task_plans=[],
            recommendations=[error_message],
            insights=["Please check OpenAI API configuration and try again"],
            generated_at=datetime.now(),
        )

    def _format_planning_context(self, context: WeeklyPlanContext) -> str:
        """Format context for Responses API input"""
        # Debug logging
        logger.info(
            f"Formatting context: {len(context.projects)} projects, {len(context.goals)} goals, {len(context.tasks)} tasks, {len(context.weekly_recurring_tasks)} weekly recurring tasks"
        )

        projects_section = "\n".join(
            [
                f"### {p.title}\n- ID: {p.id}\n- 説明: {p.description or '説明なし'}"
                for p in context.projects
            ]
        )

        goals_section = "\n".join(
            [
                f"### {g.title}\n- ID: {g.id}\n- 予想時間: {g.estimate_hours}時間\n- 説明: {g.description or '説明なし'}"
                for g in context.goals
            ]
        )

        tasks_section = "\n".join(
            [
                f"### {t.title}\n- ID: {t.id}\n- ステータス: {t.status}\n- 予想時間: {t.estimate_hours}時間\n- 期限: {t.due_date.strftime('%Y-%m-%d') if t.due_date else '未設定'}\n- 説明: {t.description or '説明なし'}"
                for t in context.tasks
            ]
        )

        # Add weekly recurring tasks section
        recurring_tasks_section = ""
        if context.weekly_recurring_tasks:
            # Filter selected recurring tasks
            selected_recurring_tasks = []
            if context.selected_recurring_task_ids:
                selected_recurring_tasks = [
                    rt
                    for rt in context.weekly_recurring_tasks
                    if str(rt.id) in context.selected_recurring_task_ids
                ]
            else:
                # If no specific selection, include all active recurring tasks
                selected_recurring_tasks = context.weekly_recurring_tasks

            if selected_recurring_tasks:
                recurring_tasks_section = "\n".join(
                    [
                        f"### {rt.title}\n- ID: {rt.id}\n- カテゴリ: {rt.category}\n- 予想時間: {rt.estimate_hours}時間\n- 説明: {rt.description or '説明なし'}"
                        for rt in selected_recurring_tasks
                    ]
                )

        # Log sample task IDs being sent to OpenAI
        if context.tasks:
            logger.info(
                f"Sample task IDs being sent to OpenAI: {[str(t.id) for t in context.tasks[:3]]}..."
            )
        if context.weekly_recurring_tasks:
            logger.info(
                f"Weekly recurring task IDs being sent to OpenAI: {[str(rt.id) for rt in context.weekly_recurring_tasks]}"
            )

        base_context = f"""週間計画を作成してください。

## ユーザー情報
- ユーザーID: {context.user_id}
- 週開始日: {context.week_start_date.strftime("%Y-%m-%d (%A)")}
- 利用可能時間: {context.capacity_hours} 時間

## プロジェクト ({len(context.projects)} 件)
{projects_section}

## 目標 ({len(context.goals)} 件)
{goals_section}

## 保留中のタスク ({len(context.tasks)} 件)
{tasks_section}"""

        # Add weekly recurring tasks section if available
        if recurring_tasks_section:
            base_context += f"""

## 選択された週課 ({len([rt for rt in context.weekly_recurring_tasks if str(rt.id) in (context.selected_recurring_task_ids or [])])} 件)
{recurring_tasks_section}

## 重要な制約
**必ず「保留中のタスク」および「選択された週課」セクションに記載されているID（タスクIDまたは週課ID）のみを選択してください。**
上記の一覧に存在しないIDは使用しないでください。

注意: 週課（週間反復タスク）も通常のタスクと同様に計画に含めて、週間スケジュールに組み込んでください。"""
        else:
            base_context += """

## 重要な制約
**必ず「保留中のタスク」セクションに記載されているタスクIDのみを選択してください。**
上記のタスク一覧に存在しないIDは使用しないでください。"""

        base_context += """

重点項目:
1. 重要目標の前進につながるタスクを優先
2. ディープワーク時間の最適配分
3. 週全体の作業負荷バランス
4. 期限と依存関係の考慮
5. 週課（反復タスク）の確実な実行
6. 具体的なスケジューリング提案"""

        return base_context

    def _get_planning_tools(self) -> list[dict]:
        """Get tools definition for weekly planning"""
        return [
            {
                "type": "function",
                "function": {
                    "name": "create_weekly_plan",
                    "description": "ユーザーコンテキストに基づく最適な週間計画の作成",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "task_plans": {
                                "type": "array",
                                "description": "週間計画のタスク一覧",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "task_id": {
                                            "type": "string",
                                            "description": "タスクID",
                                        },
                                        "estimated_hours": {
                                            "type": "number",
                                            "description": "予想時間",
                                        },
                                        "priority": {
                                            "type": "integer",
                                            "description": "優先度 (1=最高, 5=最低)",
                                        },
                                        "rationale": {
                                            "type": "string",
                                            "description": "スケジューリングの根拠",
                                        },
                                    },
                                    "required": [
                                        "task_id",
                                        "estimated_hours",
                                        "priority",
                                        "rationale",
                                    ],
                                },
                            },
                            "recommendations": {
                                "type": "array",
                                "items": {"type": "string"},
                                "description": "週間の一般的な推奨事項",
                            },
                            "insights": {
                                "type": "array",
                                "items": {"type": "string"},
                                "description": "作業負荷と最適化機会に関する洞察",
                            },
                        },
                        "required": ["task_plans", "recommendations", "insights"],
                    },
                },
            }
        ]

    def _parse_responses_api_output(
        self, response, context: WeeklyPlanContext
    ) -> WeeklyPlanResponse:
        """Parse Responses API output (GPT-5 format)"""
        try:
            logger.info(f"Parsing Responses API output: {type(response)}")

            # Responses API format according to OpenAI documentation
            if hasattr(response, "tool_calls") and response.tool_calls:
                # Tool was called
                tool_call = response.tool_calls[0]
                logger.info(f"Tool called via Responses API: {tool_call.function.name}")
                if tool_call.function.name == "create_weekly_plan":
                    function_args = json.loads(tool_call.function.arguments)
                    return self._create_weekly_plan_response(function_args, context)
                else:
                    return self._create_error_response(
                        context, f"Unexpected tool call: {tool_call.function.name}"
                    )

            # Check for output_text attribute (Responses API main output)
            elif hasattr(response, "output_text"):
                logger.info("Processing output_text from Responses API")
                # Check if the output contains tool execution results
                output = response.output_text
                if isinstance(output, str):
                    return self._parse_structured_text_output(output, context)
                else:
                    # Try to extract structured data
                    return self._create_weekly_plan_response(output, context)

            # Handle other possible response formats
            elif hasattr(response, "output"):
                logger.info("Processing output from Responses API")
                return self._parse_structured_text_output(str(response.output), context)

            # Fallback: treat entire response as text and try to extract JSON
            else:
                logger.warning(
                    f"Unknown Responses API format, attempting to parse: {response}"
                )
                response_text = str(response)
                return self._parse_structured_text_output(response_text, context)

        except Exception as e:
            logger.error(f"Error parsing Responses API output: {e}")
            return self._create_error_response(
                context, "AIレスポンスの解析に失敗しました。"
            )

    def _create_weekly_plan_response(
        self, function_args: dict, context: WeeklyPlanContext
    ) -> WeeklyPlanResponse:
        """
        Create WeeklyPlanResponse from function arguments with task filtering.

        This method processes AI-generated task plans and filters out any task IDs
        that don't exist in the database context. Only valid tasks are included
        in the final response to prevent "Unknown Task" entries.

        Args:
            function_args: Dictionary containing task_plans, recommendations, and insights
            context: Weekly plan context with available tasks for validation

        Returns:
            WeeklyPlanResponse with filtered task plans and original recommendations/insights
        """
        # Debug logging
        logger.info(
            f"Processing function arguments with {len(function_args.get('task_plans', []))} task plans "
            f"(user: {context.user_id}, week: {context.week_start_date.strftime('%Y-%m-%d')})"
        )
        logger.info(
            f"Available task IDs in context: {[str(t.id) for t in context.tasks][:10]}..."
        )

        # Use shared utility function for task filtering
        task_plans, skipped_tasks = filter_valid_tasks(
            function_args.get("task_plans", []), context, "openai client"
        )

        total_hours = sum(plan.estimated_hours for plan in task_plans)

        return WeeklyPlanResponse(
            success=True,
            week_start_date=context.week_start_date.strftime("%Y-%m-%d"),
            total_planned_hours=total_hours,
            task_plans=task_plans,
            recommendations=function_args.get("recommendations", []),
            insights=function_args.get("insights", []),
            generated_at=datetime.now(),
        )

    def _parse_structured_text_output(
        self, output_text: str, context: WeeklyPlanContext
    ) -> WeeklyPlanResponse:
        """Parse structured output from text response"""
        try:
            # Look for JSON in the response
            json_match = re.search(r"\{.*\}", output_text, re.DOTALL)
            if json_match is not None:
                json_data = json.loads(json_match.group())
                return self._create_weekly_plan_response(json_data, context)
            else:
                # If no structured data, create basic response
                return WeeklyPlanResponse(
                    success=False,
                    week_start_date=context.week_start_date.strftime("%Y-%m-%d"),
                    total_planned_hours=0.0,
                    task_plans=[],
                    recommendations=[
                        output_text[:200] + "..."
                        if len(output_text) > 200
                        else output_text
                    ],
                    insights=["構造化データの抽出に失敗しました"],
                    generated_at=datetime.now(),
                )
        except Exception as e:
            logger.error(f"Error parsing structured text output: {e}")
            return self._create_error_response(
                context, "テキストレスポンスの解析に失敗しました。"
            )

    def _use_chat_completions_api(
        self, context: WeeklyPlanContext, planning_context: str
    ) -> WeeklyPlanResponse:
        """Use Chat Completions API for GPT-5 weekly planning"""
        try:
            logger.info(f"Using Chat Completions API fallback for model {self.model}")

            # Debug - log the task context
            logger.info(f"Context has {len(context.tasks)} tasks:")
            for task in context.tasks[:5]:  # Log first 5 tasks
                logger.info(f"  Task ID: {task.id}, Title: {task.title}")

            # Prepare API parameters for Chat Completions
            api_params = {
                "model": self.model,
                "messages": [
                    {
                        "role": "system",
                        "content": "あなたは週間計画作成の専門家です。与えられたコンテキストに基づいて最適な週間計画を作成してください。",
                    },
                    {"role": "user", "content": planning_context},
                ],
                "tools": self._get_planning_tools(),
                "tool_choice": {
                    "type": "function",
                    "function": {"name": "create_weekly_plan"},
                },
                "max_completion_tokens": 8000,  # Increased to avoid truncation
            }

            # Add temperature for supported models (GPT-5 only supports default temperature)
            if not self.model.startswith(("o1", "gpt-5")):
                api_params["temperature"] = 0.7

            response = self.client.chat.completions.create(**api_params)

            # Parse Chat Completions response
            return self._parse_chat_completions_response(response, context)

        except Exception as e:
            logger.error(f"Chat Completions fallback failed: {e}")
            logger.error(f"Fallback error type: {type(e).__name__}")
            logger.error(
                f"Model: {self.model}, Client available: {self.client is not None}"
            )
            return self._create_error_response(
                context, f"AI処理でエラーが発生しました: {str(e)}"
            )

    def _parse_chat_completions_response(
        self, response, context: WeeklyPlanContext
    ) -> WeeklyPlanResponse:
        """Parse Chat Completions API response"""
        try:
            message = response.choices[0].message

            if message.tool_calls:
                # Tool was called
                tool_call = message.tool_calls[0]
                logger.info(f"Tool called: {tool_call.function.name}")

                if tool_call.function.name == "create_weekly_plan":
                    import json

                    function_args = json.loads(tool_call.function.arguments)
                    logger.info(
                        f"Function arguments received: {len(function_args.get('task_plans', []))} task plans"
                    )

                    # Log first few task IDs for debugging
                    for i, plan in enumerate(function_args.get("task_plans", [])[:3]):
                        logger.info(f"  Plan {i}: task_id={plan.get('task_id')}")

                    return self._create_weekly_plan_response(function_args, context)
                else:
                    return self._create_error_response(
                        context, f"予期しないツール呼び出し: {tool_call.function.name}"
                    )
            else:
                # No tool call, try to parse text content
                if message.content:
                    return self._parse_structured_text_output(message.content, context)
                else:
                    logger.error("OpenAI returned empty response with no tool calls")
                    return self._create_error_response(
                        context,
                        "AIからの応答が空でした。APIキーが正しく設定されているか確認してください。",
                    )

        except Exception as e:
            logger.error(f"Error parsing Chat Completions response: {e}")
            return self._create_error_response(context, "AI応答の解析に失敗しました。")
