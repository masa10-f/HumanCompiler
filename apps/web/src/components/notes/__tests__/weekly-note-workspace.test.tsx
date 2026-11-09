// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { WeeklyNoteWorkspace } from "../weekly-note-workspace";
import { dailyPlansApi, weekStartApi, weeklyNotesApi } from "@/lib/api";
import { weekStartOf, type WeekStartDay } from "@/lib/weekly-note";

jest.mock("@/lib/api", () => ({
  dailyPlansApi: { list: jest.fn() },
  weeklyNotesApi: { list: jest.fn(), get: jest.fn(), update: jest.fn() },
  weekStartApi: { get: jest.fn(), update: jest.fn() },
}));
jest.mock("@/lib/date-utils", () => ({
  getJSTDateString: jest.fn(() => "2026-11-04"),
}));
// The rich-text editor is covered by its own tests.
jest.mock("../context-note-panel", () => ({
  ContextNotePanel: ({ content, emptyTitle }: { content: string; emptyTitle: string }) => (
    <div data-testid="panel">{content || emptyTitle}</div>
  ),
}));

let startDay: WeekStartDay = "sunday";

beforeEach(() => {
  jest.clearAllMocks();
  startDay = "sunday";
  jest
    .mocked(weekStartApi.get)
    .mockImplementation(async () => ({ week_start_day: startDay }));
  // A stand-in for the server: the week of the day under the current setting.
  jest.mocked(weeklyNotesApi.get).mockImplementation(async (day) => {
    const weekStart = weekStartOf(day, startDay);
    const saved = weekStart === "2026-11-01";
    return {
      id: saved ? "note-1" : null,
      week_start: weekStart,
      week_end: "",
      content: saved ? "<p>今週の目標</p>" : "",
      content_type: "html",
      created_at: null,
      updated_at: saved ? "2026-11-03T00:00:00+00:00" : null,
    };
  });
  jest.mocked(weeklyNotesApi.list).mockResolvedValue({
    items: [
      {
        week_start: "2026-11-01",
        week_end: "2026-11-07",
        updated_at: "2026-11-03T00:00:00+00:00",
        preview: "今週の目標",
      },
      {
        week_start: "2026-10-18",
        week_end: "2026-10-24",
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

function renderWorkspace(day = "2026-11-04", onDayChange = jest.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <WeeklyNoteWorkspace day={day} onDayChange={onDayChange} />
    </QueryClientProvider>,
  );
  return onDayChange;
}

it("shows the week the server resolved, its daily notes and recent weekly notes", async () => {
  renderWorkspace();

  expect(
    await screen.findByRole("heading", { name: "2026年11月1日（日）〜7日（土）" }),
  ).toBeInTheDocument();
  expect(screen.getByText("今週", { selector: "p" })).toBeInTheDocument();
  expect(screen.getByTestId("panel")).toHaveTextContent("今週の目標");
  expect(weeklyNotesApi.get).toHaveBeenCalledWith("2026-11-04");
  await waitFor(() =>
    expect(dailyPlansApi.list).toHaveBeenCalledWith({
      date_from: "2026-11-01",
      date_to: "2026-11-07",
      limit: 7,
    }),
  );

  const tuesday = await screen.findByRole("link", { name: /11\/3（火）\s*論文の章を書く/ });
  expect(tuesday).toHaveAttribute("href", "/scheduling/daily?date=2026-11-03");
  expect(screen.getByRole("link", { name: /11\/7（土）\s*ノートなし/ })).toHaveAttribute(
    "href",
    "/scheduling/daily?date=2026-11-07",
  );
  // The seven days come before the note, so they show first on phones too.
  const days = within(screen.getByRole("region", { name: "この週の日次ノート" }));
  expect(days.getAllByRole("link")).toHaveLength(7);
  expect(days.getByRole("link", { name: /11\/4（水）/ })).toHaveAttribute(
    "aria-current",
    "date",
  );
  const strip = screen.getByRole("region", { name: "この週の日次ノート" });
  const note = screen.getByRole("region", { name: "週次ノート" });
  expect(strip.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(await screen.findByText("先々週の振り返り")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "今週" })).toBeDisabled();
});

it("moves between weeks from the resolved week", async () => {
  const onDayChange = renderWorkspace("2026-10-20");
  expect(await screen.findByText("2週前")).toBeInTheDocument();
  expect(screen.getByTestId("panel")).toHaveTextContent("この週のノートはまだありません");

  fireEvent.click(screen.getByRole("button", { name: /前の週/ }));
  expect(onDayChange).toHaveBeenLastCalledWith("2026-10-11");
  fireEvent.click(screen.getByRole("button", { name: /次の週/ }));
  expect(onDayChange).toHaveBeenLastCalledWith("2026-10-25");
  fireEvent.click(screen.getByRole("button", { name: "今週" }));
  expect(onDayChange).toHaveBeenLastCalledWith("2026-11-04");

  fireEvent.click(await screen.findByRole("button", { name: /11\/1〜11\/7/ }));
  expect(onDayChange).toHaveBeenLastCalledWith("2026-11-01");
  const current = screen.getByRole("button", { name: /10\/18〜10\/24/ });
  expect(current).toHaveAttribute("aria-current", "true");
  expect(within(current).getByText("先々週の振り返り")).toBeInTheDocument();
});

it("shows the week start with a link to the settings page", async () => {
  startDay = "wednesday";
  renderWorkspace("2026-11-09");

  expect(
    await screen.findByRole("heading", { name: "2026年11月4日（水）〜10日（火）" }),
  ).toBeInTheDocument();
  expect(await screen.findByText(/週の始まり: 水曜日/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "設定で変更" })).toHaveAttribute(
    "href",
    "/settings",
  );
});
