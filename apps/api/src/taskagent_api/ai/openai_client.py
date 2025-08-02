"""
OpenAI client wrapper for AI services
"""

import json
import logging
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
from taskagent_api.ai.prompts import (
    create_system_prompt,
    create_weekly_plan_user_message,
    get_function_definitions,
)
from taskagent_api.config import settings
from taskagent_api.crypto import get_crypto_service
from taskagent_api.models import UserSettings

logger = logging.getLogger(__name__)


class OpenAIClient:
    """OpenAI client for AI services"""

    def __init__(self, api_key: str | None = None, model: str | None = None):
        """Initialize OpenAI client with optional user-specific API key"""
        if api_key:
            self.client = OpenAI(api_key=api_key)
            self.model = model or "gpt-4-1106-preview"
        elif (
            not settings.openai_api_key
            or settings.openai_api_key == "your_openai_api_key"
        ):
            logger.warning(
                "OpenAI API key not configured - AI features will not be available"
            )
            self.client = None
            self.model = "gpt-4-1106-preview"  # GPT-4 Turbo with function calling
        else:
            self.client = OpenAI(api_key=settings.openai_api_key)
            self.model = "gpt-4-1106-preview"  # GPT-4 Turbo with function calling

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
        """Generate weekly plan using OpenAI API"""
        try:
            logger.info(f"Generating weekly plan for user {context.user_id}")

            # Check if OpenAI client is available
            if not self.is_available():
                return self._create_unavailable_response(context)

            # Create messages
            system_message = create_system_prompt()
            user_message = create_weekly_plan_user_message(context)

            # Call OpenAI API
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system_message},
                    {"role": "user", "content": user_message},
                ],
                functions=get_function_definitions(),
                function_call={"name": "create_week_plan"},
                temperature=0.7,
                max_tokens=2000,
            )

            # Parse function call response
            function_call = response.choices[0].message.function_call
            if function_call and function_call.name == "create_week_plan":
                return self._parse_function_response(function_call, context)
            else:
                logger.error("OpenAI did not return expected function call")
                return self._create_error_response(
                    context, "Failed to generate plan - please try again"
                )

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

    def _parse_function_response(
        self, function_call, context: WeeklyPlanContext
    ) -> WeeklyPlanResponse:
        """Parse OpenAI function call response"""
        try:
            function_args = json.loads(function_call.arguments)

            # Convert to our response format
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
        except (KeyError, ValueError, TypeError) as e:
            logger.error(f"Error parsing function response - invalid format: {e}")
            return self._create_error_response(
                context, "AI レスポンスの形式が無効です。"
            )
        except Exception as e:
            logger.error(f"Unexpected error parsing function response: {e}")
            return self._create_error_response(
                context, "AI レスポンスの処理中にエラーが発生しました。"
            )
