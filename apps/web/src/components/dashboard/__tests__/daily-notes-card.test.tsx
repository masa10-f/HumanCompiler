// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { DailyNotesCard } from "../daily-notes-card";
import { ApiError } from "@/lib/errors";
import { dailyPlansApi, tasksApi, quickTasksApi } from "@/lib/api";
import { getJSTDateString } from "@/lib/date-utils";

jest.mock("@/components/layout/app-header", () => ({ AppHeader: () => <div data-testid="app-header" /> }));
const mockPush = jest.fn();
const mockToast = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mockToast }) }));
jest.mock("@/hooks/use-project-query", () => ({ useProjectOptions: () => ({ data: [] }) }));
jest.mock("@/lib/api", () => ({
  dailyPlansApi: { list: jest.fn(), get: jest.fn(), update: jest.fn(), generate: jest.fn(), applyTaskAction: jest.fn() },
  tasksApi: { getWorkspace: jest.fn() },
  quickTasksApi: { getAll: jest.fn() },
  goalsApi: { getByProject: jest.fn() },
}));
beforeAll(() => {
  Range.prototype.getBoundingClientRect = () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => {} });
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
});
jest.mock("@/lib/date-utils", () => ({
  getJSTDateString: jest.fn(() => "2030-01-03"),
}));

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(tasksApi.getWorkspace).mockResolvedValue({ items: [], total: 0, skip: 0, limit: 100 });
  jest.mocked(quickTasksApi.getAll).mockResolvedValue([]);
  jest.mocked(dailyPlansApi.update).mockImplementation(async (date, revision, document) => ({ date, revision: revision + 1, document, schedule: null }));
  jest.mocked(getJSTDateString).mockReturnValue("2030-01-03");
  jest.mocked(dailyPlansApi.get).mockImplementation(async (date) => ({
    date,
    revision: 0,
    document: { schema_version: 1, blocks: [] },
    schedule: null,
  }));
  jest
    .mocked(dailyPlansApi.list)
    .mockResolvedValue({ items: [], next_cursor: null });
});

function renderCard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <DailyNotesCard />
    </QueryClientProvider>,
  );
}

it("links today, the separate notebook collection, and saved notes from the dashboard card", async () => {
  jest.mocked(dailyPlansApi.list).mockResolvedValue({
    items: [
      {
        date: "2030-01-02",
        title: "調査メモ",
        preview: "実験の進捗",
        revision: 1,
        updated_at: "2030-01-02T12:00:00Z",
      },
    ],
    next_cursor: null,
  });
  renderCard();
  expect(
    screen.getByRole("link", { name: "今日のノートを開く" }),
  ).toHaveAttribute("href", "/scheduling/daily?date=2030-01-03");
  expect(
    screen.getByRole("link", { name: "ノート一覧・検索" }),
  ).toHaveAttribute("href", "/notes");
  expect(
    await screen.findByRole("link", { name: "2030-01-02 のノートを開く" }),
  ).toHaveAttribute("href", "/scheduling/daily?date=2030-01-02");
  expect(screen.getByText("実験の進捗")).toBeInTheDocument();
  expect(dailyPlansApi.list).toHaveBeenCalledWith({ limit: 4 });
});

it("keeps the entry links usable before a first note exists", async () => {
  jest
    .mocked(dailyPlansApi.list)
    .mockResolvedValue({ items: [], next_cursor: null });
  renderCard();
  expect(
    await screen.findByText(/ほかの日に保存したノートはまだありません/),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "今日のノートを開く" }),
  ).toBeInTheDocument();
});

it("keeps notebook navigation available if previews fail and supports retry", async () => {
  jest
    .mocked(dailyPlansApi.list)
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue({ items: [], next_cursor: null });
  renderCard();
  expect(
    await screen.findByText("最近のノートを取得できませんでした。"),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "ノート一覧・検索" }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "再試行" }));
  expect(
    await screen.findByText(/ほかの日に保存したノートはまだありません/),
  ).toBeInTheDocument();
});

it("shows today's full rich note even when recent entries are future-dated", async () => {
  jest.mocked(dailyPlansApi.list).mockResolvedValue({
    items: ["2030-01-04", "2030-01-05", "2030-01-06"].map((date) => ({
      date,
      revision: 1,
      title: "未来",
      preview: "未来のノート",
      updated_at: date,
    })),
    next_cursor: "2030-01-04",
  });
  jest.mocked(dailyPlansApi.get).mockResolvedValue({
    date: "2030-01-03",
    revision: 1,
    document: {
      schema_version: 1,
      blocks: [
        {
          id: "heading",
          type: "text",
          text: "今日の研究",
          content: {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: "今日の研究" }],
          },
        },
        {
          id: "memo",
          type: "text",
          text: "長いメモ".repeat(100) + "最後の振り返り",
        },
        {
          id: "check",
          type: "checklist_item",
          title: "調査完了",
          checked: true,
        },
        {
          id: "event",
          type: "timed_line",
          title: "研究会",
          start: "13:00",
          end: "14:00",
        },
      ],
    },
    schedule: null,
  });
  renderCard();
  const article = await screen.findByRole("textbox", {
    name: "日次ノート",
  });
  expect(
    within(article).getByRole("heading", { name: "今日の研究" }),
  ).toBeInTheDocument();
  expect(article).toHaveTextContent("最後の振り返り");
  expect(
    within(article).getByRole("checkbox", { name: "調査完了" }),
  ).toBeChecked();
  expect(
    within(article).getByRole("checkbox", { name: "調査完了" }),
  ).toBeEnabled();
  expect(article).toHaveTextContent("13:00–14:00");
  expect(article).toHaveTextContent("研究会");
  expect(dailyPlansApi.get).toHaveBeenCalledWith("2030-01-03");
});

