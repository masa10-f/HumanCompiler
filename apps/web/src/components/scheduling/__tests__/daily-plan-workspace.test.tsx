// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

/**
 * @jest-environment jsdom
 */

import { act, fireEvent, render as renderUI, screen, waitFor, within } from "@testing-library/react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DailyPlanWorkspace } from "../daily-plan-workspace";
import { goalsApi, dailyPlansApi, quickTasksApi, tasksApi } from "@/lib/api";
import { ApiError } from "@/lib/errors";
import { clearSchedulerSolverConfig, saveSchedulerSolverConfig } from "@/lib/scheduler-config";
import type { DailyPlanResponse } from "@/types/daily-plan";
import type { QuickTask } from "@/types/quick-task";
import type { TaskWorkspaceItem } from "@/types/task";

function renderUIWithQueries(element: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return renderUI(element, { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
}

async function renderNotebook(element: React.ReactElement) {
  const view = renderUIWithQueries(element);
  await screen.findByRole("textbox", { name: "日次ノート" });
  return view;
}

function openGeneratedTimes() {
  screen.getAllByRole("button", { name: "予定の時刻を編集" }).forEach((button) => fireEvent.click(button));
}

beforeAll(() => {
  Range.prototype.getBoundingClientRect = () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => {} });
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
});

function quickTask(id: string, title: string): QuickTask {
  return { id, title, owner_id: 'owner', description: null, estimate_hours: 1,
    due_date: null, status: 'pending', work_type: 'light_work', priority: 3,
    created_at: '2030-01-01', updated_at: '2030-01-01' };
}

function workspaceTask(id: string, title: string): TaskWorkspaceItem {
  return { id, title, description: null, estimate_hours: 1, due_date: null,
    status: 'pending', work_type: 'light_work', priority: 3, goal_id: 'goal',
    project_id: 'project', project_title: 'Project', goal_title: 'Goal',
    remaining_estimate_hours: 1, is_blocked: false, is_ready: true, blocking_task_ids: [],
    last_worked_at: null, planned_today: false, planned_today_unplaced: false,
    planned_this_week: false, created_at: '2030-01-01', updated_at: '2030-01-01' };
}

const mockToast = jest.fn();
let mockProjects: Array<{ id: string; title: string }> = [];

jest.mock("@/components/layout/app-header", () => ({
  AppHeader: () => <div data-testid="app-header" />,
}));

jest.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

jest.mock("@/hooks/use-project-query", () => ({
  useProjectOptions: () => ({ data: mockProjects }),
}));

