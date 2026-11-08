// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

/**
 * @jest-environment jsdom
 */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { WeeklyRhythmEditor } from "../weekly-rhythm-editor";
import { weeklyRhythmApi } from "@/lib/api";
import type { WeeklyRhythm } from "@/types/weekly-rhythm";

jest.mock("@/lib/api", () => ({
  weeklyRhythmApi: { get: jest.fn(), replace: jest.fn(), applyToTriage: jest.fn() },
}));

jest.mock("@/hooks/use-project-query", () => ({
  useProjectOptions: () => ({
    data: [
      { id: "phd", title: "PhD", status: "in_progress" },
      { id: "side", title: "副業", status: "in_progress" },
      { id: "old", title: "Old", status: "completed" },
    ],
  }),
}));

const emptyDays = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
  weekday,
  schedule_minutes: 0,
  event_minutes: 0,
  break_minutes: 0,
}));

const savedRhythm: WeeklyRhythm = {
  blocks: [
    {
      id: "mon-phd",
      weekday: 0,
      start: "09:00",
      end: "16:00",
      kind: "schedule",
      title: "実験",
      project_id: "phd",
      work_type: "focused_work",
      locked: true,
    },
  ],
  summary: {
    days: emptyDays.map((day) =>
      day.weekday === 0 ? { ...day, schedule_minutes: 420 } : day,
    ),
    projects: [
      {
        project_id: "phd",
        project_title: "PhD",
        project_status: "in_progress",
        minutes: 420,
        locked_minutes: 420,
      },
    ],
    total_schedule_minutes: 420,
    triage_allocation: {
      effective_capacity_hours: 7,
      project_allocations: { phd: 100 },
      inbox_allocation_percent: 0,
    },
  },
  updated_at: "2026-11-08T00:00:00Z",
};

function renderEditor() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <WeeklyRhythmEditor />
    </QueryClientProvider>,
  );
}

