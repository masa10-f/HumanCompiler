// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { LightweightDailyPlanner } from "../lightweight-daily-planner";
import { dailyPlansApi, quickTasksApi, tasksApi } from "@/lib/api";
import { ApiError } from "@/lib/errors";
import type { DailyPlanResponse } from "@/types/daily-plan";

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
    jest.clearAllMocks();
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

  it("saves allocation and allowed time for a filter directive", async () => {
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
      clipboardData: { getData: () => "/schedule 13:00-15:00 (90m)" },
    });
    fireEvent.keyDown(command, { key: "Enter", code: "Enter" });

    await waitFor(
      () =>
        expect(dailyPlansApi.update).toHaveBeenCalledWith(
          "2030-01-02",
          0,
          expect.objectContaining({
            blocks: [
              expect.objectContaining({
                type: "schedule_directive",
                mode: "filter",
                duration_override_minutes: 90,
                allowed_windows: [{ start: "13:00", end: "15:00" }],
              }),
            ],
          }),
        ),
      { timeout: 2500 },
    );
  });

  it("prefers an exact task mention over an earlier partial match", async () => {
    const baseTask = {
      description: null,
      estimate_hours: 1,
      due_date: null,
      status: "pending" as const,
      work_type: "light_work" as const,
      priority: 3,
      goal_id: "goal-1",
      project_id: "project-1",
      project_title: "Project",
      goal_title: "Goal",
      remaining_estimate_hours: 1,
      is_blocked: false,
      is_ready: true,
      blocking_task_ids: [],
      last_worked_at: null,
      planned_today: false,
      planned_today_unplaced: false,
      planned_this_week: false,
      created_at: "2030-01-01T00:00:00Z",
      updated_at: "2030-01-01T00:00:00Z",
    };
    jest.mocked(tasksApi.getWorkspace).mockResolvedValue({
      items: [
        {
          ...baseTask,
          id: "11111111-1111-1111-1111-111111111111",
          title: "コードレビュー準備",
        },
        {
          ...baseTask,
          id: "22222222-2222-2222-2222-222222222222",
          title: "レビュー",
        },
      ],
      total: 2,
      skip: 0,
      limit: 100,
    });

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
      clipboardData: { getData: () => "/schedule @レビュー (30m)" },
    });
    fireEvent.keyDown(command, { key: "Enter", code: "Enter" });

    await waitFor(
      () =>
        expect(dailyPlansApi.update).toHaveBeenCalledWith(
          "2030-01-02",
          0,
          expect.objectContaining({
            blocks: [
              expect.objectContaining({
                task_ref: {
                  source: "task",
                  id: "22222222-2222-2222-2222-222222222222",
                },
              }),
            ],
          }),
        ),
      { timeout: 2500 },
    );
  });

  it("keeps the allowed window when creating an unknown mentioned task", async () => {
    jest.mocked(quickTasksApi.create).mockResolvedValue({
      id: "quick-1",
      owner_id: "user-1",
      title: "新規タスク",
      description: null,
      estimate_hours: 1.5,
      due_date: null,
      status: "pending",
      work_type: "light_work",
      priority: 3,
      created_at: "2030-01-02T00:00:00Z",
      updated_at: "2030-01-02T00:00:00Z",
    });
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
      clipboardData: {
        getData: () => "/schedule 13:00-17:00 @新規タスク (50m)",
      },
    });
    fireEvent.keyDown(command, { key: "Enter", code: "Enter" });

    fireEvent.click(
      await screen.findByRole("button", { name: "作成して追加" }),
    );

    expect(quickTasksApi.create).toHaveBeenCalledWith(
      expect.objectContaining({ estimate_hours: 0.83 }),
    );

    await waitFor(
      () =>
        expect(dailyPlansApi.update).toHaveBeenCalledWith(
          "2030-01-02",
          0,
          expect.objectContaining({
            blocks: [
              expect.objectContaining({
                type: "schedule_directive",
                duration_override_minutes: 50,
                allowed_windows: [{ start: "13:00", end: "17:00" }],
              }),
            ],
          }),
        ),
      { timeout: 2500 },
    );
  });

  it("creates a first-class break block", async () => {
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
      clipboardData: { getData: () => "/break 12:00-13:00 昼休み" },
    });
    fireEvent.keyDown(command, { key: "Enter", code: "Enter" });

    expect((await screen.findAllByText("休憩")).length).toBeGreaterThan(0);
    await waitFor(
      () =>
        expect(dailyPlansApi.update).toHaveBeenCalledWith(
          "2030-01-02",
          0,
          expect.objectContaining({
            blocks: [
              expect.objectContaining({
                type: "timed_line",
                kind: "break",
                start: "12:00",
                end: "13:00",
              }),
            ],
          }),
        ),
      { timeout: 2500 },
    );
  });

  it("shows inline usage help and adds a non-overlapping work window", async () => {
    render(
      <LightweightDailyPlanner
        selectedDate="2030-01-02"
        onSelectedDateChange={jest.fn()}
        onSwitchDetailed={jest.fn()}
      />,
    );

    expect(
      await screen.findByText("/break 12:00-13:00 昼休み"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "作業可能時間を追加" }));

    await waitFor(
      () =>
        expect(dailyPlansApi.update).toHaveBeenCalledWith(
          "2030-01-02",
          0,
          expect.objectContaining({
            availability_windows: expect.arrayContaining([
              expect.objectContaining({ start: "18:00", end: "19:00" }),
            ]),
          }),
        ),
      { timeout: 2500 },
    );
  });

  it("flushes newer edits before generating while autosave is in flight", async () => {
    let resolveFirstSave: (() => void) | undefined;
    jest
      .mocked(dailyPlansApi.update)
      .mockImplementationOnce(async (date, _revision, document) => {
        return new Promise((resolve) => {
          resolveFirstSave = () =>
            resolve({ date, revision: 1, document, schedule: null });
        });
      })
      .mockImplementationOnce(async (date, _revision, document) => ({
        date,
        revision: 2,
        document,
        schedule: null,
      }));
    jest.mocked(dailyPlansApi.generate).mockResolvedValue({
      ...blankResponse,
      revision: 2,
      schedule: {
        success: true,
        assignments: [],
        total_scheduled_hours: 0,
        optimization_status: "OK",
        generated_at: "2030-01-02T00:00:00Z",
      },
    });

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
    await waitFor(() => expect(dailyPlansApi.update).toHaveBeenCalledTimes(1), {
      timeout: 2500,
    });

    fireEvent.paste(command, {
      clipboardData: { getData: () => "1100-1200 会議" },
    });
    fireEvent.keyDown(command, { key: "Enter", code: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "自動スケジュール" }));
    expect(dailyPlansApi.generate).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("2030-01-02")).toBeDisabled();
    expect(screen.getByRole("button", { name: "詳細モード" })).toBeDisabled();
    resolveFirstSave?.();

    await waitFor(() => {
      expect(dailyPlansApi.update).toHaveBeenLastCalledWith(
        "2030-01-02",
        1,
        expect.objectContaining({
          blocks: expect.arrayContaining([
            expect.objectContaining({ type: "schedule_directive" }),
            expect.objectContaining({ type: "timed_line" }),
          ]),
        }),
      );
    });
    await waitFor(() =>
      expect(dailyPlansApi.generate).toHaveBeenCalledWith("2030-01-02"),
    );
  });

  it("retries autosave after a transient failure", async () => {
    jest
      .mocked(dailyPlansApi.update)
      .mockRejectedValueOnce(new Error("temporary network failure"));

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

    await waitFor(() => expect(dailyPlansApi.update).toHaveBeenCalledTimes(2), {
      timeout: 3500,
    });
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "自動保存に失敗しました" }),
    );
  });

  it("keeps a revision conflict visible while the user continues editing", async () => {
    jest
      .mocked(dailyPlansApi.update)
      .mockRejectedValue(new ApiError(409, "revision conflict"));

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
    expect(
      await screen.findByText("別の画面で内容が更新されています"),
    ).toBeInTheDocument();

    fireEvent.paste(command, {
      clipboardData: { getData: () => "1100-1200 会議" },
    });
    fireEvent.keyDown(command, { key: "Enter", code: "Enter" });

    expect(
      screen.getByText("別の画面で内容が更新されています"),
    ).toBeInTheDocument();
  });

  it("keeps the persisted title valid while the title field is cleared", async () => {
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
      clipboardData: { getData: () => "1100-1200 会議" },
    });
    fireEvent.keyDown(command, { key: "Enter", code: "Enter" });
    await waitFor(() => expect(dailyPlansApi.update).toHaveBeenCalledTimes(1), {
      timeout: 2500,
    });
    jest.mocked(dailyPlansApi.update).mockClear();

    const title = screen.getByRole("textbox", { name: "予定名" });
    fireEvent.change(title, { target: { value: "" } });
    expect(title).toHaveValue("");
    fireEvent.blur(title);

    await waitFor(() => expect(title).toHaveValue("会議"));
    expect(dailyPlansApi.update).not.toHaveBeenCalled();
  });

  it("autosaves edits made while resolving a revision conflict", async () => {
    jest.mocked(dailyPlansApi.update).mockRejectedValueOnce(new ApiError(409, "conflict"));
    let finishOverwrite: (response: DailyPlanResponse) => void = () => {};
    jest.mocked(dailyPlansApi.update).mockImplementationOnce(() => new Promise((resolve) => {
      finishOverwrite = resolve;
    }));
    render(<LightweightDailyPlanner selectedDate="2030-01-02"
      onSelectedDateChange={jest.fn()} onSwitchDetailed={jest.fn()} />);
    const command = await screen.findByRole("textbox", { name: "日次プランの行入力" });
    fireEvent.paste(command, { clipboardData: { getData: () => "first note" } });
    fireEvent.keyDown(command, { key: "Enter", code: "Enter" });
    fireEvent.click(await screen.findByRole("button", { name: "ローカル版で上書き" }));
    await waitFor(() => expect(dailyPlansApi.update).toHaveBeenCalledTimes(2));
    const snapshot = jest.mocked(dailyPlansApi.update).mock.calls[1]![2];
    fireEvent.paste(command, { clipboardData: { getData: () => "second note" } });
    fireEvent.keyDown(command, { key: "Enter", code: "Enter" });
    finishOverwrite({ ...blankResponse, revision: 2, document: snapshot });
    await waitFor(() => expect(dailyPlansApi.update).toHaveBeenCalledTimes(3), { timeout: 2500 });
    expect(jest.mocked(dailyPlansApi.update).mock.calls[2]).toEqual([
      "2030-01-02", 2, expect.objectContaining({ blocks: [
        expect.objectContaining({ text: "first note" }), expect.objectContaining({ text: "second note" }),
      ] }),
    ]);
  });

  it("pins only once before regeneration and disables re-pinning afterward", async () => {
    const assignment = {
      task_id: "11111111-1111-1111-1111-111111111111", task_title: "Task", goal_id: "", project_id: "",
      slot_index: 0, start_time: "09:00", duration_hours: 1, slot_start: "09:00", slot_end: "10:00",
      slot_kind: "light_work" as const, is_fixed: false, directive_id: "directive", source: "task" as const,
    };
    const response: DailyPlanResponse = {
      ...blankResponse,
      document: { ...blankResponse.document, blocks: [
        { id: "directive", type: "schedule_directive", mode: "filter" },
      ] },
      schedule: { success: true, assignments: [assignment], total_scheduled_hours: 1,
        optimization_status: "OK", generated_at: "2030-01-02T00:00:00Z" },
    };
    jest.mocked(dailyPlansApi.get).mockResolvedValue(response);
    jest.mocked(dailyPlansApi.generate).mockImplementation(async () => {
      const document = jest.mocked(dailyPlansApi.update).mock.calls.at(-1)![2];
      const pinned = document.blocks.find((block) => block.type === "timed_line")!;
      return { ...response, document, schedule: { ...response.schedule!,
        assignments: [{ ...assignment, directive_id: pinned.id, is_fixed: true }],
      } };
    });
    render(<LightweightDailyPlanner selectedDate="2030-01-02"
      onSelectedDateChange={jest.fn()} onSwitchDetailed={jest.fn()} />);
    const pin = await screen.findByRole("button", { name: "固定", exact: true });
    fireEvent.click(pin);
    fireEvent.click(pin);
    expect(screen.queryByRole("button", { name: "固定", exact: true })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "自動スケジュール" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "固定", exact: true })).toBeDisabled());
    expect(screen.getByLabelText("生成予定の開始時刻")).toBeDisabled();
    expect(jest.mocked(dailyPlansApi.update).mock.calls.at(-1)![2].blocks.filter(
      (block) => block.type === "timed_line",
    )).toHaveLength(1);
  });

  it("can complete a linked task that is outside the loaded task options", async () => {
    const taskId = "11111111-1111-1111-1111-111111111111";
    jest.mocked(dailyPlansApi.get).mockResolvedValue({
      ...blankResponse,
      document: {
        ...blankResponse.document,
        blocks: [
          {
            id: "older-task",
            type: "checklist_item",
            title: "候補外のタスク",
            checked: false,
            task_ref: { source: "task", id: taskId },
            duration_override_minutes: 30,
          },
        ],
      },
    });
    jest.mocked(dailyPlansApi.applyTaskAction).mockResolvedValue({
      task_ref: { source: "task", id: taskId },
      status: "completed",
      actual_minutes: 30,
    });

    render(
      <LightweightDailyPlanner
        selectedDate="2030-01-02"
        onSelectedDateChange={jest.fn()}
        onSwitchDetailed={jest.fn()}
      />,
    );

    fireEvent.click(await screen.findByRole("checkbox"));
    fireEvent.click(
      await screen.findByRole("button", { name: "完了", exact: true }),
    );

    await waitFor(() =>
      expect(dailyPlansApi.applyTaskAction).toHaveBeenCalledWith("2030-01-02", {
        task_ref: { source: "task", id: taskId },
        action: "complete",
        actual_minutes: 30,
      }),
    );
  });

  it("flushes pending changes before switching dates", async () => {
    const onSelectedDateChange = jest.fn();
    render(
      <LightweightDailyPlanner
        selectedDate="2030-01-02"
        onSelectedDateChange={onSelectedDateChange}
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
    fireEvent.change(screen.getByDisplayValue("2030-01-02"), {
      target: { value: "2030-01-03" },
    });

    await waitFor(() => expect(dailyPlansApi.update).toHaveBeenCalledTimes(1));
    expect(onSelectedDateChange).toHaveBeenCalledWith("2030-01-03");
  });

  it("shows a failure toast when generation returns a non-success plan", async () => {
    jest.mocked(dailyPlansApi.generate).mockResolvedValue({
      ...blankResponse,
      schedule: {
        success: false,
        assignments: [],
        total_scheduled_hours: 0,
        optimization_status: "VIOLATIONS",
        generated_at: "2030-01-02T00:00:00Z",
        unscheduled_tasks: [
          { task_id: "task-1", title: "Task", reason: "overlap" },
        ],
      },
    });
    render(
      <LightweightDailyPlanner
        selectedDate="2030-01-02"
        onSelectedDateChange={jest.fn()}
        onSwitchDetailed={jest.fn()}
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "自動スケジュール" }),
    );

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "予定を生成できませんでした",
          variant: "destructive",
        }),
      ),
    );
  });

  it("refreshes a generated row when regeneration changes its end time", async () => {
    const assignment = {
      task_id: "task-1",
      task_title: "Task",
      goal_id: "goal-1",
      project_id: "project-1",
      slot_index: 0,
      start_time: "10:00",
      duration_hours: 2,
      slot_start: "09:00",
      slot_end: "12:00",
      slot_kind: "light_work" as const,
      is_fixed: false,
      directive_id: "directive-1",
      source: "task" as const,
    };
    const response = {
      ...blankResponse,
      document: {
        ...blankResponse.document,
        blocks: [
          {
            id: "directive-1",
            type: "schedule_directive" as const,
            mode: "filter" as const,
            filter: { work_types: [], project_ids: [], goal_ids: [] },
          },
        ],
      },
      schedule: {
        success: true,
        assignments: [assignment],
        total_scheduled_hours: 2,
        optimization_status: "OK",
        generated_at: "2030-01-02T00:00:00Z",
      },
    };
    jest.mocked(dailyPlansApi.get).mockResolvedValue(response);
    jest.mocked(dailyPlansApi.generate).mockResolvedValue({
      ...response,
      schedule: {
        ...response.schedule,
        assignments: [{ ...assignment, duration_hours: 1, slot_end: "11:00" }],
      },
    });

    render(
      <LightweightDailyPlanner
        selectedDate="2030-01-02"
        onSelectedDateChange={jest.fn()}
        onSwitchDetailed={jest.fn()}
      />,
    );

    expect(await screen.findByLabelText("生成予定の終了時刻")).toHaveValue(
      "12:00",
    );
    fireEvent.click(screen.getByRole("button", { name: "自動スケジュール" }));

    await waitFor(() =>
      expect(screen.getByLabelText("生成予定の終了時刻")).toHaveValue("11:00"),
    );
  });

  it("does not pin a generated row while its time range is incomplete", async () => {
    jest.mocked(dailyPlansApi.get).mockResolvedValue({
      ...blankResponse,
      document: {
        ...blankResponse.document,
        blocks: [
          {
            id: "directive-1",
            type: "schedule_directive",
            mode: "filter",
            filter: { work_types: [], project_ids: [], goal_ids: [] },
          },
        ],
      },
      schedule: {
        success: true,
        assignments: [
          {
            task_id: "task-1",
            task_title: "Task",
            goal_id: "goal-1",
            project_id: "project-1",
            slot_index: 0,
            start_time: "09:00",
            duration_hours: 1,
            slot_start: "09:00",
            slot_end: "10:00",
            slot_kind: "light_work",
            is_fixed: false,
            directive_id: "directive-1",
            source: "task",
          },
        ],
        total_scheduled_hours: 1,
        optimization_status: "OK",
        generated_at: "2030-01-02T00:00:00Z",
      },
    });
    render(
      <LightweightDailyPlanner
        selectedDate="2030-01-02"
        onSelectedDateChange={jest.fn()}
        onSwitchDetailed={jest.fn()}
      />,
    );

    const start = await screen.findByLabelText("生成予定の開始時刻");
    const pin = screen.getByRole("button", { name: "固定" });
    expect(pin).toBeEnabled();

    fireEvent.change(start, { target: { value: "" } });

    expect(pin).toBeDisabled();
  });
});
