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

from taskagent_api.ai.models import TaskPlan, WeeklyPlanContext, WeeklyPlanResponse
from taskagent_api.config import settings
from taskagent_api.crypto import get_crypto_service
from taskagent_api.models import UserSettings

logger = logging.getLogger(__name__)


class OpenAIClient:
    """OpenAI client using latest Responses API with GPT-5"""

    def __init__(self, api_key: str | None = None, model: str | None = None):
        """Initialize OpenAI client with optional user-specific API key"""
        if api_key:
            self.client = OpenAI(api_key=api_key)
            self.model = model or "gpt-5"  # Default to GPT-5
        elif (
            not settings.openai_api_key
            or settings.openai_api_key == "your_openai_api_key"
        ):
            logger.warning(
                "OpenAI API key not configured - AI features will not be available"
            )
            self.client = None
            self.model = "gpt-5"  # Use GPT-5 for advanced planning
        else:
            self.client = OpenAI(api_key=settings.openai_api_key)
            self.model = "gpt-5"  # Use GPT-5 for advanced planning

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
            # Decrypt API key
            api_key = get_crypto_service().decrypt(
                user_settings.openai_api_key_encrypted
            )
            if api_key:
                return cls(api_key=api_key, model=user_settings.openai_model)

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
                return self._create_unavailable_response(context)

            # Create structured input for Responses API
            planning_context = self._format_planning_context(context)

            # Use new Responses API (GPT-5)
            response = self.client.responses.create(
                model=self.model,
                input=planning_context,
                tools=self._get_planning_tools(),
                temperature=0.7,
            )

            # Parse response (structure may vary based on SDK version)
            return self._parse_responses_api_output(response, context)

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
            return self._create_error_response(
                context, "AI サービスでエラーが発生しました。"
            )
        except Exception as e:
            logger.error(f"Unexpected error generating weekly plan: {e}")
            return self._create_error_response(
                context,
                "予期しないエラーが発生しました。管理者にお問い合わせください。",
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
            recommendations=["OpenAI API key not configured - AI features unavailable"],
            insights=[
                "Please configure your OpenAI API key in settings to enable AI planning"
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

        return f"""週間計画を作成してください。

## ユーザー情報
- ユーザーID: {context.user_id}
- 週開始日: {context.week_start_date.strftime("%Y-%m-%d (%A)")}
- 利用可能時間: {context.capacity_hours} 時間

## プロジェクト ({len(context.projects)} 件)
{projects_section}

## 目標 ({len(context.goals)} 件)
{goals_section}

## 保留中のタスク ({len(context.tasks)} 件)
{tasks_section}

重点項目:
1. 重要目標の前進につながるタスクを優先
2. ディープワーク時間の最適配分
3. 週全体の作業負荷バランス
4. 期限と依存関係の考慮
5. 具体的なスケジューリング提案"""

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
                                        "suggested_day": {
                                            "type": "string",
                                            "description": "推奨曜日",
                                        },
                                        "suggested_time_slot": {
                                            "type": "string",
                                            "description": "推奨時間帯",
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
                                        "suggested_day",
                                        "suggested_time_slot",
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
        """Parse Responses API output"""
        try:
            # Handle different possible response formats
            if hasattr(response, "tool_calls") and response.tool_calls:
                # Tool was called
                tool_call = response.tool_calls[0]
                if tool_call.function.name == "create_weekly_plan":
                    function_args = json.loads(tool_call.function.arguments)
                    return self._create_weekly_plan_response(function_args, context)
                else:
                    # Unexpected tool call
                    return self._create_error_response(
                        context, f"Unexpected tool call: {tool_call.function.name}"
                    )

            # Check for output_text or similar attributes
            elif hasattr(response, "output_text"):
                # Try to parse structured output from text
                return self._parse_structured_text_output(response.output_text, context)

            # Fallback: treat entire response as text and try to extract JSON
            else:
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
        """Create WeeklyPlanResponse from function arguments"""
        task_plans = []
        for plan in function_args.get("task_plans", []):
            # Find task title
            task_title = next(
                (t.title for t in context.tasks if t.id == plan["task_id"]),
                "Unknown Task",
            )

            task_plan = TaskPlan(
                task_id=plan["task_id"],
                task_title=task_title,
                estimated_hours=plan["estimated_hours"],
                priority=plan["priority"],
                suggested_day=plan["suggested_day"],
                suggested_time_slot=plan["suggested_time_slot"],
                rationale=plan["rationale"],
            )
            task_plans.append(task_plan)

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