it("retries today's load independently and never presents another day's note as today", async () => {
  jest.mocked(dailyPlansApi.get).mockRejectedValueOnce(new Error("offline"));
  jest.mocked(dailyPlansApi.list).mockResolvedValue({
    items: [
      {
        date: "2030-01-02",
        revision: 1,
        title: "昨日",
        preview: "昨日の内容",
        updated_at: "2030-01-02",
      },
    ],
    next_cursor: null,
  });
  renderCard();
  const today = screen.getByRole("region", { name: "今日のノート" });
  expect(
    await within(today).findByText("ノートを読み込めませんでした"),
  ).toBeInTheDocument();
  expect(today).not.toHaveTextContent("昨日の内容");
  fireEvent.click(
    within(today).getByRole("button", { name: "ノートを再読み込み" }),
  );
  expect(
    await within(today).findByRole("textbox", { name: "日次ノート" }),
  ).toBeInTheDocument();
});

it("switches today's request and edit link after midnight when returning to the dashboard", async () => {
  renderCard();
  await screen.findByRole("textbox", { name: "日次ノート" });
  jest.mocked(getJSTDateString).mockReturnValue("2030-01-04");
  fireEvent(window, new Event("focus"));
  await waitFor(() =>
    expect(dailyPlansApi.get).toHaveBeenCalledWith("2030-01-04"),
  );
  expect(
    screen.getByRole("link", { name: "今日のノートを開く" }),
  ).toHaveAttribute("href", "/scheduling/daily?date=2030-01-04");
});

it("shows three other dates even when today is in the recent results", async () => {
  jest.mocked(dailyPlansApi.list).mockResolvedValue({
    items: ["2030-01-03", "2030-01-02", "2030-01-01", "2029-12-31"].map(
      (date) => ({
        date,
        revision: 1,
        title: `記録 ${date}`,
        preview: "本文",
        updated_at: date,
      }),
    ),
    next_cursor: null,
  });
  renderCard();
  expect(await screen.findByText("記録 2029-12-31")).toBeInTheDocument();
  expect(screen.getByText("記録 2030-01-02")).toBeInTheDocument();
  expect(screen.getByText("記録 2030-01-01")).toBeInTheDocument();
  expect(screen.queryByText("記録 2030-01-03")).not.toBeInTheDocument();
});

function typeMemo(note: HTMLElement, text: string) {
  fireEvent.paste(note, { clipboardData: { getData: (type: string) => type === "text/plain" ? text : "" } });
}

it("edits and autosaves a blank note in place without page chrome or history sidebar", async () => {
  renderCard();
  const note = await screen.findByRole("textbox", { name: "日次ノート" });
  expect(screen.queryByRole("complementary", { name: "日次ノートの履歴" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "詳細モード" })).not.toBeInTheDocument();
  typeMemo(note, "ダッシュボードから記録");
  await waitFor(() => expect(dailyPlansApi.update).toHaveBeenCalledWith("2030-01-03", 0,
    expect.objectContaining({ blocks: expect.arrayContaining([expect.objectContaining({ text: "ダッシュボードから記録" })]) })), { timeout: 2500 });
  expect(mockPush).not.toHaveBeenCalled();
});

it("waits for the pending save before following a notebook link", async () => {
  let resolveSave!: (value: Awaited<ReturnType<typeof dailyPlansApi.update>>) => void;
  jest.mocked(dailyPlansApi.update).mockImplementation(() => new Promise((resolve) => { resolveSave = resolve; }));
  renderCard();
  typeMemo(await screen.findByRole("textbox", { name: "日次ノート" }), "移動前のメモ");
  fireEvent.click(screen.getByRole("link", { name: "ノート一覧・検索" }));
  await waitFor(() => expect(dailyPlansApi.update).toHaveBeenCalled());
  expect(mockPush).not.toHaveBeenCalled();
  const [date, revision, document] = jest.mocked(dailyPlansApi.update).mock.calls[0]!;
  await act(async () => resolveSave({ date, revision: revision + 1, document }));
  expect(mockPush).toHaveBeenCalledWith("/notes");
});

it("keeps yesterday's draft on a failed midnight save and retries the transition", async () => {
  jest.mocked(dailyPlansApi.update).mockRejectedValueOnce(new ApiError("invalid", 422));
  renderCard();
  typeMemo(await screen.findByRole("textbox", { name: "日次ノート" }), "日付をまたぐメモ");
  jest.mocked(getJSTDateString).mockReturnValue("2030-01-04");
  fireEvent(window, new Event("focus"));
  await screen.findByRole("button", { name: "移動を再試行" });
  expect(dailyPlansApi.get).not.toHaveBeenCalledWith("2030-01-04");
  expect(screen.getByRole("textbox", { name: "日次ノート" })).toHaveTextContent("日付をまたぐメモ");
  expect(screen.getByRole("link", { name: "今日のノートを開く" })).toHaveAttribute("href", "/scheduling/daily?date=2030-01-03");
  fireEvent.click(screen.getByRole("button", { name: "移動を再試行" }));
  await waitFor(() => expect(dailyPlansApi.get).toHaveBeenCalledWith("2030-01-04"));
  expect(jest.mocked(dailyPlansApi.update).mock.calls.every(([date]) => date === "2030-01-03")).toBe(true);
});
