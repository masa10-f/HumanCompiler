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
  jest.mocked(dailyPlansApi.list).mockResolvedValue({
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
  jest.mocked(dailyPlansApi.list).mockResolvedValueOnce({
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

it("refreshes saved previews without discarding older pages or resetting the cursor", async () => {
  jest.useFakeTimers();
  try {
    const view = render(
      <DailyPlanHistory
        selectedDate="2030-01-02"
        revision={1}
        disabled={false}
        onSelect={onSelect}
      />,
    );
    await act(async () => {});
    jest
      .mocked(dailyPlansApi.list)
      .mockResolvedValueOnce({
        items: [item("2030-01-01", "過去")],
        next_cursor: "2030-01-01",
      });
    fireEvent.click(screen.getByRole("button", { name: "さらに過去のノート" }));
    await act(async () => {});
    const list = screen.getByRole("list");
    list.scrollTop = 120;
    jest
      .mocked(dailyPlansApi.list)
      .mockResolvedValueOnce({
        items: [item("2030-01-02", "更新済み")],
        next_cursor: null,
      });
    view.rerender(
      <DailyPlanHistory
        selectedDate="2030-01-02"
        revision={2}
        disabled={false}
        onSelect={onSelect}
      />,
    );
    expect(screen.queryByText("履歴を読み込み中…")).not.toBeInTheDocument();
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    view.rerender(
      <DailyPlanHistory
        selectedDate="2030-01-02"
        revision={3}
        disabled={false}
        onSelect={onSelect}
      />,
    );
    expect(dailyPlansApi.list).toHaveBeenCalledTimes(2);
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(
      screen.getByRole("button", { name: /2030-01-01 過去/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /2030-01-02 更新済み/ }),
    ).toBeInTheDocument();
    expect(list.scrollTop).toBe(120);
    expect(dailyPlansApi.list).toHaveBeenLastCalledWith({
      date_from: "2030-01-02",
      date_to: "2030-01-02",
      limit: 1,
    });
    jest
      .mocked(dailyPlansApi.list)
      .mockResolvedValueOnce({ items: [], next_cursor: null });
    fireEvent.click(screen.getByRole("button", { name: "さらに過去のノート" }));
    await act(async () => {});
    expect(dailyPlansApi.list).toHaveBeenLastCalledWith({
      before: "2030-01-01",
      limit: 20,
    });
    const calls = jest.mocked(dailyPlansApi.list).mock.calls.length;
    view.rerender(
      <DailyPlanHistory
        selectedDate="2030-01-01"
        revision={1}
        disabled={false}
        onSelect={onSelect}
      />,
    );
    await act(async () => {
      jest.advanceTimersByTime(3000);
    });
    expect(dailyPlansApi.list).toHaveBeenCalledTimes(calls);
  } finally {
    jest.useRealTimers();
  }
});

it("removes an edited note that no longer matches the search without removing other pages", async () => {
  jest.useFakeTimers();
  try {
    const view = render(
      <DailyPlanHistory
        selectedDate="2030-01-02"
        revision={1}
        disabled={false}
        onSelect={onSelect}
      />,
    );
    await act(async () => {});
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "研究" },
    });
    fireEvent.click(screen.getByRole("button", { name: "検索" }));
    await act(async () => {});
    jest
      .mocked(dailyPlansApi.list)
      .mockResolvedValueOnce({ items: [], next_cursor: null });
    view.rerender(
      <DailyPlanHistory
        selectedDate="2030-01-02"
        revision={2}
        disabled={false}
        onSelect={onSelect}
      />,
    );
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(dailyPlansApi.list).toHaveBeenLastCalledWith({
      query: "研究",
      date_from: "2030-01-02",
      date_to: "2030-01-02",
      limit: 1,
    });
    expect(
      screen.queryByRole("button", { name: /2030-01-02 研究/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "さらに過去のノート" }),
    ).toBeInTheDocument();
  } finally {
    jest.useRealTimers();
  }
});
