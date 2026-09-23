// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import NotesPage from "../page";

const mockRouter = { push: jest.fn(), replace: jest.fn() };
let mockAuth = { isAuthenticated: true, loading: false };
jest.mock("next/navigation", () => ({ useRouter: () => mockRouter }));
jest.mock("@/hooks/use-auth", () => ({ useAuth: () => mockAuth }));
jest.mock("@/components/layout/app-header", () => ({ AppHeader: () => null }));
jest.mock("@/components/scheduling/daily-plan-history", () => ({
  DailyPlanHistory: ({
    layout,
    onSelect,
  }: {
    layout: string;
    onSelect: (date: string) => void;
  }) => <button onClick={() => onSelect("2030-01-02")}>履歴 {layout}</button>,
}));

it("opens the selected note from the collection without redirecting on arrival", () => {
  mockAuth = { isAuthenticated: true, loading: false };
  render(<NotesPage />);
  expect(
    screen.getByRole("heading", { name: "ノート一覧" }),
  ).toBeInTheDocument();
  expect(mockRouter.push).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "履歴 collection" }));
  expect(mockRouter.push).toHaveBeenCalledWith(
    "/scheduling/daily?date=2030-01-02",
  );
});

it("does not load private history while authentication is pending or absent", async () => {
  mockAuth = { isAuthenticated: false, loading: true };
  const view = render(<NotesPage />);
  expect(
    screen.queryByRole("button", { name: /履歴/ }),
  ).not.toBeInTheDocument();
  expect(mockRouter.replace).not.toHaveBeenCalled();
  mockAuth = { isAuthenticated: false, loading: false };
  view.rerender(<NotesPage />);
  await waitFor(() =>
    expect(mockRouter.replace).toHaveBeenCalledWith("/login"),
  );
});
