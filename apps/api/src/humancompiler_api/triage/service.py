"""Capacity triage service.

The triage engine keeps the final decision deterministic: OpenAI can only add a
small bounded rank adjustment and a short reason. Capacity selection and apply
actions are local code paths.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP
from typing import Any
from uuid import UUID

from fastapi import HTTPException, status
from openai import OpenAI
from sqlmodel import Session, col, func, select

from humancompiler_api.crypto import get_crypto_service
from humancompiler_api.models import (
    Goal,
    Log,
    Project,
    QuickTask,
    Task,
    TaskStatus,
    TaskTriageItem,
    TaskTriageRun,
    TriageApplyResponse,
    TriageCapacitySettings,
    TriageCapacitySettingsResponse,
    TriageCapacitySettingsUpdate,
    TriageItemResponse,
    TriageRecommendation,
    TriageRunResponse,
    TriageRunSource,
    TriageRunStatus,
    TriageTaskType,
    UserSettings,
    WorkType,
)

logger = logging.getLogger(__name__)

INBOX_BUCKET_KEY = "inbox"
INBOX_BUCKET_TITLE = "Inbox"
AI_DELTA_MIN = Decimal("-15.00")
AI_DELTA_MAX = Decimal("15.00")
ACTIVE_STATUSES = [TaskStatus.PENDING, TaskStatus.IN_PROGRESS]
UNDATED_REGULAR_TASK_SPREAD_WEEKS = 12


@dataclass
class TriageCandidate:
    """Internal representation of one schedulable task-like item."""

    identifier: str
    item_type: TriageTaskType
    task_id: UUID | None
    quick_task_id: UUID | None
    title: str
    description: str | None
    project_id: UUID | None
    project_title: str | None
    goal_id: UUID | None
    goal_title: str | None
    status: TaskStatus
    priority: int
    work_type: WorkType
    estimate_hours: Decimal
    remaining_hours: Decimal
    capacity_load_hours: Decimal
    due_date: datetime | None
    bucket_key: str
    bucket_title: str
    deterministic_score: Decimal
    reason_codes: list[str]
    snapshot: dict[str, Any]


@dataclass
class AiAdjustment:
    """Bounded AI rank adjustment for one candidate."""

    delta: Decimal
    reason: str | None


@dataclass
class CapacityLoad:
    """Weekly load a candidate contributes to triage capacity."""

    hours: Decimal
    reason_code: str
    spread_weeks: int


class TriageService:
    """Generate and apply capacity triage recommendations."""

    def get_or_create_settings(
        self, session: Session, user_id: str | UUID
    ) -> TriageCapacitySettings:
        user_uuid = UUID(str(user_id))
        settings = session.exec(
            select(TriageCapacitySettings).where(
                TriageCapacitySettings.user_id == user_uuid
            )
        ).first()
        if settings:
            return settings

        settings = TriageCapacitySettings(user_id=user_uuid)
        session.add(settings)
        session.commit()
        session.refresh(settings)
        return settings

    def get_settings_response(
        self, session: Session, user_id: str | UUID
    ) -> TriageCapacitySettingsResponse:
        return self._settings_response(self.get_or_create_settings(session, user_id))

    def update_settings(
        self,
        session: Session,
        user_id: str | UUID,
        data: TriageCapacitySettingsUpdate,
    ) -> TriageCapacitySettingsResponse:
        self._validate_settings(data)
        project_allocations = self._normalize_project_allocations(
            data.project_allocations
        )
        settings = self.get_or_create_settings(session, user_id)
        settings.weekly_capacity_hours = self._decimal(data.weekly_capacity_hours)
        settings.meeting_buffer_hours = self._decimal(data.meeting_buffer_hours)
        settings.project_allocations_json = project_allocations
        settings.inbox_allocation_percent = data.inbox_allocation_percent
        settings.work_type_caps_json = dict(data.work_type_caps)
        settings.cadence_days = data.cadence_days
        settings.auto_generate_enabled = data.auto_generate_enabled
        settings.use_ai_rank_adjustment = data.use_ai_rank_adjustment
        settings.updated_at = datetime.now(UTC)
        session.add(settings)
        session.commit()
        session.refresh(settings)
        return self._settings_response(settings)

    def create_run(
        self,
        session: Session,
        user_id: str | UUID,
        source: TriageRunSource = TriageRunSource.MANUAL,
        use_ai_rank_adjustment: bool | None = None,
    ) -> TriageRunResponse:
        user_uuid = UUID(str(user_id))
        settings = self.get_or_create_settings(session, user_uuid)
        candidates = self.collect_candidates(session, user_uuid)
        use_ai = (
            settings.use_ai_rank_adjustment
            if use_ai_rank_adjustment is None
            else use_ai_rank_adjustment
        )
        ai_adjustments = (
            self._get_ai_adjustments(session, user_uuid, candidates) if use_ai else {}
        )

        selected_items = self._select_with_capacity(
            settings, candidates, ai_adjustments
        )
        summary = self._build_summary(settings, selected_items)

        run = TaskTriageRun(user_id=user_uuid, source=source, summary_json=summary)
        session.add(run)
        session.flush()

        for candidate, recommendation, ai_adjustment, reason_codes in selected_items:
            item = TaskTriageItem(
                run_id=run.id,
                task_id=candidate.task_id,
                quick_task_id=candidate.quick_task_id,
                item_type=candidate.item_type,
                title=candidate.title,
                description=candidate.description,
                project_id=candidate.project_id,
                project_title=candidate.project_title,
                goal_id=candidate.goal_id,
                goal_title=candidate.goal_title,
                status_at_generation=candidate.status,
                priority=candidate.priority,
                work_type=candidate.work_type,
                estimate_hours=candidate.estimate_hours,
                remaining_hours=candidate.remaining_hours,
                due_date=candidate.due_date,
                bucket_key=candidate.bucket_key,
                bucket_title=candidate.bucket_title,
                deterministic_score=candidate.deterministic_score,
                ai_score_delta=ai_adjustment.delta,
                ai_reason=ai_adjustment.reason,
                final_score=self._decimal(
                    candidate.deterministic_score + ai_adjustment.delta
                ),
                reason_codes_json=reason_codes,
                task_snapshot_json=candidate.snapshot,
                recommendation=recommendation,
            )
            session.add(item)

        if source == TriageRunSource.SCHEDULED:
            settings.last_auto_triage_at = datetime.now(UTC)
            settings.updated_at = datetime.now(UTC)
            session.add(settings)

        session.commit()
        session.refresh(run)
        return self.get_run_response(session, user_uuid, run.id)

    def collect_candidates(
        self, session: Session, user_id: str | UUID
    ) -> list[TriageCandidate]:
        user_uuid = UUID(str(user_id))
        actual_hours = self._get_actual_hours_map(session, user_uuid)
        candidates: list[TriageCandidate] = []

        regular_rows = session.exec(
            select(Task, Goal, Project)
            .join(Goal, Task.goal_id == Goal.id)
            .join(Project, Goal.project_id == Project.id)
            .where(
                Project.owner_id == user_uuid,
                col(Task.status).in_(ACTIVE_STATUSES),
            )
        ).all()

        for task, goal, project in regular_rows:
            task_id = UUID(str(task.id))
            estimate = self._decimal(task.estimate_hours)
            remaining = max(
                Decimal("0.00"),
                self._decimal(estimate - actual_hours.get(task_id, Decimal("0.00"))),
            )
            capacity_load = self._capacity_load_hours(
                remaining,
                task.due_date,
                TriageTaskType.TASK,
            )
            score, reasons = self._score_candidate(
                status=task.status,
                priority=task.priority,
                remaining_hours=remaining,
                due_date=task.due_date,
            )
            reasons.append(capacity_load.reason_code)
            candidates.append(
                TriageCandidate(
                    identifier=f"task:{task_id}",
                    item_type=TriageTaskType.TASK,
                    task_id=task_id,
                    quick_task_id=None,
                    title=task.title,
                    description=task.description,
                    project_id=UUID(str(project.id)),
                    project_title=project.title,
                    goal_id=UUID(str(goal.id)),
                    goal_title=goal.title,
                    status=task.status,
                    priority=task.priority,
                    work_type=task.work_type,
                    estimate_hours=estimate,
                    remaining_hours=remaining,
                    capacity_load_hours=capacity_load.hours,
                    due_date=task.due_date,
                    bucket_key=f"project:{project.id}",
                    bucket_title=project.title,
                    deterministic_score=score,
                    reason_codes=reasons,
                    snapshot=self._snapshot_task(task, remaining, capacity_load),
                )
            )

        quick_tasks = session.exec(
            select(QuickTask).where(
                QuickTask.owner_id == user_uuid,
                col(QuickTask.status).in_(ACTIVE_STATUSES),
            )
        ).all()
        for quick_task in quick_tasks:
            quick_task_id = UUID(str(quick_task.id))
            remaining = self._decimal(quick_task.estimate_hours)
            capacity_load = self._capacity_load_hours(
                remaining,
                quick_task.due_date,
                TriageTaskType.QUICK_TASK,
            )
            score, reasons = self._score_candidate(
                status=quick_task.status,
                priority=quick_task.priority,
                remaining_hours=remaining,
                due_date=quick_task.due_date,
            )
            reasons.append(capacity_load.reason_code)
            candidates.append(
                TriageCandidate(
                    identifier=f"quick_task:{quick_task_id}",
                    item_type=TriageTaskType.QUICK_TASK,
                    task_id=None,
                    quick_task_id=quick_task_id,
                    title=quick_task.title,
                    description=quick_task.description,
                    project_id=None,
                    project_title=None,
                    goal_id=None,
                    goal_title=None,
                    status=quick_task.status,
                    priority=quick_task.priority,
                    work_type=quick_task.work_type,
                    estimate_hours=self._decimal(quick_task.estimate_hours),
                    remaining_hours=remaining,
                    capacity_load_hours=capacity_load.hours,
                    due_date=quick_task.due_date,
                    bucket_key=INBOX_BUCKET_KEY,
                    bucket_title=INBOX_BUCKET_TITLE,
                    deterministic_score=score,
                    reason_codes=reasons,
                    snapshot=self._snapshot_quick_task(
                        quick_task, remaining, capacity_load
                    ),
                )
            )

        return candidates

    def get_latest_run_response(
        self, session: Session, user_id: str | UUID
    ) -> TriageRunResponse | None:
        user_uuid = UUID(str(user_id))
        run = session.exec(
            select(TaskTriageRun)
            .where(TaskTriageRun.user_id == user_uuid)
            .order_by(TaskTriageRun.created_at.desc())
            .limit(1)
        ).first()
        if not run:
            return None
        return self.get_run_response(session, user_uuid, run.id)

    def get_run_response(
        self, session: Session, user_id: str | UUID, run_id: str | UUID
    ) -> TriageRunResponse:
        run = self._get_run(session, user_id, run_id)
        items = session.exec(
            select(TaskTriageItem)
            .where(TaskTriageItem.run_id == run.id)
            .order_by(TaskTriageItem.final_score.desc(), TaskTriageItem.id.asc())
        ).all()
        return self._run_response(run, items)

    def override_item(
        self,
        session: Session,
        user_id: str | UUID,
        run_id: str | UUID,
        item_id: str | UUID,
        override: TriageRecommendation | None,
    ) -> TriageRunResponse:
        run = self._get_run(session, user_id, run_id)
        item = self._get_item(session, run.id, item_id)
        item.user_override = override
        item.updated_at = datetime.now(UTC)
        session.add(item)
        session.commit()
        return self.get_run_response(session, user_id, run.id)

    def apply_run(
        self,
        session: Session,
        user_id: str | UUID,
        run_id: str | UUID,
        item_ids: list[UUID] | None = None,
    ) -> TriageApplyResponse:
        run = self._get_run(session, user_id, run_id)
        statement = select(TaskTriageItem).where(TaskTriageItem.run_id == run.id)
        if item_ids is not None:
            statement = statement.where(col(TaskTriageItem.id).in_(item_ids))
        items = session.exec(statement).all()

        applied = 0
        skipped = 0
        failed = 0
        errors: list[str] = []
        now = datetime.now(UTC)

        for item in items:
            effective_action = item.user_override or item.recommendation
            if (
                item.applied_at is not None
                or effective_action != TriageRecommendation.CANCEL
            ):
                skipped += 1
                continue

            try:
                target = self._load_current_target(session, item)
                if target is None:
                    item.apply_error = "Target task no longer exists"
                    failed += 1
                    errors.append(f"{item.title}: target task no longer exists")
                    session.add(item)
                    continue

                if target.status != item.status_at_generation:
                    item.apply_error = f"Status changed from {item.status_at_generation} to {target.status}"
                    failed += 1
                    errors.append(f"{item.title}: {item.apply_error}")
                    session.add(item)
                    continue

                target.status = TaskStatus.CANCELLED
                target.updated_at = now
                item.applied_action = TriageRecommendation.CANCEL
                item.applied_at = now
                item.apply_error = None
                item.updated_at = now
                session.add(target)
                session.add(item)
                applied += 1
            except Exception as exc:  # pragma: no cover - defensive audit path
                item.apply_error = str(exc)
                item.updated_at = now
                session.add(item)
                failed += 1
                errors.append(f"{item.title}: {exc}")

        run.status = (
            TriageRunStatus.APPLIED
            if failed == 0
            else TriageRunStatus.PARTIALLY_APPLIED
        )
        run.updated_at = now
        session.add(run)
        session.commit()

        return TriageApplyResponse(
            success=failed == 0,
            run_id=UUID(str(run.id)),
            applied_count=applied,
            skipped_count=skipped,
            failed_count=failed,
            errors=errors,
        )

    def generate_due_scheduled_runs(self, session: Session) -> int:
        """Generate due scheduled suggestions without applying actions."""
        now = datetime.now(UTC)
        settings_rows = session.exec(
            select(TriageCapacitySettings).where(
                TriageCapacitySettings.auto_generate_enabled == True  # noqa: E712
            )
        ).all()
        generated_count = 0
        for settings in settings_rows:
            last_run_at = settings.last_auto_triage_at
            if last_run_at and last_run_at.tzinfo is None:
                last_run_at = last_run_at.replace(tzinfo=UTC)
            if (
                last_run_at
                and last_run_at + timedelta(days=settings.cadence_days) > now
            ):
                continue
            try:
                self.create_run(
                    session,
                    settings.user_id,
                    source=TriageRunSource.SCHEDULED,
                    use_ai_rank_adjustment=settings.use_ai_rank_adjustment,
                )
                generated_count += 1
            except Exception as exc:
                logger.error(
                    "Failed to generate scheduled triage for user %s: %s",
                    settings.user_id,
                    exc,
                )
                session.rollback()
        return generated_count

    def _validate_settings(self, data: TriageCapacitySettingsUpdate) -> None:
        project_allocations = self._normalize_project_allocations(
            data.project_allocations
        )
        for value in project_allocations.values():
            if value < 0 or value > 100:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Project allocation percentages must be between 0 and 100",
                )

        total = sum(project_allocations.values()) + data.inbox_allocation_percent
        if total != 100:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Project allocations plus Inbox allocation must total 100%",
            )
        if data.meeting_buffer_hours >= data.weekly_capacity_hours:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Meeting buffer must be smaller than weekly throughput",
            )
        for key, value in data.work_type_caps.items():
            if key not in {work_type.value for work_type in WorkType}:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid work type cap: {key}",
                )
            if value < 0:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Work type cap must be non-negative: {key}",
                )

    def _normalize_project_allocations(
        self, allocations: dict[str, int]
    ) -> dict[str, int]:
        normalized: dict[str, int] = {}
        for raw_key, value in allocations.items():
            project_id = str(raw_key)
            if project_id.startswith("project:"):
                project_id = project_id.removeprefix("project:")
            try:
                UUID(project_id)
            except ValueError as exc:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid project allocation key: {raw_key}",
                ) from exc
            normalized[project_id] = int(value)
        return normalized

    def _get_actual_hours_map(
        self, session: Session, user_id: UUID
    ) -> dict[UUID, Decimal]:
        task_ids = session.exec(
            select(Task.id)
            .join(Goal, Task.goal_id == Goal.id)
            .join(Project, Goal.project_id == Project.id)
            .where(Project.owner_id == user_id)
        ).all()
        if not task_ids:
            return {}

        rows = session.exec(
            select(Log.task_id, func.sum(Log.actual_minutes))
            .where(col(Log.task_id).in_(task_ids))
            .group_by(Log.task_id)
        ).all()
        return {
            UUID(str(task_id)): self._decimal(Decimal(int(total_minutes or 0)) / 60)
            for task_id, total_minutes in rows
        }

    def _score_candidate(
        self,
        status: TaskStatus,
        priority: int,
        remaining_hours: Decimal,
        due_date: datetime | None,
    ) -> tuple[Decimal, list[str]]:
        score = Decimal("0.00")
        reasons: list[str] = []

        priority_points = Decimal(6 - priority) * Decimal("10")
        score += priority_points
        reasons.append(f"priority_{priority}")

        if status == TaskStatus.IN_PROGRESS:
            score += Decimal("15")
            reasons.append("in_progress")

        if due_date:
            due = due_date
            if due.tzinfo is None:
                due = due.replace(tzinfo=UTC)
            days_until_due = (due.date() - datetime.now(UTC).date()).days
            if days_until_due < 0:
                score += Decimal("40")
                reasons.append("overdue")
            elif days_until_due <= 1:
                score += Decimal("35")
                reasons.append("due_soon")
            elif days_until_due <= 3:
                score += Decimal("28")
                reasons.append("due_this_week")
            elif days_until_due <= 7:
                score += Decimal("20")
                reasons.append("due_within_7_days")
            elif days_until_due <= 14:
                score += Decimal("10")
                reasons.append("due_within_14_days")

        if remaining_hours <= Decimal("2.00"):
            score += Decimal("12")
            reasons.append("small_task")
        elif remaining_hours <= Decimal("4.00"):
            score += Decimal("8")
            reasons.append("medium_small_task")
        elif remaining_hours >= Decimal("12.00"):
            score -= Decimal("8")
            reasons.append("large_task")

        return self._decimal(score), reasons

    def _get_ai_adjustments(
        self,
        session: Session,
        user_id: UUID,
        candidates: list[TriageCandidate],
    ) -> dict[str, AiAdjustment]:
        user_settings = session.exec(
            select(UserSettings).where(UserSettings.user_id == user_id)
        ).first()
        if not user_settings or not user_settings.openai_api_key_encrypted:
            return {}

        try:
            api_key = get_crypto_service().decrypt(
                user_settings.openai_api_key_encrypted
            )
            if not api_key:
                return {}

            client = OpenAI(api_key=api_key, timeout=20.0)
            candidate_payload = [
                {
                    "id": candidate.identifier,
                    "title": candidate.title,
                    "project": candidate.project_title or INBOX_BUCKET_TITLE,
                    "priority": candidate.priority,
                    "remaining_hours": float(candidate.remaining_hours),
                    "capacity_load_hours": float(candidate.capacity_load_hours),
                    "due_date": candidate.due_date.isoformat()
                    if candidate.due_date
                    else None,
                    "deterministic_score": float(candidate.deterministic_score),
                    "reasons": candidate.reason_codes,
                }
                for candidate in sorted(
                    candidates, key=lambda item: item.deterministic_score, reverse=True
                )[:120]
            ]
            response = client.chat.completions.create(
                model=user_settings.openai_model or "gpt-5",
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "Return compact JSON only. You may adjust task rank, "
                            "but you cannot choose actions. Use IDs exactly as provided."
                        ),
                    },
                    {
                        "role": "user",
                        "content": json.dumps(
                            {
                                "instruction": (
                                    "For each task that materially deserves a rank "
                                    "change, return delta between -15 and 15 and a "
                                    "short reason. Omit tasks with no meaningful change."
                                ),
                                "schema": {
                                    "adjustments": [
                                        {
                                            "id": "task:<uuid> or quick_task:<uuid>",
                                            "delta": "number -15..15",
                                            "reason": "short string",
                                        }
                                    ]
                                },
                                "tasks": candidate_payload,
                            },
                            ensure_ascii=False,
                        ),
                    },
                ],
                response_format={"type": "json_object"},
                max_completion_tokens=900,
            )
            content = response.choices[0].message.content or "{}"
            payload = json.loads(content)
            valid_ids = {candidate.identifier for candidate in candidates}
            adjustments: dict[str, AiAdjustment] = {}
            for raw_adjustment in payload.get("adjustments", []):
                identifier = raw_adjustment.get("id")
                if identifier not in valid_ids:
                    continue
                raw_delta = raw_adjustment.get("delta", 0)
                delta = self._clip_ai_delta(self._decimal(Decimal(str(raw_delta))))
                reason = raw_adjustment.get("reason")
                adjustments[identifier] = AiAdjustment(
                    delta=delta,
                    reason=str(reason)[:1000] if reason else None,
                )
            return adjustments
        except Exception as exc:
            logger.warning(
                "AI triage adjustment failed; using deterministic scores: %s", exc
            )
            return {}

    def _select_with_capacity(
        self,
        settings: TriageCapacitySettings,
        candidates: list[TriageCandidate],
        ai_adjustments: dict[str, AiAdjustment],
    ) -> list[tuple[TriageCandidate, TriageRecommendation, AiAdjustment, list[str]]]:
        effective_capacity = max(
            Decimal("0.00"),
            self._decimal(
                settings.weekly_capacity_hours - settings.meeting_buffer_hours
            ),
        )
        bucket_budgets = self._build_bucket_budgets(
            settings, candidates, effective_capacity
        )
        work_type_remaining = {
            key: self._decimal(Decimal(str(value)))
            for key, value in settings.work_type_caps_json.items()
            if value is not None
        }
        bucket_remaining = dict(bucket_budgets)
        selected: list[
            tuple[TriageCandidate, TriageRecommendation, AiAdjustment, list[str]]
        ] = []

        def final_score(candidate: TriageCandidate) -> Decimal:
            return self._decimal(
                candidate.deterministic_score
                + ai_adjustments.get(
                    candidate.identifier, AiAdjustment(Decimal("0"), None)
                ).delta
            )

        for candidate in sorted(
            candidates,
            key=lambda item: (final_score(item), -float(item.capacity_load_hours)),
            reverse=True,
        ):
            ai_adjustment = ai_adjustments.get(
                candidate.identifier, AiAdjustment(Decimal("0.00"), None)
            )
            reasons = list(candidate.reason_codes)
            hours = candidate.capacity_load_hours
            bucket_available = bucket_remaining.get(
                candidate.bucket_key, Decimal("0.00")
            )
            work_cap_available = work_type_remaining.get(candidate.work_type.value)

            over_bucket = hours > bucket_available
            over_work_type = (
                work_cap_available is not None and hours > work_cap_available
            )
            if hours == Decimal("0.00"):
                recommendation = TriageRecommendation.KEEP
                reasons.append("no_remaining_hours")
            elif over_bucket or over_work_type:
                recommendation = TriageRecommendation.CANCEL
                if over_bucket:
                    reasons.append("over_bucket_capacity")
                if over_work_type:
                    reasons.append("over_work_type_cap")
            else:
                recommendation = TriageRecommendation.KEEP
                reasons.append("within_capacity")
                bucket_remaining[candidate.bucket_key] = self._decimal(
                    bucket_available - hours
                )
                if work_cap_available is not None:
                    work_type_remaining[candidate.work_type.value] = self._decimal(
                        work_cap_available - hours
                    )

            selected.append((candidate, recommendation, ai_adjustment, reasons))

        return selected

    def _build_bucket_budgets(
        self,
        settings: TriageCapacitySettings,
        candidates: list[TriageCandidate],
        effective_capacity: Decimal,
    ) -> dict[str, Decimal]:
        configured_total = (
            sum(int(value) for value in settings.project_allocations_json.values())
            + settings.inbox_allocation_percent
        )
        if configured_total > 0:
            budgets = {
                f"project:{project_id}": self._percent_hours(
                    effective_capacity, percent
                )
                for project_id, percent in settings.project_allocations_json.items()
            }
            budgets[INBOX_BUCKET_KEY] = self._percent_hours(
                effective_capacity, settings.inbox_allocation_percent
            )
            return budgets

        active_buckets = sorted({candidate.bucket_key for candidate in candidates})
        if not active_buckets:
            return {}
        equal_budget = self._decimal(effective_capacity / Decimal(len(active_buckets)))
        budgets = dict.fromkeys(active_buckets, equal_budget)
        rounding_remainder = self._decimal(
            effective_capacity - sum(budgets.values(), Decimal("0.00"))
        )
        if rounding_remainder and active_buckets:
            budgets[active_buckets[0]] = self._decimal(
                budgets[active_buckets[0]] + rounding_remainder
            )
        return budgets

    def _build_summary(
        self,
        settings: TriageCapacitySettings,
        selected_items: list[
            tuple[TriageCandidate, TriageRecommendation, AiAdjustment, list[str]]
        ],
    ) -> dict[str, Any]:
        total_remaining = sum(
            (candidate.remaining_hours for candidate, *_ in selected_items),
            Decimal("0.00"),
        )
        kept_hours = sum(
            (
                candidate.remaining_hours
                for candidate, recommendation, *_ in selected_items
                if recommendation == TriageRecommendation.KEEP
            ),
            Decimal("0.00"),
        )
        cancel_hours = sum(
            (
                candidate.remaining_hours
                for candidate, recommendation, *_ in selected_items
                if recommendation == TriageRecommendation.CANCEL
            ),
            Decimal("0.00"),
        )
        total_capacity_load = sum(
            (candidate.capacity_load_hours for candidate, *_ in selected_items),
            Decimal("0.00"),
        )
        kept_capacity_load = sum(
            (
                candidate.capacity_load_hours
                for candidate, recommendation, *_ in selected_items
                if recommendation == TriageRecommendation.KEEP
            ),
            Decimal("0.00"),
        )
        cancel_capacity_load = sum(
            (
                candidate.capacity_load_hours
                for candidate, recommendation, *_ in selected_items
                if recommendation == TriageRecommendation.CANCEL
            ),
            Decimal("0.00"),
        )
        effective_capacity = max(
            Decimal("0.00"),
            self._decimal(
                settings.weekly_capacity_hours - settings.meeting_buffer_hours
            ),
        )
        bucket_summary: dict[str, dict[str, Any]] = {}
        for candidate, recommendation, *_ in selected_items:
            bucket = bucket_summary.setdefault(
                candidate.bucket_key,
                {
                    "title": candidate.bucket_title,
                    "total_hours": 0.0,
                    "kept_hours": 0.0,
                    "cancel_hours": 0.0,
                    "total_capacity_load_hours": 0.0,
                    "kept_capacity_load_hours": 0.0,
                    "cancel_capacity_load_hours": 0.0,
                    "total_items": 0,
                    "cancel_items": 0,
                },
            )
            hours = float(candidate.remaining_hours)
            capacity_load_hours = float(candidate.capacity_load_hours)
            bucket["total_hours"] += hours
            bucket["total_capacity_load_hours"] += capacity_load_hours
            bucket["total_items"] += 1
            if recommendation == TriageRecommendation.CANCEL:
                bucket["cancel_hours"] += hours
                bucket["cancel_capacity_load_hours"] += capacity_load_hours
                bucket["cancel_items"] += 1
            else:
                bucket["kept_hours"] += hours
                bucket["kept_capacity_load_hours"] += capacity_load_hours

        return {
            "weekly_capacity_hours": float(settings.weekly_capacity_hours),
            "meeting_buffer_hours": float(settings.meeting_buffer_hours),
            "effective_capacity_hours": float(effective_capacity),
            "total_capacity_load_hours": float(self._decimal(total_capacity_load)),
            "kept_capacity_load_hours": float(self._decimal(kept_capacity_load)),
            "cancel_candidate_capacity_load_hours": float(
                self._decimal(cancel_capacity_load)
            ),
            "total_remaining_hours": float(self._decimal(total_remaining)),
            "kept_hours": float(self._decimal(kept_hours)),
            "cancel_candidate_hours": float(self._decimal(cancel_hours)),
            "overflow_hours": float(
                max(
                    Decimal("0.00"),
                    self._decimal(total_capacity_load - effective_capacity),
                )
            ),
            "capacity_overflow_hours": float(
                max(
                    Decimal("0.00"),
                    self._decimal(total_capacity_load - effective_capacity),
                )
            ),
            "total_items": len(selected_items),
            "keep_items": sum(
                1
                for _, recommendation, *_ in selected_items
                if recommendation == TriageRecommendation.KEEP
            ),
            "cancel_candidate_items": sum(
                1
                for _, recommendation, *_ in selected_items
                if recommendation == TriageRecommendation.CANCEL
            ),
            "buckets": bucket_summary,
        }

    def _load_current_target(
        self, session: Session, item: TaskTriageItem
    ) -> Task | QuickTask | None:
        if item.item_type == TriageTaskType.TASK and item.task_id:
            return session.get(Task, item.task_id)
        if item.item_type == TriageTaskType.QUICK_TASK and item.quick_task_id:
            return session.get(QuickTask, item.quick_task_id)
        return None

    def _get_run(
        self, session: Session, user_id: str | UUID, run_id: str | UUID
    ) -> TaskTriageRun:
        run = session.exec(
            select(TaskTriageRun).where(
                TaskTriageRun.id == UUID(str(run_id)),
                TaskTriageRun.user_id == UUID(str(user_id)),
            )
        ).first()
        if not run:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Triage run not found"
            )
        return run

    def _get_item(
        self, session: Session, run_id: UUID, item_id: str | UUID
    ) -> TaskTriageItem:
        item = session.exec(
            select(TaskTriageItem).where(
                TaskTriageItem.id == UUID(str(item_id)),
                TaskTriageItem.run_id == run_id,
            )
        ).first()
        if not item:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Triage item not found"
            )
        return item

    def _settings_response(
        self, settings: TriageCapacitySettings
    ) -> TriageCapacitySettingsResponse:
        return TriageCapacitySettingsResponse(
            id=settings.id,
            user_id=settings.user_id,
            weekly_capacity_hours=settings.weekly_capacity_hours,
            meeting_buffer_hours=settings.meeting_buffer_hours,
            project_allocations={
                str(key): int(value)
                for key, value in settings.project_allocations_json.items()
            },
            inbox_allocation_percent=settings.inbox_allocation_percent,
            work_type_caps={
                str(key): float(value)
                for key, value in settings.work_type_caps_json.items()
            },
            cadence_days=settings.cadence_days,
            auto_generate_enabled=settings.auto_generate_enabled,
            use_ai_rank_adjustment=settings.use_ai_rank_adjustment,
            last_auto_triage_at=settings.last_auto_triage_at,
            created_at=settings.created_at,
            updated_at=settings.updated_at,
        )

    def _run_response(
        self, run: TaskTriageRun, items: list[TaskTriageItem]
    ) -> TriageRunResponse:
        return TriageRunResponse(
            id=run.id,
            user_id=run.user_id,
            source=run.source,
            status=run.status,
            summary=run.summary_json,
            created_at=run.created_at,
            updated_at=run.updated_at,
            items=[self._item_response(item) for item in items],
        )

    def _item_response(self, item: TaskTriageItem) -> TriageItemResponse:
        return TriageItemResponse(
            id=item.id,
            run_id=item.run_id,
            task_id=item.task_id,
            quick_task_id=item.quick_task_id,
            item_type=item.item_type,
            title=item.title,
            description=item.description,
            project_id=item.project_id,
            project_title=item.project_title,
            goal_id=item.goal_id,
            goal_title=item.goal_title,
            status_at_generation=item.status_at_generation,
            priority=item.priority,
            work_type=item.work_type,
            estimate_hours=item.estimate_hours,
            remaining_hours=item.remaining_hours,
            capacity_load_hours=self._decimal(
                Decimal(
                    str(
                        (item.task_snapshot_json or {}).get(
                            "capacity_load_hours", item.remaining_hours
                        )
                    )
                )
            ),
            due_date=item.due_date,
            bucket_key=item.bucket_key,
            bucket_title=item.bucket_title,
            deterministic_score=item.deterministic_score,
            ai_score_delta=item.ai_score_delta,
            ai_reason=item.ai_reason,
            final_score=item.final_score,
            reason_codes=item.reason_codes_json,
            task_snapshot=item.task_snapshot_json,
            recommendation=item.recommendation,
            user_override=item.user_override,
            applied_action=item.applied_action,
            applied_at=item.applied_at,
            apply_error=item.apply_error,
            created_at=item.created_at,
            updated_at=item.updated_at,
        )

    def _capacity_load_hours(
        self,
        remaining_hours: Decimal,
        due_date: datetime | None,
        item_type: TriageTaskType,
    ) -> CapacityLoad:
        if remaining_hours <= Decimal("0.00"):
            return CapacityLoad(
                hours=Decimal("0.00"),
                reason_code="no_remaining_capacity_load",
                spread_weeks=1,
            )

        if item_type == TriageTaskType.QUICK_TASK:
            return CapacityLoad(
                hours=remaining_hours,
                reason_code="quick_task_full_capacity_load",
                spread_weeks=1,
            )

        if due_date is None:
            return CapacityLoad(
                hours=self._decimal(
                    remaining_hours / Decimal(UNDATED_REGULAR_TASK_SPREAD_WEEKS)
                ),
                reason_code=f"undated_spread_{UNDATED_REGULAR_TASK_SPREAD_WEEKS}_weeks",
                spread_weeks=UNDATED_REGULAR_TASK_SPREAD_WEEKS,
            )

        due = due_date
        if due.tzinfo is None:
            due = due.replace(tzinfo=UTC)
        days_until_due = (due.date() - datetime.now(UTC).date()).days
        if days_until_due < 0:
            return CapacityLoad(
                hours=remaining_hours,
                reason_code="overdue_full_capacity_load",
                spread_weeks=1,
            )
        if days_until_due <= 7:
            return CapacityLoad(
                hours=remaining_hours,
                reason_code="due_within_7_days_full_capacity_load",
                spread_weeks=1,
            )

        spread_weeks = max(1, (days_until_due + 6) // 7)
        return CapacityLoad(
            hours=self._decimal(remaining_hours / Decimal(spread_weeks)),
            reason_code="spread_to_due_date_capacity_load",
            spread_weeks=spread_weeks,
        )

    def _snapshot_task(
        self, task: Task, remaining_hours: Decimal, capacity_load: CapacityLoad
    ) -> dict[str, Any]:
        return {
            "id": str(task.id),
            "title": task.title,
            "description": task.description,
            "estimate_hours": float(task.estimate_hours),
            "remaining_hours": float(remaining_hours),
            "capacity_load_hours": float(capacity_load.hours),
            "capacity_load_reason": capacity_load.reason_code,
            "capacity_load_spread_weeks": capacity_load.spread_weeks,
            "due_date": task.due_date.isoformat() if task.due_date else None,
            "status": task.status,
            "priority": task.priority,
            "work_type": task.work_type,
            "goal_id": str(task.goal_id),
        }

    def _snapshot_quick_task(
        self, task: QuickTask, remaining_hours: Decimal, capacity_load: CapacityLoad
    ) -> dict[str, Any]:
        return {
            "id": str(task.id),
            "title": task.title,
            "description": task.description,
            "estimate_hours": float(task.estimate_hours),
            "remaining_hours": float(remaining_hours),
            "capacity_load_hours": float(capacity_load.hours),
            "capacity_load_reason": capacity_load.reason_code,
            "capacity_load_spread_weeks": capacity_load.spread_weeks,
            "due_date": task.due_date.isoformat() if task.due_date else None,
            "status": task.status,
            "priority": task.priority,
            "work_type": task.work_type,
        }

    def _percent_hours(self, total_hours: Decimal, percent: int | float) -> Decimal:
        return self._decimal(total_hours * Decimal(str(percent)) / Decimal("100"))

    def _clip_ai_delta(self, value: Decimal) -> Decimal:
        return min(AI_DELTA_MAX, max(AI_DELTA_MIN, value))

    def _decimal(self, value: Decimal | int | float | str) -> Decimal:
        return Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


triage_service = TriageService()
