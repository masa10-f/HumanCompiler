// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WeekStartCard } from "../week-start-card";
import { weekStartApi } from "@/lib/api";

jest.mock("@/lib/api", () => ({
  weekStartApi: { get: jest.fn(), update: jest.fn() },
}));

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <WeekStartCard />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(weekStartApi.get).mockResolvedValue({ week_start_day: "sunday" });
  jest
    .mocked(weekStartApi.update)
    .mockImplementation(async (settings) => settings);
});

it("offers every weekday and saves the choice", async () => {
  renderCard();
  const select = screen.getByLabelText("週の始まり");
  await waitFor(() => expect(select).toHaveValue("sunday"));

  expect(
    Array.from(select.querySelectorAll("option")).map((option) => option.textContent),
  ).toEqual(["日曜日", "月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日"]);

  fireEvent.change(select, { target: { value: "wednesday" } });

  await waitFor(() =>
    expect(weekStartApi.update).toHaveBeenCalledWith({ week_start_day: "wednesday" }),
  );
  expect(await screen.findByText("保存しました")).toBeInTheDocument();
  expect(select).toHaveValue("wednesday");
});

it("says when saving fails", async () => {
  jest.mocked(weekStartApi.update).mockRejectedValue(new Error("down"));
  renderCard();
  const select = screen.getByLabelText("週の始まり");
  await waitFor(() => expect(select).toHaveValue("sunday"));

  fireEvent.change(select, { target: { value: "friday" } });

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "週の始まりを保存できませんでした",
  );
});