jest.mock("@/lib/api", () => ({
  dailyPlansApi: {
    list: jest.fn(),
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

describe("DailyPlanWorkspace", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockProjects = [];
    jest.mocked(goalsApi.getByProject).mockResolvedValue([]);
    jest.mocked(dailyPlansApi.list).mockResolvedValue({ items: [], next_cursor: null });
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

  it("saves and unchecks a fixed event without completing its task or invalidating the schedule", async () => {
    const block = { id: "fixed", type: "timed_line" as const, title: "会議", start: "09:00", end: "10:00", task_ref: { source: "task" as const, id: "paper" } };
    jest.mocked(dailyPlansApi.get).mockResolvedValue({ ...blankResponse, revision: 1,
      document: { schema_version: 1, blocks: [block] },
      schedule: { success: true, assignments: [], total_scheduled_hours: 1,
        optimization_status: "OK", generated_at: "2030-01-02T00:00:00Z", source_scheduling_blocks: [block] } });
    await renderNotebook(<DailyPlanWorkspace selectedDate="2030-01-02" onSelectedDateChange={jest.fn()} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "会議を終了済みにする" }));
    expect(screen.getByText("終了済み")).toBeInTheDocument();
    expect(screen.queryByText(/再生成が必要/)).not.toBeInTheDocument();
    await waitFor(() => expect(dailyPlansApi.update).toHaveBeenCalledWith("2030-01-02", 1,
      expect.objectContaining({ blocks: [expect.objectContaining({ completed: true })] })), { timeout: 2500 });
    fireEvent.click(screen.getByRole("checkbox", { name: "会議を終了済みにする" }));
    await waitFor(() => expect(jest.mocked(dailyPlansApi.update).mock.calls.at(-1)![2].blocks[0]).toMatchObject({ completed: false }), { timeout: 2500 });
    expect(dailyPlansApi.applyTaskAction).not.toHaveBeenCalled();
    expect(dailyPlansApi.generate).not.toHaveBeenCalled();
  });

  it("records fixed task comments, keeps failed input, and prevents duplicate submissions", async () => {
    jest.mocked(dailyPlansApi.get).mockResolvedValue({ ...blankResponse,
      document: { schema_version: 1, blocks: [{ id: "fixed", type: "timed_line", title: "論文", start: "09:00", end: "10:00", task_ref: { source: "task", id: "paper" } }] } });
    jest.mocked(dailyPlansApi.applyTaskAction).mockRejectedValueOnce(new Error("offline"));
    await renderNotebook(<DailyPlanWorkspace selectedDate="2030-01-02" onSelectedDateChange={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "実績" }));
    const comment = screen.getByLabelText("コメント（任意）");
    expect(comment).toHaveAttribute("maxlength", "500");
    fireEvent.change(comment, { target: { value: "あ".repeat(501) } });
    expect(screen.getByRole("alert")).toHaveTextContent("コメントは500文字以内で入力してください");
    expect(comment).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "記録して継続" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "記録して完了" })).toBeDisabled();
    expect(dailyPlansApi.applyTaskAction).not.toHaveBeenCalled();
    fireEvent.change(comment, { target: { value: "結果を整理した" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("実働時間（分）"), { target: { value: "45" } });
    fireEvent.click(screen.getByRole("button", { name: "記録して継続" }));
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: "タスクの更新に失敗しました" })));
    expect(comment).toHaveValue("結果を整理した");
    let resolveAction!: (value: Awaited<ReturnType<typeof dailyPlansApi.applyTaskAction>>) => void;
    jest.mocked(dailyPlansApi.applyTaskAction).mockImplementationOnce(() => new Promise((resolve) => { resolveAction = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "記録して完了" }));
    fireEvent.click(screen.getByRole("button", { name: "記録して完了" }));
    expect(dailyPlansApi.applyTaskAction).toHaveBeenCalledTimes(2);
    expect(dailyPlansApi.applyTaskAction).toHaveBeenLastCalledWith("2030-01-02", {
      task_ref: { source: "task", id: "paper" }, action: "complete", actual_minutes: 45, comment: "結果を整理した",
    });
    await act(async () => resolveAction({ task_ref: { source: "task", id: "paper" }, status: "completed", actual_minutes: 45 }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "論文を終了済みにする" })).not.toBeChecked();
  });

  describe("fixed line task link", () => {
    const fixed = { id: "fixed", type: "timed_line" as const, title: "定例", start: "09:00", end: "10:00" };
    const lastSavedFixed = () =>
      jest.mocked(dailyPlansApi.update).mock.calls.at(-1)?.[2].blocks.find((block) => block.id === "fixed");

    async function openFixedLine(blocks: DailyPlanResponse["document"]["blocks"] = [fixed]) {
      jest.mocked(tasksApi.getWorkspace).mockResolvedValue({ items: [
        { ...workspaceTask("paper", "論文を読む"), project_title: "研究", goal_title: "調査" },
        { ...workspaceTask("data", "データ整理"), project_title: "研究", goal_title: "実験" },
        workspaceTask("shopping", "買い物"),
      ], total: 3, skip: 0, limit: 100 });
      jest.mocked(dailyPlansApi.get).mockResolvedValue({ ...blankResponse, revision: 1,
        document: { schema_version: 1, blocks } });
      await renderNotebook(<DailyPlanWorkspace selectedDate="2030-01-02" onSelectedDateChange={jest.fn()} />);
      await waitFor(() => expect(tasksApi.getWorkspace).toHaveBeenCalled());
      fireEvent.click(screen.getByText(blocks.find((block) => block.id === "fixed")!.title!, { selector: "summary" }));
      const input = screen.getByRole("combobox", { name: "紐づけるタスク" });
      fireEvent.focus(input);
      return input;
    }

    it("narrows candidates by task, goal and project words and links with Enter", async () => {
      const input = await openFixedLine();
      const list = screen.getByRole("listbox", { name: "紐づけるタスクの候補" });
      expect(within(list).getAllByRole("option")).toHaveLength(4);
      fireEvent.change(input, { target: { value: "研究　読む" } });
      expect(within(list).getAllByRole("option").map((option) => option.textContent)).toEqual([
        "タスクに紐づけない", "論文を読む研究 / 調査",
      ]);
      expect(within(list).getByRole("option", { name: /論文を読む/ })).toHaveAttribute("aria-selected", "true");
      fireEvent.keyDown(input, { key: "Enter" });
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      expect(screen.getByRole("textbox", { name: "予定名" })).toHaveValue("論文を読む");
      await waitFor(() => expect(lastSavedFixed()).toMatchObject({
        title: "論文を読む", task_ref: { source: "task", id: "paper" } }), { timeout: 2500 });
    });

    it("links a task found by its goal with a click and reports no match", async () => {
      const input = await openFixedLine();
      fireEvent.change(input, { target: { value: "会議" } });
      expect(screen.getByText("一致するタスクがありません")).toBeInTheDocument();
      fireEvent.change(input, { target: { value: "実験" } });
      fireEvent.click(screen.getByRole("option", { name: /データ整理/ }));
      fireEvent.blur(input);
      expect(input).toHaveValue("データ整理 · 研究");
      await waitFor(() => expect(lastSavedFixed()).toMatchObject({
        title: "データ整理", task_ref: { source: "task", id: "data" } }), { timeout: 2500 });
    });

    it("unlinks with the keyboard and keeps Escape from changing the link", async () => {
      const input = await openFixedLine([{ ...fixed, title: "論文を読む", task_ref: { source: "task", id: "paper" } }]);
      expect(screen.getByRole("option", { name: /論文を読む/ })).toHaveAttribute("aria-selected", "true");
      fireEvent.change(input, { target: { value: "データ" } });
      fireEvent.keyDown(input, { key: "Escape" });
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      fireEvent.blur(input);
      expect(input).toHaveValue("論文を読む · 研究");
      expect(dailyPlansApi.update).not.toHaveBeenCalled();
      fireEvent.focus(input);
      fireEvent.keyDown(input, { key: "ArrowUp" });
      fireEvent.keyDown(input, { key: "Enter" });
      await waitFor(() => expect(lastSavedFixed()).toMatchObject({ title: "論文を読む", task_ref: undefined }),
        { timeout: 2500 });
    });

    it("keeps the link when candidates shrink while the list is open", async () => {
      let finishRefresh: (value: Awaited<ReturnType<typeof tasksApi.getWorkspace>>) => void = () => {};
      jest.mocked(dailyPlansApi.applyTaskAction).mockResolvedValue({
        task_ref: { source: "task", id: "data" }, status: "completed", actual_minutes: 30 });
      const input = await openFixedLine([{ ...fixed, title: "論文を読む", task_ref: { source: "task", id: "paper" } }]);
      jest.mocked(tasksApi.getWorkspace).mockImplementationOnce(() => new Promise((resolve) => { finishRefresh = resolve; }));
      fireEvent.blur(input);
      fireEvent.click(screen.getByRole("button", { name: "実績" }));
      fireEvent.click(screen.getByRole("button", { name: "記録して完了" }));
      await waitFor(() => expect(tasksApi.getWorkspace).toHaveBeenCalledTimes(2));
      fireEvent.focus(input);
      fireEvent.keyDown(input, { key: "ArrowDown" });
      fireEvent.keyDown(input, { key: "ArrowDown" });
      expect(screen.getByRole("option", { name: /買い物/ })).toHaveAttribute("aria-selected", "true");
      await act(async () => finishRefresh({ items: [
        { ...workspaceTask("paper", "論文を読む"), project_title: "研究", goal_title: "調査" },
      ], total: 1, skip: 0, limit: 100 }));
      expect(screen.getByRole("option", { name: /論文を読む/ })).toHaveAttribute("aria-selected", "true");
      fireEvent.keyDown(input, { key: "Enter" });
      await waitFor(() => expect(lastSavedFixed()).toMatchObject({ task_ref: { source: "task", id: "paper" } }),
        { timeout: 2500 });
    });

    it("does not turn a time-like note paragraph into a fixed line when Enter picks a task", async () => {
      const input = await openFixedLine([
        { id: "draft", type: "text", text: "1100-1200 下書き" },
        fixed,
      ]);
      const text = screen.getByText("1100-1200 下書き").firstChild!;
      act(() => { window.getSelection()!.collapse(text, text.textContent!.length); });
      fireEvent(document, new Event("selectionchange"));
      fireEvent.change(input, { target: { value: "買い物" } });
      fireEvent.keyDown(input, { key: "Enter" });
      await waitFor(() => expect(lastSavedFixed()).toMatchObject({ task_ref: { id: "shopping" } }), { timeout: 2500 });
      expect(jest.mocked(dailyPlansApi.update).mock.calls.at(-1)![2].blocks[0]).toMatchObject({
        id: "draft", type: "text", text: "1100-1200 下書き" });
    });
  });

  it("loads and saves a goal scope when the project has no tasks", async () => {
    mockProjects = [{ id: "project", title: "研究" }];
    jest.mocked(goalsApi.getByProject).mockResolvedValue([{
      id: "goal", title: "企画をまとめる", project_id: "project", status: "pending",
      description: null, estimate_hours: 1, due_date: null,
      created_at: "2030-01-01", updated_at: "2030-01-01",
    }]);
    await renderNotebook(<DailyPlanWorkspace selectedDate="2030-01-02" onSelectedDateChange={jest.fn()} />);
    expect(goalsApi.getByProject).not.toHaveBeenCalled();
    const note = screen.getByRole("textbox", { name: "日次ノート" });
    fireEvent.paste(note, { clipboardData: { getData: (type: string) => type === "text/plain" ? "1200-1400 /schedule" : "" } });
    expect(await screen.findByRole("option", { name: /研究.*プロジェクト/ })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("option", { name: /企画をまとめる/ }));
    expect(await screen.findByText("企画をまとめる", { selector: "summary" })).toBeInTheDocument();
    await waitFor(() => expect(dailyPlansApi.update).toHaveBeenCalled(), { timeout: 2500 });
    expect(jest.mocked(dailyPlansApi.update).mock.calls.at(-1)![2].blocks[0]).toMatchObject({
      mode: "filter", title: "企画をまとめる",
      filter: { goal_ids: ["goal"], project_ids: [], work_types: [] },
      allowed_windows: [{ start: "12:00", end: "14:00" }],
    });
  });

  it("opens as a notebook and keeps a generated schedule current while adding notes", async () => {
    const directive = { id: "morning", type: "schedule_directive" as const, mode: "filter" as const,
      allowed_windows: [{ start: "09:00", end: "12:00" }], filter: { work_types: [], project_ids: [], goal_ids: [] } };
    jest.mocked(dailyPlansApi.get).mockResolvedValue({ ...blankResponse, revision: 1,
      document: { schema_version: 1, blocks: [directive] },
      schedule: { success: true, assignments: [], total_scheduled_hours: 0, optimization_status: "OK", generated_at: "2030-01-02",
        source_document_revision: 1, source_scheduling_blocks: [directive] } });
    renderUIWithQueries(<DailyPlanWorkspace selectedDate="2030-01-02" onSelectedDateChange={jest.fn()} />);
    const note = await screen.findByRole("textbox", { name: "日次ノート" });
    expect(screen.queryByRole("button", { name: "行ごとの設定" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "日次プランの行入力" })).not.toBeInTheDocument();
    expect(dailyPlansApi.update).not.toHaveBeenCalled();
    // The initial cursor is the editable paragraph after the schedule.
    fireEvent.paste(note, { clipboardData: { getData: (type: string) => type === "text/plain" ? "予定確定後のメモ" : "" } });
    await waitFor(() => expect(dailyPlansApi.update).toHaveBeenCalled(), { timeout: 2500 });
    const saved = jest.mocked(dailyPlansApi.update).mock.calls.at(-1)![2];
    expect(saved.blocks).toEqual(expect.arrayContaining([directive, expect.objectContaining({ type: "text", text: "予定確定後のメモ" })]));
    expect(screen.queryByText(/再生成が必要です/)).not.toBeInTheDocument();
  });

  it("shows the notebook without waiting for slow task suggestions", async () => {
    jest.mocked(tasksApi.getWorkspace).mockReturnValueOnce(new Promise(() => {}));
    renderUIWithQueries(<DailyPlanWorkspace selectedDate="2030-01-02" onSelectedDateChange={jest.fn()} />);
    expect(await screen.findByRole("textbox", { name: "日次ノート" })).toBeInTheDocument();
  });

  it("does not expose the previous note for editing when a new date fails to load", async () => {
    jest.mocked(dailyPlansApi.get).mockResolvedValueOnce({ ...blankResponse,
      document: { schema_version: 1, blocks: [{ id: "old", type: "text", text: "前日の内容" }] } });
    const view = renderUIWithQueries(<DailyPlanWorkspace selectedDate="2030-01-02" onSelectedDateChange={jest.fn()} />);
    expect(await screen.findByRole("textbox", { name: "日次ノート" })).toHaveTextContent("前日の内容");
    jest.mocked(dailyPlansApi.get).mockRejectedValueOnce(new Error("offline"));
    view.rerender(<DailyPlanWorkspace selectedDate="2030-01-03" onSelectedDateChange={jest.fn()} />);
    expect(await screen.findByText("ノートを読み込めませんでした")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "日次ノート" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "自動スケジュール" })).toBeDisabled();
    expect(dailyPlansApi.update).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "ノートを再読み込み" }));
    expect(await screen.findByRole("textbox", { name: "日次ノート" })).not.toHaveTextContent("前日の内容");
  });

  it("inserts a schedule directive and autosaves the typed document", async () => {
    await renderNotebook(
      <DailyPlanWorkspace
        selectedDate="2030-01-02"
        onSelectedDateChange={jest.fn()}

      />,
    );

    const command = await screen.findByRole("textbox", {
      name: "日次ノート",
    });
    fireEvent.paste(command, {
      clipboardData: { getData: (type: string) => type === "text/plain" ? "/schedule 09:00-18:00"  : ""},
    });
    fireEvent.keyDown(command, { key: "Enter", code: "Enter" });

    expect(await screen.findByText("タスクを自動配置", { selector: "summary" })).toBeInTheDocument();
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
    await renderNotebook(
      <DailyPlanWorkspace
        selectedDate="2030-01-02"
        onSelectedDateChange={jest.fn()}

      />,
    );
    const command = await screen.findByRole("textbox", {
      name: "日次ノート",
    });
    fireEvent.paste(command, {
      clipboardData: { getData: (type: string) => type === "text/plain" ? "/schedule 13:00-15:00 (90m)"  : ""},
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


  it.each([
    '/schedule @論文読み 13:00-17:00',
    '/schedule @論文読み 1300-1700 (2h)',
    '/schedule 13:00-17:00 @論文読み',
  ])('links an existing task without opening creation for %s', async (input) => {
    jest.mocked(tasksApi.getWorkspace).mockResolvedValue({
      items: [workspaceTask('paper', '論文読み')], total: 1, skip: 0, limit: 100,
    });
    await renderNotebook(<DailyPlanWorkspace selectedDate="2030-01-02"
      onSelectedDateChange={jest.fn()} />);
    const command = await screen.findByRole('textbox', { name: '日次ノート' });
    fireEvent.paste(command, { clipboardData: { getData: (type: string) => type === "text/plain" ? input  : ""} });
    fireEvent.keyDown(command, { key: 'Enter' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(dailyPlansApi.update).toHaveBeenCalledWith(
      '2030-01-02', 0, expect.objectContaining({ blocks: [expect.objectContaining({
        type: 'schedule_directive', mode: 'task', title: '論文読み',
        task_ref: { source: 'task', id: 'paper' },
        allowed_windows: [{ start: '13:00', end: '17:00' }],
      })] }),
    ), { timeout: 2500 });
    expect(tasksApi.create).not.toHaveBeenCalled();
    expect(quickTasksApi.create).not.toHaveBeenCalled();
  });

  it("lets the user select the exact task from rich suggestions", async () => {
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

    await renderNotebook(
      <DailyPlanWorkspace
        selectedDate="2030-01-02"
        onSelectedDateChange={jest.fn()}

      />,
    );
    const command = await screen.findByRole("textbox", {
      name: "日次ノート",
    });
    fireEvent.paste(command, {
      clipboardData: { getData: (type: string) => type === "text/plain" ? "/schedule 09:00-11:00 @レビュー (30m)"  : ""},
    });
    fireEvent.click(await screen.findByRole("option", { name: /^レビュー Project/ }));

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


  it("creates a first-class break block", async () => {
    await renderNotebook(
      <DailyPlanWorkspace
        selectedDate="2030-01-02"
        onSelectedDateChange={jest.fn()}

      />,
    );
    const command = await screen.findByRole("textbox", {
      name: "日次ノート",
    });
    fireEvent.paste(command, {
      clipboardData: { getData: (type: string) => type === "text/plain" ? "/break 12:00-13:00 昼休み"  : ""},
    });
    fireEvent.keyDown(command, { key: "Enter", code: "Enter" });

    expect(await screen.findByText("昼休み", { selector: "summary" })).toBeInTheDocument();
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

  it("shows time-based usage help without global availability controls", async () => {
    await renderNotebook(
      <DailyPlanWorkspace
        selectedDate="2030-01-02"
        onSelectedDateChange={jest.fn()}

      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "このページの入力方法" }));
    expect(
      await screen.findByText("/break 12:00-13:00 昼休み"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "作業可能時間を追加" })).not.toBeInTheDocument();
    expect(screen.queryByText("利用開始")).not.toBeInTheDocument();
    expect(screen.queryByText("利用終了")).not.toBeInTheDocument();
    expect(screen.getByText("/schedule 09:00-11:00 @論文読み")).toBeInTheDocument();
    expect(dailyPlansApi.update).not.toHaveBeenCalled();
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

    await renderNotebook(
      <DailyPlanWorkspace
        selectedDate="2030-01-02"
        onSelectedDateChange={jest.fn()}

      />,
    );
    const command = await screen.findByRole("textbox", {
      name: "日次ノート",
    });
    fireEvent.paste(command, {
      clipboardData: { getData: (type: string) => type === "text/plain" ? "/schedule 09:00-18:00"  : ""},
    });
    fireEvent.keyDown(command, { key: "Enter", code: "Enter" });
    await waitFor(() => expect(dailyPlansApi.update).toHaveBeenCalledTimes(1), {
      timeout: 2500,
    });

    fireEvent.paste(command, {
      clipboardData: { getData: (type: string) => type === "text/plain" ? "1100-1200 会議"  : ""},
    });
    fireEvent.keyDown(command, { key: "Enter", code: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "自動スケジュール" }));
    expect(dailyPlansApi.generate).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("2030-01-02")).toBeDisabled();
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
      expect(dailyPlansApi.generate).toHaveBeenCalledWith("2030-01-02", undefined),
    );
  });

  it("generates with the saved scheduling preferences", async () => {
    saveSchedulerSolverConfig({ priority_score_base: 10, project_switch_penalty: 0 });
    jest.mocked(dailyPlansApi.get).mockResolvedValue({
      ...blankResponse,
      revision: 1,
      document: {
        schema_version: 1,
        blocks: [
          {
            id: "directive",
            type: "schedule_directive",
            mode: "filter",
            allowed_windows: [{ start: "09:00", end: "12:00" }],
          },
        ],
      },
    });
    jest.mocked(dailyPlansApi.generate).mockResolvedValue({
      ...blankResponse,
      revision: 1,
      schedule: {
        success: true,
        assignments: [],
        total_scheduled_hours: 0,
        optimization_status: "OK",
        generated_at: "2030-01-02T00:00:00Z",
      },
    });

    try {
      await renderNotebook(
        <DailyPlanWorkspace selectedDate="2030-01-02" onSelectedDateChange={jest.fn()} />,
      );
      fireEvent.click(screen.getByRole("button", { name: "自動スケジュール" }));

      await waitFor(() =>
        expect(dailyPlansApi.generate).toHaveBeenCalledWith("2030-01-02", {
          priority_score_base: 10,
          project_switch_penalty: 0,
        }),
      );
    } finally {
      clearSchedulerSolverConfig();
    }
  });

  it("retries autosave after a transient failure", async () => {
    jest
      .mocked(dailyPlansApi.update)
      .mockRejectedValueOnce(new Error("temporary network failure"));

    await renderNotebook(
      <DailyPlanWorkspace
        selectedDate="2030-01-02"
        onSelectedDateChange={jest.fn()}

      />,
    );
    const command = await screen.findByRole("textbox", {
      name: "日次ノート",
    });
    fireEvent.paste(command, {
      clipboardData: { getData: (type: string) => type === "text/plain" ? "/schedule 09:00-18:00"  : ""},
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

    await renderNotebook(
      <DailyPlanWorkspace
        selectedDate="2030-01-02"
        onSelectedDateChange={jest.fn()}

      />,
    );
    const command = await screen.findByRole("textbox", {
      name: "日次ノート",
    });
    fireEvent.paste(command, {
      clipboardData: { getData: (type: string) => type === "text/plain" ? "/schedule 09:00-18:00"  : ""},
    });
    fireEvent.keyDown(command, { key: "Enter", code: "Enter" });
    expect(
      await screen.findByText("別の画面で内容が更新されています"),
    ).toBeInTheDocument();

    fireEvent.paste(command, {
      clipboardData: { getData: (type: string) => type === "text/plain" ? "1100-1200 会議"  : ""},
    });
    fireEvent.keyDown(command, { key: "Enter", code: "Enter" });

    expect(
      screen.getByText("別の画面で内容が更新されています"),
    ).toBeInTheDocument();
  });

  it("stops retrying 422 automatically and offers a manual save", async () => {
    jest.mocked(dailyPlansApi.update).mockRejectedValueOnce(new ApiError(422, 'Invalid content'));
    await renderNotebook(<DailyPlanWorkspace selectedDate="2030-01-02"
      onSelectedDateChange={jest.fn()} />);
    const command = await screen.findByRole('textbox', { name: '日次ノート' });
    fireEvent.paste(command, { clipboardData: { getData: (type: string) => type === "text/plain" ? 'note'  : ""} });
    fireEvent.keyDown(command, { key: 'Enter' });
    const retry = await screen.findByRole('button', { name: '保存を再試行' });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1000)); });
    expect(dailyPlansApi.update).toHaveBeenCalledTimes(1);
    fireEvent.click(retry);
    await waitFor(() => expect(screen.queryByText('保存・参照エラー')).not.toBeInTheDocument());
    expect(dailyPlansApi.update).toHaveBeenCalledTimes(2);
  });

  it("identifies a missing reference and lets the user retain the row without it", async () => {
    jest.mocked(dailyPlansApi.get).mockResolvedValue({ ...blankResponse, document: {
      ...blankResponse.document, blocks: [{ id: 'missing', type: 'timed_line', title: 'Deleted task',
        start: '10:00', end: '11:00', task_ref: { source: 'task', id: 'deleted' } }],
    } });
    jest.mocked(dailyPlansApi.update).mockRejectedValueOnce(new ApiError(404, 'Referenced task was not found', {
      responseData: { detail: { missing: [{ block_id: 'missing', source: 'task', id: 'deleted' }] } },
    }));
    await renderNotebook(<DailyPlanWorkspace selectedDate="2030-01-02"
      onSelectedDateChange={jest.fn()} />);
    const command = await screen.findByRole('textbox', { name: '日次ノート' });
    fireEvent.paste(command, { clipboardData: { getData: (type: string) => type === "text/plain" ? 'Keep this note'  : ""} });
    fireEvent.keyDown(command, { key: 'Enter' });
    fireEvent.click(await screen.findByRole('button', { name: 'Deleted task の参照を解除' }));
    await waitFor(() => expect(dailyPlansApi.update).toHaveBeenCalledTimes(2), { timeout: 2500 });
    const blocks = jest.mocked(dailyPlansApi.update).mock.calls[1]![2].blocks;
    expect(blocks).toEqual([
      expect.objectContaining({ id: 'missing', type: 'timed_line', title: 'Deleted task',
        start: '10:00', end: '11:00', task_ref: undefined }),
      expect.objectContaining({ text: 'Keep this note' }),
    ]);
  });

  it("offers matching tasks in the notebook suggestion menu", async () => {
    jest.mocked(quickTasksApi.getAll).mockResolvedValue([
      quickTask('code', 'コードレビュー'), quickTask('paper', '論文レビュー'),
    ]);
    await renderNotebook(<DailyPlanWorkspace selectedDate="2030-01-02"
      onSelectedDateChange={jest.fn()} />);
    const command = await screen.findByRole('textbox', { name: '日次ノート' });
    fireEvent.paste(command, { clipboardData: { getData: (type: string) => type === "text/plain" ? '/schedule 09:00-11:00 @レビュー (1h)'  : ""} });
    expect(await screen.findByRole("dialog", { name: "スケジュールの提案" })).toBeInTheDocument();
    expect(dailyPlansApi.update).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("option", { name: /論文レビュー/ }));
    await waitFor(() => expect(dailyPlansApi.update).toHaveBeenCalled(), { timeout: 2500 });
    expect(jest.mocked(dailyPlansApi.update).mock.calls[0]![2].blocks[0]).toMatchObject({
      task_ref: { source: 'quick_task', id: 'paper' }, duration_override_minutes: 60,
    });
  });

  it("recovers a deleted directive reference as a note, never as an unrestricted filter", async () => {
    jest.mocked(dailyPlansApi.get).mockResolvedValue({ ...blankResponse, document: {
      ...blankResponse.document, blocks: [{ id: 'missing', type: 'schedule_directive', mode: 'task',
        title: 'Deleted task', task_ref: { source: 'task', id: 'deleted' },
        duration_override_minutes: 30, allowed_windows: [{ start: '10:00', end: '11:00' }] }],
    } });
    jest.mocked(dailyPlansApi.generate).mockRejectedValueOnce(new ApiError(404, 'Referenced task was not found', {
      responseData: { detail: { missing: [{ block_id: 'missing' }] } },
    }));
    await renderNotebook(<DailyPlanWorkspace selectedDate="2030-01-02"
      onSelectedDateChange={jest.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: '自動スケジュール' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Deleted task の参照を解除' }));
    await waitFor(() => expect(dailyPlansApi.update).toHaveBeenCalled(), { timeout: 2500 });
    expect(jest.mocked(dailyPlansApi.update).mock.calls[0]![2].blocks).toEqual([
      { id: 'missing', type: 'text', text: '/schedule Deleted task (30m) 10:00-11:00' },
    ]);
  });

  it.each(['task', 'quick_task'] as const)("loads later pages before resolving a %s mention", async (source) => {
    if (source === 'task') {
      jest.mocked(tasksApi.getWorkspace).mockImplementation(async (filters) => ({
        items: filters?.skip === 0 ? Array.from({ length: 100 }, (_, index) => workspaceTask(`task-${index}`, `Task ${index}`))
          : [workspaceTask('last', 'Later task')], total: 101, skip: filters?.skip ?? 0, limit: 100,
      }));
    } else {
      jest.mocked(quickTasksApi.getAll).mockImplementation(async (skip) => skip === 0
        ? Array.from({ length: 100 }, (_, index) => quickTask(`quick-${index}`, `Quick ${index}`))
        : [quickTask('last', 'Later task')]);
    }
    await renderNotebook(<DailyPlanWorkspace selectedDate="2030-01-02"
      onSelectedDateChange={jest.fn()} />);
    const command = await screen.findByRole('textbox', { name: '日次ノート' });
    fireEvent.paste(command, { clipboardData: { getData: (type: string) => type === "text/plain" ? '/schedule 09:00-11:00 @Later task (30m)'  : ""} });
    fireEvent.keyDown(command, { key: 'Enter' });
    await waitFor(() => expect(dailyPlansApi.update).toHaveBeenCalled(), { timeout: 2500 });
    expect(jest.mocked(dailyPlansApi.update).mock.calls[0]![2].blocks[0]).toMatchObject({
      task_ref: { source, id: 'last' },
    });
  });


  it("labels a generated schedule as stale after a document edit", async () => {
    jest.mocked(dailyPlansApi.update).mockImplementation(async (date, revision, document) => ({
      date, revision: revision + 1, document,
    }));
    jest.mocked(dailyPlansApi.get).mockResolvedValue({ ...blankResponse, revision: 1, schedule: {
      success: true, assignments: [], total_scheduled_hours: 0, optimization_status: 'OK',
      generated_at: '2030-01-02T00:00:00Z', source_document_revision: 1,
    } });
    await renderNotebook(<DailyPlanWorkspace selectedDate="2030-01-02"
      onSelectedDateChange={jest.fn()} />);
    const command = await screen.findByRole('textbox', { name: '日次ノート' });
    expect(screen.queryByText(/再生成が必要です/)).not.toBeInTheDocument();
    fireEvent.paste(command, { clipboardData: { getData: (type: string) => type === "text/plain" ? '/schedule 09:00-11:00'  : ""} });
    fireEvent.keyDown(command, { key: 'Enter' });
    expect(await screen.findByText(/再生成が必要です/)).toBeInTheDocument();
    await waitFor(() => expect(dailyPlansApi.update).toHaveBeenCalled(), { timeout: 2500 });
    expect(screen.getByText(/再生成が必要です/)).toBeInTheDocument();
  });

  it("keeps the persisted title valid while the title field is cleared", async () => {
    await renderNotebook(
      <DailyPlanWorkspace
        selectedDate="2030-01-02"
        onSelectedDateChange={jest.fn()}

      />,
    );
    const command = await screen.findByRole("textbox", {
      name: "日次ノート",
    });
    fireEvent.paste(command, {
      clipboardData: { getData: (type: string) => type === "text/plain" ? "1100-1200 会議"  : ""},
    });
    fireEvent.keyDown(command, { key: "Enter", code: "Enter" });
    await waitFor(() => expect(dailyPlansApi.update).toHaveBeenCalledTimes(1), {
      timeout: 2500,
    });
    jest.mocked(dailyPlansApi.update).mockClear();

    fireEvent.click(screen.getByText("会議", { selector: "summary" }));
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
    await renderNotebook(<DailyPlanWorkspace selectedDate="2030-01-02"
      onSelectedDateChange={jest.fn()} />);
    const command = await screen.findByRole("textbox", { name: "日次ノート" });
    fireEvent.paste(command, { clipboardData: { getData: (type: string) => type === "text/plain" ? "first note"  : ""} });
    fireEvent.keyDown(command, { key: "Enter", code: "Enter" });
    fireEvent.click(await screen.findByRole("button", { name: "ローカル版で上書き" }));
    await waitFor(() => expect(dailyPlansApi.update).toHaveBeenCalledTimes(2));
    const snapshot = jest.mocked(dailyPlansApi.update).mock.calls[1]![2];
    fireEvent.paste(command, { clipboardData: { getData: (type: string) => type === "text/plain" ? "second note"  : ""} });
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
        { id: "directive", type: "schedule_directive", mode: "filter", allowed_windows: [{ start: "09:00", end: "18:00" }] },
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
    await renderNotebook(<DailyPlanWorkspace selectedDate="2030-01-02"
      onSelectedDateChange={jest.fn()} />);
    const pin = await screen.findByRole("button", { name: "固定", exact: true });
    fireEvent.click(pin);
    fireEvent.click(pin);
    expect(screen.queryByRole("button", { name: "固定", exact: true })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "自動スケジュール" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "固定", exact: true })).toBeDisabled());
    openGeneratedTimes();
    expect(screen.getByLabelText("生成予定の開始時刻")).toBeDisabled();
    expect(jest.mocked(dailyPlansApi.update).mock.calls.at(-1)![2].blocks.filter(
      (block) => block.type === "timed_line",
    )).toHaveLength(1);
  });

  it('shows orphan schedules in time order and permits recording work', async () => {
    const baseAssignment = {
      task_id: 'paper', task_title: 'Past work', goal_id: '', project_id: '',
      slot_index: 0, start_time: '09:00', slot_start: '09:00', slot_end: '10:00',
      duration_hours: 1, slot_kind: 'light_work' as const, source: 'task' as const, is_fixed: true,
    };
    jest.mocked(dailyPlansApi.get).mockResolvedValue({
      ...blankResponse,
      document: { ...blankResponse.document, blocks: [{ id: 'live', type: 'timed_line', title: 'Fixed event', start: '09:00', end: '10:00' }] },
      schedule: { success: true, optimization_status: 'OK', total_scheduled_hours: 3,
        generated_at: '2030-01-02T00:00:00Z', assignments: [
          { ...baseAssignment, task_title: 'Later work', directive_id: null, start_time: '11:00', slot_start: '11:00', slot_end: '12:00' },
          { ...baseAssignment, directive_id: 'deleted' },
          { ...baseAssignment, task_title: 'Linked work', directive_id: 'live' },
        ] },
    });
    jest.mocked(dailyPlansApi.applyTaskAction).mockResolvedValue({
      task_ref: { source: 'task', id: 'paper' }, status: 'in_progress', actual_minutes: 60,
    });
    await renderNotebook(<DailyPlanWorkspace selectedDate="2030-01-02"
      onSelectedDateChange={jest.fn()} />);
    const section = await screen.findByRole('region', { name: '文書外の予定' });
    openGeneratedTimes();
    expect(within(section).getAllByLabelText('生成予定の開始時刻').map(
      (input) => (input as HTMLInputElement).value,
    )).toEqual(['09:00', '11:00']);
    expect(within(section).queryByText('Linked work')).not.toBeInTheDocument();
    expect(screen.getAllByText('Linked work')).toHaveLength(1);

    fireEvent.click(within(section).getAllByRole('button', { name: '実績' })[0]!);
    fireEvent.click(await screen.findByRole('button', { name: '記録して継続' }));
    await waitFor(() => expect(dailyPlansApi.applyTaskAction).toHaveBeenCalledWith('2030-01-02', {
      task_ref: { source: 'task', id: 'paper' }, action: 'continue', actual_minutes: 60,
    }));
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

    await renderNotebook(
      <DailyPlanWorkspace
        selectedDate="2030-01-02"
        onSelectedDateChange={jest.fn()}

      />,
    );

    fireEvent.click(await screen.findByRole("checkbox"));
    fireEvent.click(
      await screen.findByRole("button", { name: "記録して完了", exact: true }),
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
    await renderNotebook(
      <DailyPlanWorkspace
        selectedDate="2030-01-02"
        onSelectedDateChange={onSelectedDateChange}

      />,
    );
    const command = await screen.findByRole("textbox", {
      name: "日次ノート",
    });
    fireEvent.paste(command, {
      clipboardData: { getData: (type: string) => type === "text/plain" ? "/schedule 09:00-18:00"  : ""},
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
    await renderNotebook(
      <DailyPlanWorkspace
        selectedDate="2030-01-02"
        onSelectedDateChange={jest.fn()}

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
            allowed_windows: [{ start: "09:00", end: "18:00" }],
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

    await renderNotebook(
      <DailyPlanWorkspace
        selectedDate="2030-01-02"
        onSelectedDateChange={jest.fn()}

      />,
    );

    openGeneratedTimes();
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
    await renderNotebook(
      <DailyPlanWorkspace
        selectedDate="2030-01-02"
        onSelectedDateChange={jest.fn()}

      />,
    );

    openGeneratedTimes();
    const start = await screen.findByLabelText("生成予定の開始時刻");
    const pin = screen.getByRole("button", { name: "固定" });
    expect(pin).toBeEnabled();

    fireEvent.change(start, { target: { value: "" } });

    expect(pin).toBeDisabled();
  });
});


it('keeps a long paragraph editable and gives a specific API validation message', async () => {
  const text = '調査'.repeat(3000);
  jest.mocked(dailyPlansApi.get).mockResolvedValue(blankResponse);
  jest.mocked(dailyPlansApi.update).mockRejectedValueOnce(new ApiError(422, 'Request validation failed', {
    responseData: { errors: [{ type: 'note_content_too_large', field: 'body -> document -> blocks -> 0 -> text -> content' }] },
  }));
  renderUIWithQueries(<DailyPlanWorkspace selectedDate="2030-01-02" onSelectedDateChange={jest.fn()} />);
  const editor = await screen.findByRole('textbox', { name: '日次ノート' });
  fireEvent.paste(editor, { clipboardData: { getData: (type: string) => type === 'text/plain' ? text : '' } });
  expect(await screen.findByText(/1番目の段落・項目.*書式を含む内容が上限/, {}, { timeout: 2500 })).toBeInTheDocument();
  expect(editor).toHaveTextContent(text);
  expect(jest.mocked(dailyPlansApi.update).mock.calls.at(-1)![2].blocks[0]).toMatchObject({ text });
});
