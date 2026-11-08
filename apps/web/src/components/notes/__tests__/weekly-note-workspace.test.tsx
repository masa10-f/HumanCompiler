// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { WeeklyNoteWorkspace } from "../weekly-note-workspace";
import { dailyPlansApi, weeklyNotesApi } from "@/lib/api";

jest.mock("@/lib/api", () => ({
  dailyPlansApi: { list: jest.fn() },
  weeklyNotesApi: { list: jest.fn(), get: jest.fn(), update: jest.fn() },
}));
jest.mock("@/lib/date-utils", () => ({
  getJSTDateString: jest.fn(() => "2026-11-05"),
}));
// The rich-text editor is covered by its own tests.
jest.mock("../context-note-panel", () => ({
  ContextNotePanel: ({ content, emptyTitle }: { content: string; emptyTitle: string }) => (
    <div data-testid="panel">{content || emptyTitle}</div>
  ),
}));

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(weeklyNotesApi.get).mockImplementation(async (weekStart) => ({
    id: weekStart === "2026-11-02" ? "note-1" : null,
    week_start: weekStart,
    week_end: "2026-11-08",
    content: weekStart === "2026-11-02" ? "<p>今週の目標</p>" : "",
    content_type: "html",
    created_at: null,
    updated_at: weekStart === "2026-11-02" ? "2026-11-03T00:00:00+00:00" : null,
  }));
  jest.mocked(weeklyNotesApi.list).mockResolvedValue({
    items: [
      {
        week_start: "2026-11-02",
        week_end: "2026-11-08",
        updated_at: "2026-11-03T00:00:00+00:00",
        preview: "今週の目標",
      },
      {
        week_start: "2026-10-19",
        week_end: "2026-10-25",
        updated_at: "2026-10-20T00:00:00+00:00",
        preview: "先々週の振り返り",
      },
    ],
    next_cursor: null,
  });
  jest.mocked(dailyPlansApi.list).mockResolvedValue({
    items: [
      {
        date: "2026-11-03",
        revision: 2,
        updated_at: "2026-11-03T00:00:00+00:00",
        title: "論文の章を書く",
        preview: "論文の章を書く",
      },
    ],
    next_cursor: null,
  });
});

function renderWorkspace(weekStart = "2026-11-02", onWeekChange = jest.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <WeeklyNoteWorkspace weekStart={weekStart} onWeekChange={onWeekChange} />
    </QueryClientProvider>,
  );
  return onWeekChange;
}

it("shows the week's note, its daily notes and recent weekly notes", async () => {
  renderWorkspace();

  expect(screen.getByText("2026年 第45週（今週）")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "2026年11月2日（月）〜8日（日）" })).toBeInTheDocument();
  expect(await screen.findByTestId("panel")).toHaveTextContent("今週の目標");
  expect(weeklyNotesApi.get).toHaveBeenCalledWith("2026-11-02");
  expect(dailyPlansApi.list).toHaveBeenCalledWith({
    date_from: "2026-11-02",
    date_to: "2026-11-08",
    limit: 7,
  });

  const tuesday = await screen.findByRole("link", { name: /11\/3（火）\s*論文の章を書く/ });
  expect(tuesday).toHaveAttribute("href", "/scheduling/daily?date=2026-11-03");
  expect(screen.getByRole("link", { name: /11\/8（日）\s*ノートなし/ })).toHaveAttribute(
    "href",
    "/scheduling/daily?date=2026-11-08",
  );

  expect(await screen.findByText("先々週の振り返り")).toBeInTheDocument();
});

it("moves between weeks", async () => {
  const onWeekChange = renderWorkspace("2026-10-19");
  expect(await screen.findByTestId("panel")).toHaveTextContent(
    "この週のノートはまだありません",
  );

  fireEvent.click(screen.getByRole("button", { name: /前の週/ }));
  expect(onWeekChange).toHaveBeenLastCalledWith("2026-10-12");
  fireEvent.click(screen.getByRole("button", { name: /次の週/ }));
  expect(onWeekChange).toHaveBeenLastCalledWith("2026-10-26");
  fireEvent.click(screen.getByRole("button", { name: "今週" }));
  expect(onWeekChange).toHaveBeenLastCalledWith("2026-11-02");

  const recent = await screen.findByRole("button", { name: /11\/2〜11\/8/ });
  fireEvent.click(recent);
  expect(onWeekChange).toHaveBeenLastCalledWith("2026-11-02");
  const current = screen.getByRole("button", { name: /10\/19〜10\/25/ });
  expect(current).toHaveAttribute("aria-current", "true");
  expect(within(current).getByText("先々週の振り返り")).toBeInTheDocument();
});
