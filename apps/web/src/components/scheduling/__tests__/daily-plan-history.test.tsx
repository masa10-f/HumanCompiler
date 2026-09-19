// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { DailyPlanHistory } from "../daily-plan-history";
import { dailyPlansApi } from "@/lib/api";
import type { DailyPlanHistoryResponse } from "@/types/daily-plan";

jest.mock("@/lib/api", () => ({ dailyPlansApi: { list: jest.fn() } }));
const item = (date: string, title: string) => ({
  date,
  title,
  preview: `${title}のメモ`,
  revision: 1,
  updated_at: `${date}T12:00:00Z`,
});
const onSelect = jest.fn().mockResolvedValue(undefined);
beforeEach(() => {
  jest
    .mocked(dailyPlansApi.list)
    .mockResolvedValue({
      items: [item("2030-01-02", "研究")],
      next_cursor: "2030-01-02",
    });
});

it("opens history entries, searches by text and date, and paginates with the same filters", async () => {
  render(
    <DailyPlanHistory
      selectedDate="2030-01-03"
      revision={1}
      disabled={false}
      onSelect={onSelect}
    />,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: /2030-01-02 研究/ }),
  );
  expect(onSelect).toHaveBeenCalledWith("2030-01-02");
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: "論文" },
  });
  fireEvent.change(screen.getByLabelText("履歴の開始日"), {
    target: { value: "2030-01-01" },
  });
  fireEvent.click(screen.getByRole("button", { name: "検索" }));
  await waitFor(() =>
    expect(dailyPlansApi.list).toHaveBeenCalledWith({
      query: "論文",
      date_from: "2030-01-01",
      date_to: "",
      limit: 20,
    }),
  );
  await screen.findByRole("button", { name: /2030-01-02 研究/ });
  jest
    .mocked(dailyPlansApi.list)
    .mockResolvedValueOnce({
      items: [item("2030-01-01", "過去")],
      next_cursor: null,
    });
  fireEvent.click(screen.getByRole("button", { name: "さらに過去のノート" }));
  expect(
    await screen.findByRole("button", { name: /2030-01-01 過去/ }),
  ).toBeInTheDocument();
  expect(dailyPlansApi.list).toHaveBeenLastCalledWith({
    query: "論文",
    date_from: "2030-01-01",
    date_to: "",
    before: "2030-01-02",
    limit: 20,
  });
});

it("ignores a late response from a superseded search", async () => {
  let finish: (result: DailyPlanHistoryResponse) => void = () => {};
  jest.mocked(dailyPlansApi.list).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(
    <DailyPlanHistory
      selectedDate="2030-01-03"
      revision={1}
      disabled={false}
      onSelect={onSelect}
    />,
  );
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: "最新" },
  });
  fireEvent.click(screen.getByRole("button", { name: "検索" }));
  await screen.findByRole("button", { name: /2030-01-02 研究/ });
  await act(async () =>
    finish({ items: [item("2000-01-01", "古い応答")], next_cursor: null }),
  );
  expect(screen.queryByText("古い応答")).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: /2030-01-02 研究/ }),
  ).toBeInTheDocument();
});

it("keeps history disabled during date transitions and offers retry after failures", async () => {
  jest.mocked(dailyPlansApi.list).mockRejectedValueOnce(new Error("offline"));
  render(
    <DailyPlanHistory
      selectedDate="2030-01-03"
      revision={1}
      disabled
      onSelect={onSelect}
    />,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "ノートの履歴を取得できませんでした",
  );
  fireEvent.click(screen.getByRole("button", { name: "履歴を再読み込み" }));
  expect(
    await screen.findByRole("button", { name: /2030-01-02 研究/ }),
  ).toBeDisabled();
  expect(screen.getByRole("button", { name: "今日へ" })).toBeDisabled();
});
