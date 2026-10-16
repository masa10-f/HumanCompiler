// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

import { act, renderHook, waitFor } from "@testing-library/react";
import { goalsApi } from "@/lib/api";
import { useScheduleGoals } from "../use-schedule-goals";

jest.mock("@/lib/api", () => ({ goalsApi: { getByProject: jest.fn() } }));
const fetchGoals = goalsApi.getByProject as jest.Mock;
beforeEach(() => fetchGoals.mockReset());

it("loads all pages without tasks, only after suggestions open", async () => {
  fetchGoals
    .mockResolvedValueOnce(
      Array.from({ length: 100 }, (_, i) => ({
        id: `g${i}`,
        title: `Goal ${i}`,
        status: "pending",
      })),
    )
    .mockResolvedValueOnce([
      { id: "last", title: "Last", status: "in_progress" },
      { id: "done", title: "Done", status: "completed" },
    ]);
  const { result, rerender } = renderHook(
    ({ enabled }) => useScheduleGoals(["project"], enabled),
    { initialProps: { enabled: false } },
  );
  expect(fetchGoals).not.toHaveBeenCalled();
  rerender({ enabled: true });
  await waitFor(() => expect(result.current.goals).toHaveLength(101));
  expect(fetchGoals).toHaveBeenNthCalledWith(2, "project", 100, 100);
  rerender({ enabled: true });
  expect(fetchGoals).toHaveBeenCalledTimes(2);
});

it("keeps available goals on partial failure and allows retry", async () => {
  fetchGoals.mockImplementation((id) =>
    id === "a"
      ? Promise.reject(new Error("offline"))
      : Promise.resolve([{ id: "g", title: "Goal", status: "pending" }]),
  );
  const { result } = renderHook(() => useScheduleGoals(["a", "b"], true));
  await waitFor(() => expect(result.current.error).toBe(true));
  expect(result.current.goals).toHaveLength(1);
  fetchGoals.mockResolvedValue([]);
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.error).toBe(false);
});

it("ignores responses for projects removed while loading", async () => {
  let resolveOld!: (value: unknown[]) => void;
  fetchGoals
    .mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
    )
    .mockResolvedValue([]);
  const { result, rerender } = renderHook(
    ({ ids }) => useScheduleGoals(ids, true),
    { initialProps: { ids: ["old"] } },
  );
  rerender({ ids: ["new"] });
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(async () =>
    resolveOld([{ id: "stale", title: "Stale", status: "pending" }]),
  );
  expect(result.current.goals).toEqual([]);
});
