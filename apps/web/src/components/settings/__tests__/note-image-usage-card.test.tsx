// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { NoteImageUsageCard } from "../note-image-usage-card";
import { notesApi } from "@/lib/api";

jest.mock("@/lib/api", () => ({
  notesApi: { getAttachmentUsage: jest.fn() },
}));

const MB = 1024 * 1024;

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <NoteImageUsageCard />
    </QueryClientProvider>,
  );
}

beforeEach(() => jest.clearAllMocks());

it("shows how much is used, of how much, and how many images", async () => {
  jest.mocked(notesApi.getAttachmentUsage).mockResolvedValue({
    used_bytes: 900 * 1024,
    limit_bytes: 200 * MB,
    count: 12,
  });
  renderCard();

  expect(await screen.findByText(/0\.9 MB \/ 200 MB（12\s*枚）/)).toBeInTheDocument();
  expect(screen.getByLabelText("画像の保存量")).toBeInTheDocument();
});

it("says when the usage cannot be read", async () => {
  jest.mocked(notesApi.getAttachmentUsage).mockRejectedValue(new Error("down"));
  renderCard();

  expect(await screen.findByRole("alert")).toHaveTextContent("保存量を読み込めませんでした");
});
