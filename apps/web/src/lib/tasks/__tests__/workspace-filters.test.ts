// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import {
  buildTaskWorkspaceFilters,
  DEFAULT_TASK_WORKSPACE_PRESET,
} from "../workspace-filters";

describe("task workspace filters", () => {
  it("uses Ready as the default workspace intent", () => {
    expect(DEFAULT_TASK_WORKSPACE_PRESET).toBe("ready");
  });

  it("defines Ready as actionable and not blocked", () => {
    const filters = buildTaskWorkspaceFilters({
      preset: "ready",
      page: 0,
      status: "",
      projectId: "",
      goalId: "",
      search: "",
    });

    expect(filters.status).toEqual(["pending", "in_progress"]);
    expect(filters.blocked).toBe(false);
    expect(filters.sortBy).toBe("priority");
  });

  it("keeps blocked and cancelled-prerequisite tasks in the blocked view", () => {
    const filters = buildTaskWorkspaceFilters({
      preset: "blocked",
      page: 0,
      status: "",
      projectId: "project-1",
      goalId: "",
      search: "publish",
    });

    expect(filters.status).toEqual(["pending", "in_progress"]);
    expect(filters.blocked).toBe(true);
    expect(filters.projectId).toBe("project-1");
    expect(filters.search).toBe("publish");
  });
});