describe("WeeklyRhythmEditor", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(weeklyRhythmApi.get).mockResolvedValue(savedRhythm);
    jest
      .mocked(weeklyRhythmApi.replace)
      .mockImplementation(async (blocks) => ({
        ...savedRhythm,
        blocks: blocks.map((block, index) => ({
          ...block,
          id: `saved-${index}`,
          title: block.title ?? null,
          project_id: block.project_id ?? null,
        })),
      }));
  });

  it("shows the saved template and weekly totals", async () => {
    renderEditor();

    expect(await screen.findByLabelText("月曜 09:00-16:00 の名前")).toHaveValue("実験");
    expect(screen.getByLabelText("月曜 09:00-16:00 のプロジェクト")).toHaveValue("phd");
    expect(screen.getByLabelText("月曜 09:00-16:00 を動かさない")).toBeChecked();
    const table = screen.getByRole("table");
    expect(within(table).getByText("PhD")).toBeInTheDocument();
    expect(within(table).getAllByText("7h")).toHaveLength(3);
    expect(within(table).getAllByText("100%")).toHaveLength(2);
    // Completed projects are offered only when the template already uses them.
    expect(screen.queryByRole("option", { name: /Old/ })).not.toBeInTheDocument();
  });

  it("adds a line after the last one and saves the whole template", async () => {
    renderEditor();
    await screen.findByLabelText("月曜 09:00-16:00 の名前");

    // The week is shown from Sunday, so Monday's button is the second one.
    fireEvent.click(screen.getAllByRole("button", { name: "枠を追加" })[1]!);
    fireEvent.change(screen.getByLabelText("月曜 16:00-17:00 の終了"), { target: { value: "18:00" } });
    fireEvent.change(screen.getByLabelText("月曜 16:00-18:00 のプロジェクト"), { target: { value: "side" } });
    fireEvent.change(screen.getByLabelText("月曜 16:00-18:00 の作業タイプ"), { target: { value: "light_work" } });
    expect(screen.getByText("未保存の変更があります")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "トリアージ配分に反映" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(weeklyRhythmApi.replace).toHaveBeenCalledWith([
        expect.objectContaining({ weekday: 0, start: "09:00", end: "16:00", project_id: "phd", locked: true }),
        {
          weekday: 0,
          start: "16:00",
          end: "18:00",
          kind: "schedule",
          title: null,
          project_id: "side",
          work_type: "light_work",
          locked: false,
        },
      ]),
    );
    expect(await screen.findByText("週のリズムを保存しました")).toBeInTheDocument();
  });

  it("keeps edits made while a save is in flight", async () => {
    let finishSave: (value: WeeklyRhythm) => void = () => {};
    jest.mocked(weeklyRhythmApi.replace).mockImplementation(
      () => new Promise((resolve) => { finishSave = resolve; }),
    );
    renderEditor();
    await screen.findByLabelText("月曜 09:00-16:00 の名前");
    fireEvent.change(screen.getByLabelText("月曜 09:00-16:00 の名前"), { target: { value: "実験A" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(weeklyRhythmApi.replace).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText("月曜 09:00-16:00 の名前"), { target: { value: "実験B" } });
    await act(async () => {
      finishSave({ ...savedRhythm, blocks: [{ ...savedRhythm.blocks[0]!, title: "実験A" }] });
    });

    expect(screen.getByLabelText("月曜 09:00-16:00 の名前")).toHaveValue("実験B");
    expect(screen.getByText("保存しました。保存中に加えた変更はまだ保存されていません")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存" })).toBeEnabled();
  });

  it("blocks saving overlapping lines and fixed events without a name", async () => {
    renderEditor();
    await screen.findByLabelText("月曜 09:00-16:00 の名前");
    fireEvent.click(screen.getAllByRole("button", { name: "枠を追加" })[1]!); // Monday
    fireEvent.change(screen.getByLabelText("月曜 16:00-17:00 の開始"), { target: { value: "15:00" } });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "月曜の予定枠 09:00-16:00 と 15:00-17:00 が重なっています",
    );
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("月曜 15:00-17:00 の種類"), { target: { value: "break" } });
    expect(screen.queryByLabelText("月曜 15:00-17:00 のプロジェクト")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("月曜の休憩 15:00-17:00 に名前を入力してください");
    fireEvent.change(screen.getByLabelText("月曜 15:00-17:00 の名前"), { target: { value: "休憩" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(weeklyRhythmApi.replace).toHaveBeenCalled());
    // A break never carries a project.
    expect(jest.mocked(weeklyRhythmApi.replace).mock.calls[0]![0][1]).toMatchObject({
      kind: "break",
      title: "休憩",
      project_id: null,
    });
  });

  it("copies a weekday onto other weekdays, replacing their lines", async () => {
    renderEditor();
    await screen.findByLabelText("月曜 09:00-16:00 の名前");

    fireEvent.click(screen.getAllByRole("button", { name: "ほかの曜日にコピー" })[1]!); // Monday
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "火曜にコピー" }));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "水曜にコピー" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "コピー" }));

    expect(screen.getByLabelText("火曜 09:00-16:00 の名前")).toHaveValue("実験");
    expect(screen.getByLabelText("水曜 09:00-16:00 のプロジェクト")).toHaveValue("phd");
    expect(screen.getAllByTestId("rhythm-block")).toHaveLength(3);
  });

  it("applies the saved totals to triage after confirmation", async () => {
    jest.mocked(weeklyRhythmApi.applyToTriage).mockResolvedValue({
      weekly_capacity_hours: 12,
      meeting_buffer_hours: 5,
    } as Awaited<ReturnType<typeof weeklyRhythmApi.applyToTriage>>);
    renderEditor();
    await screen.findByLabelText("月曜 09:00-16:00 の名前");

    fireEvent.click(screen.getByRole("button", { name: "トリアージ配分に反映" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("7h");
    fireEvent.click(within(dialog).getByRole("button", { name: "反映する" }));

    await waitFor(() => expect(weeklyRhythmApi.applyToTriage).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByText(/トリアージの容量を週12h（会議バッファ\s*5h を含む）に設定しました/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "トリアージ設定を開く" })).toHaveAttribute(
      "href",
      "/settings#triage-settings",
    );
  });
});
