"""
Reschedule Service for checkout-based rescheduling (Issue #227)

This module provides services for generating and managing reschedule suggestions
based on checkout data (actual work time vs estimates).
"""

from dataclasses import dataclass
from datetime import datetime, timedelta, UTC
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

from fastapi import HTTPException, status
from sqlmodel import Session, select

from humancompiler_api.common.error_handlers import validate_uuid
from humancompiler_api.models import (
    RescheduleSuggestion,
    RescheduleSuggestionStatus,
    RescheduleTriggerType,
    RescheduleDecision,
    Schedule,
    Task,
    WorkSession,
    SessionDecision,
)


@dataclass
class ScheduleDiffItem:
    """Individual diff item in a schedule change"""

    task_id: str
    task_title: str
    change_type: Literal["pushed", "added", "removed", "reordered"]
    original_slot_index: int | None
    new_slot_index: int | None
    reason: str

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for JSON serialization"""
        return {
            "task_id": self.task_id,
            "task_title": self.task_title,
            "change_type": self.change_type,
            "original_slot_index": self.original_slot_index,
            "new_slot_index": self.new_slot_index,
            "reason": self.reason,
        }


@dataclass
class ScheduleDiff:
    """Schedule diff between original and proposed schedules"""

    pushed_tasks: list[ScheduleDiffItem]
    added_tasks: list[ScheduleDiffItem]
    removed_tasks: list[ScheduleDiffItem]
    reordered_tasks: list[ScheduleDiffItem]

    @property
    def total_changes(self) -> int:
        """Total number of changes"""
        return (
            len(self.pushed_tasks)
            + len(self.added_tasks)
            + len(self.removed_tasks)
            + len(self.reordered_tasks)
        )

    @property
    def has_significant_changes(self) -> bool:
        """Whether there are significant changes (any changes at all)"""
        return self.total_changes > 0

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for JSON serialization"""
        return {
            "pushed_tasks": [item.to_dict() for item in self.pushed_tasks],
            "added_tasks": [item.to_dict() for item in self.added_tasks],
            "removed_tasks": [item.to_dict() for item in self.removed_tasks],
            "reordered_tasks": [item.to_dict() for item in self.reordered_tasks],
            "total_changes": self.total_changes,
            "has_significant_changes": self.has_significant_changes,
        }


