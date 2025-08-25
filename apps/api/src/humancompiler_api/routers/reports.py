"""Weekly report endpoints"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session

from humancompiler_api.auth import AuthUser, get_current_user
from humancompiler_api.database import db
from humancompiler_api.models import (
    ErrorResponse,
    WeeklyReportRequest,
    WeeklyReportResponse,
    UserSettings,
)
from humancompiler_api.ai.report_generator import WeeklyReportGenerator
from humancompiler_api.crypto import get_crypto_service
from sqlmodel import select

router = APIRouter(prefix="/reports", tags=["reports"])


def get_session():
    """Database session dependency"""
    with Session(db.get_engine()) as session:
        yield session


@router.post(
    "/weekly",
    response_model=WeeklyReportResponse,
    responses={
        400: {"model": ErrorResponse, "description": "Invalid request data"},
        403: {"model": ErrorResponse, "description": "OpenAI API key not configured"},
        500: {"model": ErrorResponse, "description": "Report generation failed"},
    },
)
async def generate_weekly_report(
    request: WeeklyReportRequest,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> WeeklyReportResponse:
    """Generate weekly work report with AI analysis"""

    # Get user's OpenAI API key
    statement = select(UserSettings).where(UserSettings.user_id == current_user.user_id)
    user_settings = session.exec(statement).one_or_none()

    if not user_settings or not user_settings.openai_api_key_encrypted:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=ErrorResponse.create(
                code="OPENAI_API_KEY_MISSING",
                message="OpenAI API key is not configured. Please set it in user settings.",
                details={"user_id": str(current_user.user_id)},
            ).model_dump(),
        )

    try:
        # Decrypt the API key
        crypto_service = get_crypto_service()
        decrypted_api_key = crypto_service.decrypt(
            user_settings.openai_api_key_encrypted
        )

        # Generate the report
        report_generator = WeeklyReportGenerator()
        report = report_generator.generate_weekly_report(
            session=session,
            request=request,
            user_id=str(current_user.user_id),
            openai_api_key=decrypted_api_key,
            openai_model=user_settings.openai_model or "gpt-4o-mini",
        )

        return report

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=ErrorResponse.create(
                code="REPORT_GENERATION_FAILED",
                message="Failed to generate weekly report",
                details={"error": str(e), "user_id": str(current_user.user_id)},
            ).model_dump(),
        )


@router.get(
    "/weekly/template",
    response_model=dict,
    summary="Get weekly report template structure",
    responses={
        200: {"description": "Report template structure"},
    },
)
async def get_weekly_report_template(
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> dict:
    """Get the structure template for weekly reports"""
    return {
        "template_structure": {
            "title": "週間作業報告書 ({week_start_date}週)",
            "sections": [
                {
                    "name": "作業時間実績",
                    "content": [
                        "週間合計作業時間",
                        "日別作業時間",
                        "プロジェクト別配分時間",
                    ],
                },
                {
                    "name": "タスク進捗率",
                    "content": [
                        "完了タスク数/作業対象タスク数",
                        "進捗率（パーセンテージ）",
                    ],
                },
                {
                    "name": "プロジェクト別詳細",
                    "content": [
                        "各プロジェクトの作業時間",
                        "主要タスクの進捗状況",
                        "作業ログからのハイライト",
                    ],
                },
            ],
        },
        "format": "markdown",
        "example_request": {
            "week_start_date": "2023-12-18",
            "project_ids": ["uuid1", "uuid2"],
        },
    }
