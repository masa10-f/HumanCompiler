// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

import { render, screen, waitFor } from "@testing-library/react";
import Home from "../page";
import { APP_HOME } from "@/lib/app-home";

const mockRouter = { replace: jest.fn() };
let mockAuth: { user: { id: string } | null; loading: boolean };
jest.mock("next/navigation", () => ({ useRouter: () => mockRouter }));
jest.mock("@/hooks/use-auth", () => ({ useAuth: () => mockAuth }));

it("waits for the restored session, then opens today’s editable notebook", async () => {
  mockAuth = { user: null, loading: true };
  const view = render(<Home />);
  expect(screen.getByRole("status")).toBeInTheDocument();
  expect(mockRouter.replace).not.toHaveBeenCalled();
  mockAuth = { user: { id: "user" }, loading: false };
  view.rerender(<Home />);
  await waitFor(() =>
    expect(mockRouter.replace).toHaveBeenCalledWith(APP_HOME),
  );
});

it("keeps the public welcome page available when signed out", () => {
  mockAuth = { user: null, loading: false };
  render(<Home />);
  expect(screen.getByRole("link", { name: "Get Started" })).toHaveAttribute(
    "href",
    "/login",
  );
  expect(mockRouter.replace).not.toHaveBeenCalled();
});
