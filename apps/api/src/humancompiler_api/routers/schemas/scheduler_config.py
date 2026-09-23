# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

"""Solver parameter overrides shared by the daily scheduling endpoints."""

from dataclasses import fields
from typing import Any

from humancompiler_scheduler.human import (
    HumanDailySolverConfig,
    human_daily_solver_config_from_dict,
)
from pydantic import BaseModel, ConfigDict, Field, model_validator


class SchedulerSolverConfigInput(BaseModel):
    """Optional Human daily solver config override."""

    kind_match_score: int | None = Field(None, ge=0, le=30)
    kind_mismatch_score: int | None = Field(None, ge=0, le=30)
    priority_score_base: int | None = Field(None, ge=1, le=20)
    deadline_soon_days: int | None = Field(None, ge=0, le=14)
    deadline_score: int | None = Field(None, ge=0, le=30)
    overdue_score: int | None = Field(None, ge=0, le=80)
    fixed_assignment_score: int | None = Field(None, ge=0, le=200)
    dependency_unlock_score: int | None = Field(None, ge=0, le=30)
    min_block_minutes: int | None = Field(None, ge=1, le=120)
    block_granularity_minutes: int | None = Field(None, ge=1, le=60)
    max_candidate_block_minutes: int | None = Field(None, ge=1, le=480)
    project_switch_penalty: int | None = Field(None, ge=0, le=30)
    project_switch_reset_gap_minutes: int | None = Field(None, ge=0, le=180)
    long_continuous_threshold_minutes: int | None = Field(None, ge=0, le=360)
    long_continuous_penalty: int | None = Field(None, ge=0, le=40)
    break_reset_gap_minutes: int | None = Field(None, ge=0, le=180)
    small_gap_minutes: int | None = Field(None, ge=0, le=120)
    small_gap_fill_score: int | None = Field(None, ge=0, le=30)

    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def validate_block_candidate_settings(self) -> "SchedulerSolverConfigInput":
        min_block = self.min_block_minutes if self.min_block_minutes is not None else 15
        if (
            self.max_candidate_block_minutes is not None
            and self.max_candidate_block_minutes < min_block
        ):
            raise ValueError(
                "max_candidate_block_minutes must be at least min_block_minutes"
            )
        return self


def human_solver_config_to_dict(config: HumanDailySolverConfig) -> dict[str, int]:
    return {field.name: int(getattr(config, field.name)) for field in fields(config)}


def coerce_human_solver_config(
    config: SchedulerSolverConfigInput | HumanDailySolverConfig | dict[str, Any] | None,
) -> HumanDailySolverConfig:
    if isinstance(config, HumanDailySolverConfig):
        return config

    defaults = human_solver_config_to_dict(HumanDailySolverConfig())
    if config is None:
        return HumanDailySolverConfig()

    if isinstance(config, SchedulerSolverConfigInput):
        overrides = config.model_dump(exclude_none=True)
    else:
        overrides = {key: value for key, value in config.items() if value is not None}
    return human_daily_solver_config_from_dict({**defaults, **overrides})