class RescheduleService:
    """Service for managing reschedule suggestions"""

    def compute_schedule_diff(
        self,
        original_schedule: list[dict[str, Any]],
        proposed_schedule: list[dict[str, Any]],
        task_lookup: dict[str, str] | None = None,
    ) -> ScheduleDiff:
        """
        Compute the diff between original and proposed schedules.

        Args:
            original_schedule: List of original slot items (with task_id)
            proposed_schedule: List of proposed slot items (with task_id)
            task_lookup: Optional dict mapping task_id to task_title

        Returns:
            ScheduleDiff with categorized changes
        """
        if task_lookup is None:
            task_lookup = {}

        # Build index maps for both schedules
        original_task_map: dict[str, int] = {}
        proposed_task_map: dict[str, int] = {}

        for idx, slot in enumerate(original_schedule):
            task_id = slot.get("task_id") or slot.get("taskId")
            if task_id:
                original_task_map[task_id] = idx

        for idx, slot in enumerate(proposed_schedule):
            task_id = slot.get("task_id") or slot.get("taskId")
            if task_id:
                proposed_task_map[task_id] = idx

        pushed_tasks: list[ScheduleDiffItem] = []
        added_tasks: list[ScheduleDiffItem] = []
        removed_tasks: list[ScheduleDiffItem] = []
        reordered_tasks: list[ScheduleDiffItem] = []

        # Check each original task
        for task_id, orig_idx in original_task_map.items():
            task_title = task_lookup.get(task_id, task_id)

            if task_id not in proposed_task_map:
                # Task removed/deferred
                removed_tasks.append(
                    ScheduleDiffItem(
                        task_id=task_id,
                        task_title=task_title,
                        change_type="removed",
                        original_slot_index=orig_idx,
                        new_slot_index=None,
                        reason="Time exceeded - deferred to later",
                    )
                )
            else:
                new_idx = proposed_task_map[task_id]
                if new_idx > orig_idx:
                    # Task pushed back
                    pushed_tasks.append(
                        ScheduleDiffItem(
                            task_id=task_id,
                            task_title=task_title,
                            change_type="pushed",
                            original_slot_index=orig_idx,
                            new_slot_index=new_idx,
                            reason="Pushed back due to earlier task overrun",
                        )
                    )
                elif new_idx < orig_idx:
                    # Task moved earlier (reordered)
                    reordered_tasks.append(
                        ScheduleDiffItem(
                            task_id=task_id,
                            task_title=task_title,
                            change_type="reordered",
                            original_slot_index=orig_idx,
                            new_slot_index=new_idx,
                            reason="Moved earlier in schedule",
                        )
                    )

        # Check for added tasks
        for task_id, new_idx in proposed_task_map.items():
            if task_id not in original_task_map:
                task_title = task_lookup.get(task_id, task_id)
                added_tasks.append(
                    ScheduleDiffItem(
                        task_id=task_id,
                        task_title=task_title,
                        change_type="added",
                        original_slot_index=None,
                        new_slot_index=new_idx,
                        reason="Added to fill available time",
                    )
                )

        return ScheduleDiff(
            pushed_tasks=pushed_tasks,
            added_tasks=added_tasks,
            removed_tasks=removed_tasks,
            reordered_tasks=reordered_tasks,
        )

    def get_today_schedule(self, session: Session, user_id: UUID) -> Schedule | None:
        """Get today's schedule for the user"""
        today = datetime.now(UTC).date()
        today_start = datetime.combine(today, datetime.min.time()).replace(tzinfo=UTC)
        today_end = datetime.combine(today, datetime.max.time()).replace(tzinfo=UTC)

        statement = select(Schedule).where(
            Schedule.user_id == user_id,
            Schedule.date >= today_start,
            Schedule.date <= today_end,
        )
        return session.exec(statement).first()

    def generate_reschedule_suggestion(
        self,
        session: Session,
        work_session: WorkSession,
        remaining_estimate_hours: Decimal | None,
        decision: SessionDecision,
    ) -> RescheduleSuggestion | None:
        """
        Generate a reschedule suggestion based on checkout data.

        Args:
            session: Database session
            work_session: The work session being checked out
            remaining_estimate_hours: Updated remaining estimate from checkout
            decision: The checkout decision (continue/switch/break/complete)

        Returns:
            RescheduleSuggestion if changes are needed, None otherwise
        """
        user_id = work_session.user_id

        # Get today's schedule
        schedule = self.get_today_schedule(session, user_id)
        if not schedule or not schedule.plan_json:
            return None

        plan_json = schedule.plan_json
        # Use "assignments" key (standard format used by scheduler and UI)
        assignments = plan_json.get("assignments", [])
        if not assignments:
            return None

        # Extract task IDs and build lookup
        task_ids = [
            assignment.get("task_id") or assignment.get("taskId")
            for assignment in assignments
            if assignment.get("task_id") or assignment.get("taskId")
        ]

        if not task_ids:
            return None

        # Get task titles for better diff display
        task_lookup = self._build_task_lookup(session, task_ids)

        # Calculate the impact of the checkout
        original_schedule = [a.copy() for a in assignments]
        proposed_schedule = self._compute_proposed_schedule(
            slots=assignments,
            completed_task_id=str(work_session.task_id),
            remaining_estimate_hours=remaining_estimate_hours,
            decision=decision,
        )

        # Compute diff
        diff = self.compute_schedule_diff(
            original_schedule=original_schedule,
            proposed_schedule=proposed_schedule,
            task_lookup=task_lookup,
        )

        # Only create suggestion if there are significant changes
        if not diff.has_significant_changes:
            return None

        # Set expiration to end of today
        today = datetime.now(UTC).date()
        expires_at = datetime.combine(today, datetime.max.time()).replace(tzinfo=UTC)

        # Create the suggestion
        suggestion = RescheduleSuggestion(
            user_id=user_id,
            work_session_id=work_session.id,
            trigger_type=RescheduleTriggerType.CHECKOUT,
            trigger_decision=decision.value,
            original_schedule_json={"assignments": original_schedule},
            proposed_schedule_json={"assignments": proposed_schedule},
            diff_json=diff.to_dict(),
            status=RescheduleSuggestionStatus.PENDING,
            expires_at=expires_at,
        )

        session.add(suggestion)
        session.commit()
        session.refresh(suggestion)

        return suggestion

    def _build_task_lookup(
        self, session: Session, task_ids: list[str]
    ) -> dict[str, str]:
        """Build a mapping of task_id to task_title"""
        lookup: dict[str, str] = {}

        for task_id in task_ids:
            try:
                task_uuid = UUID(task_id)
                task = session.get(Task, task_uuid)
                if task:
                    lookup[task_id] = task.title
            except (ValueError, TypeError):
                continue

        return lookup

    def _compute_proposed_schedule(
        self,
        slots: list[dict[str, Any]],
        completed_task_id: str,
        remaining_estimate_hours: Decimal | None,
        decision: SessionDecision,
    ) -> list[dict[str, Any]]:
        """
        Compute the proposed schedule based on checkout data.

        This is a simplified implementation that:
        1. If task is completed (decision=COMPLETE), removes it from future slots
        2. If task continues, updates remaining estimate and may push other tasks
        3. If switching, keeps the current structure but may adjust based on overrun
        """
        proposed = []
        completed_task_found = False

        for slot in slots:
            slot_task_id = slot.get("task_id") or slot.get("taskId")

            if slot_task_id == completed_task_id:
                completed_task_found = True

                if decision == SessionDecision.COMPLETE:
                    # Task is done - remove from proposed schedule
                    # (not appending to proposed = task removed from remaining work)
                    pass
                elif decision == SessionDecision.CONTINUE:
                    # Task continues - update with remaining estimate
                    updated_slot = slot.copy()
                    if remaining_estimate_hours is not None:
                        updated_slot["remaining_hours"] = float(
                            remaining_estimate_hours
                        )
                    proposed.append(updated_slot)
                else:
                    # SWITCH or BREAK - keep as-is for now
                    proposed.append(slot.copy())
            else:
                # Other tasks - check if they need to be pushed
                if completed_task_found and decision == SessionDecision.CONTINUE:
                    # Tasks after a continued task may need adjustment
                    # For MVP, just keep them as-is but mark for potential reschedule
                    proposed.append(slot.copy())
                else:
                    proposed.append(slot.copy())

        return proposed

    def get_pending_suggestions(
        self, session: Session, user_id: str | UUID
    ) -> list[RescheduleSuggestion]:
        """Get all pending reschedule suggestions for a user"""
        user_id_validated = validate_uuid(user_id, "user_id")

        statement = (
            select(RescheduleSuggestion)
            .where(
                RescheduleSuggestion.user_id == user_id_validated,
                RescheduleSuggestion.status == RescheduleSuggestionStatus.PENDING,
            )
            .order_by(RescheduleSuggestion.created_at.desc())
        )

        return list(session.exec(statement).all())

    def get_suggestion_by_id(
        self, session: Session, suggestion_id: str | UUID, user_id: str | UUID
    ) -> RescheduleSuggestion | None:
        """Get a specific reschedule suggestion"""
        suggestion_id_validated = validate_uuid(suggestion_id, "suggestion_id")
        user_id_validated = validate_uuid(user_id, "user_id")

        statement = select(RescheduleSuggestion).where(
            RescheduleSuggestion.id == suggestion_id_validated,
            RescheduleSuggestion.user_id == user_id_validated,
        )
        return session.exec(statement).first()

    def accept_suggestion(
        self,
        session: Session,
        suggestion_id: str | UUID,
        user_id: str | UUID,
        reason: str | None = None,
    ) -> RescheduleSuggestion:
        """
        Accept a reschedule suggestion.

        This updates the suggestion status and creates a decision log.
        """
        suggestion = self.get_suggestion_by_id(session, suggestion_id, user_id)
        if not suggestion:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Reschedule suggestion not found",
            )

        if suggestion.status != RescheduleSuggestionStatus.PENDING:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Suggestion is already {suggestion.status.value}",
            )

        # Update suggestion status
        now = datetime.now(UTC)
        suggestion.status = RescheduleSuggestionStatus.ACCEPTED
        suggestion.decided_at = now

        # Create decision log
        decision = RescheduleDecision(
            suggestion_id=suggestion.id,
            user_id=suggestion.user_id,
            accepted=True,
            reason=reason,
            context_json={
                "trigger_type": suggestion.trigger_type.value,
                "trigger_decision": suggestion.trigger_decision,
            },
        )

        session.add(decision)
        session.commit()
        session.refresh(suggestion)

        # Apply the proposed schedule (update today's schedule)
        self._apply_proposed_schedule(session, suggestion)

        return suggestion

    def reject_suggestion(
        self,
        session: Session,
        suggestion_id: str | UUID,
        user_id: str | UUID,
        reason: str | None = None,
    ) -> RescheduleSuggestion:
        """
        Reject a reschedule suggestion.

        This updates the suggestion status and creates a decision log.
        """
        suggestion = self.get_suggestion_by_id(session, suggestion_id, user_id)
        if not suggestion:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Reschedule suggestion not found",
            )

        if suggestion.status != RescheduleSuggestionStatus.PENDING:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Suggestion is already {suggestion.status.value}",
            )

        # Update suggestion status
        now = datetime.now(UTC)
        suggestion.status = RescheduleSuggestionStatus.REJECTED
        suggestion.decided_at = now

        # Create decision log
        decision = RescheduleDecision(
            suggestion_id=suggestion.id,
            user_id=suggestion.user_id,
            accepted=False,
            reason=reason,
            context_json={
                "trigger_type": suggestion.trigger_type.value,
                "trigger_decision": suggestion.trigger_decision,
            },
        )

        session.add(decision)
        session.commit()
        session.refresh(suggestion)

        return suggestion

    def _apply_proposed_schedule(
        self, session: Session, suggestion: RescheduleSuggestion
    ) -> None:
        """Apply the proposed schedule to today's schedule"""
        schedule = self.get_today_schedule(session, suggestion.user_id)
        if not schedule:
            return

        # Update the schedule with proposed changes (use "assignments" key)
        proposed = suggestion.proposed_schedule_json
        if proposed and "assignments" in proposed:
            schedule.plan_json = {
                **schedule.plan_json,
                "assignments": proposed["assignments"],
            }
            schedule.updated_at = datetime.now(UTC)
            session.add(schedule)
            session.commit()

    def get_decision_history(
        self,
        session: Session,
        user_id: str | UUID,
        limit: int = 50,
    ) -> list[RescheduleDecision]:
        """Get reschedule decision history for learning analysis"""
        user_id_validated = validate_uuid(user_id, "user_id")

        statement = (
            select(RescheduleDecision)
            .where(RescheduleDecision.user_id == user_id_validated)
            .order_by(RescheduleDecision.created_at.desc())
            .limit(limit)
        )

        return list(session.exec(statement).all())

    def expire_old_suggestions(self, session: Session) -> int:
        """
        Expire suggestions past their expiration time.

        Returns the number of expired suggestions.
        """
        now = datetime.now(UTC)

        statement = select(RescheduleSuggestion).where(
            RescheduleSuggestion.status == RescheduleSuggestionStatus.PENDING,
            RescheduleSuggestion.expires_at.is_not(None),  # type: ignore[union-attr]
            RescheduleSuggestion.expires_at < now,  # type: ignore[operator]
        )

        suggestions = session.exec(statement).all()
        count = 0

        for suggestion in suggestions:
            suggestion.status = RescheduleSuggestionStatus.EXPIRED
            suggestion.decided_at = now
            session.add(suggestion)
            count += 1

        if count > 0:
            session.commit()

        return count


# Singleton instance
reschedule_service = RescheduleService()
