// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { DailyNotesCard } from "../daily-notes-card";
import { dailyPlansApi } from "@/lib/api";

jest.mock("@/lib/api", () => ({ dailyPlansApi: { list: jest.fn() } }));
jest.mock("@/lib/date-utils", () => ({ getJSTDateString: () => "2030-01-03" }));

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
  jest
    .mocked(dailyPlansApi.list)
    .mockResolvedValue({
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
  expect(dailyPlansApi.list).toHaveBeenCalledWith({ limit: 3 });
});

it("keeps the entry links usable before a first note exists", async () => {
  jest
    .mocked(dailyPlansApi.list)
    .mockResolvedValue({ items: [], next_cursor: null });
  renderCard();
  expect(
    await screen.findByText(/今日のノートから書き始めると/),
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
    await screen.findByText(/今日のノートから書き始めると/),
  ).toBeInTheDocument();
});
