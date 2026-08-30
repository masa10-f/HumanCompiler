// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { LightweightDailyPlanner } from "../lightweight-daily-planner";
import { dailyPlansApi, quickTasksApi, tasksApi } from "@/lib/api";

const mockToast = jest.fn();

jest.mock("@/components/layout/app-header", () => ({
  AppHeader: () => <div data-testid="app-header" />,
}));

jest.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

jest.mock("@/hooks/use-project-query", () => ({
  useProjectOptions: () => ({ data: [] }),
}));

jest.mock("@/lib/api", () => ({
  dailyPlansApi: {
    get: jest.fn(),
    update: jest.fn(),
    generate: jest.fn(),
    applyTaskAction: jest.fn(),
  },
  goalsApi: { getByProject: jest.fn() },
  quickTasksApi: { getAll: jest.fn(), create: jest.fn() },
  tasksApi: { getWorkspace: jest.fn(), create: jest.fn() },
}));

const blankResponse = {
  date: "2030-01-02",
  revision: 0,
  document: {
    schema_version: 1 as const,
    availability_windows: [
      { start: "09:00", end: "18:00", work_type: "light_work" as const },
    ],
    blocks: [],
  },
  schedule: null,
};

describe("LightweightDailyPlanner", () => {
  beforeEach(() => {
    jest.mocked(dailyPlansApi.get).mockResolvedValue(blankResponse);
    jest
      .mocked(dailyPlansApi.update)
      .mockImplementation(async (date, _revision, document) => ({
        date,
        revision: 1,
        document,
        schedule: null,
      }));
    jest.mocked(tasksApi.getWorkspace).mockResolvedValue({
      items: [],
      total: 0,
      skip: 0,
      limit: 100,
    });
    jest.mocked(quickTasksApi.getAll).mockResolvedValue([]);
  });

  it("inserts a schedule directive and autosaves the typed document", async () => {
    render(
      <LightweightDailyPlanner
        selectedDate="2030-01-02"
        onSelectedDateChange={jest.fn()}
        onSwitchDetailed={jest.fn()}
      />,
    );

    const command = await screen.findByRole("textbox", {
      name: "日次プランの行入力",
    });
    fireEvent.paste(command, {
      clipboardData: { getData: () => "/schedule" },
    });
    fireEvent.keyDown(command, { key: "Enter", code: "Enter" });

    expect(await screen.findByText("/schedule")).toBeInTheDocument();
    await waitFor(
      () => {
        expect(dailyPlansApi.update).toHaveBeenCalledWith(
          "2030-01-02",
          0,
          expect.objectContaining({
            blocks: [
              expect.objectContaining({
                type: "schedule_directive",
                mode: "filter",
              }),
            ],
          }),
        );
      },
      { timeout: 2500 },
    );
  });
});
