// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

import { useState } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  DailyPlanNoteEditor,
  type NoteGoalOption,
  type NoteProjectOption,
} from "../daily-plan-note-editor";
import type { DailyPlanDocumentV1 } from "@/types/daily-plan";

const changed = jest.fn();
function Notebook({
  initial = { schema_version: 1, blocks: [] },
  projects = [],
  goals = [],
  withoutTasks = false,
}: {
  initial?: DailyPlanDocumentV1;
  projects?: NoteProjectOption[];
  goals?: NoteGoalOption[];
  withoutTasks?: boolean;
}) {
  const [document, setDocument] = useState(initial);
  return (
    <DailyPlanNoteEditor
      document={document}
      onChange={(next) => {
        changed(next);
        setDocument(next);
      }}
      projectOptions={projects}
      goalOptions={goals}
      taskOptions={
        withoutTasks
          ? []
          : [
              {
                key: "task:paper",
                ref: { source: "task", id: "paper" },
                title: "論文を読む",
                workType: "study",
                remainingHours: 2,
                projectTitle: "研究",
                goalTitle: "調査",
              },
            ]
      }
      renderBlock={(block) => (
        <div>
          {block.type === "schedule_directive"
            ? `予定: ${block.title ?? "自動配置"}`
            : "固定予定"}
        </div>
      )}
    />
  );
}

beforeAll(() => {
  Range.prototype.getBoundingClientRect = () => ({
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    width: 0,
    height: 0,
    x: 0,
    y: 0,
    toJSON: () => {},
  });
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
});

it("inserts a rich task suggestion in place and keeps the surrounding note", async () => {
  render(
    <Notebook
      initial={{
        schema_version: 1,
        blocks: [
          { id: "before", type: "text", text: "今日のメモ" },
          { id: "slash", type: "text", text: "/schedule 13:00-16:00 (45m)" },
          { id: "after", type: "text", text: "振り返り" },
        ],
      }}
    />,
  );
  const editor = await screen.findByRole("textbox", { name: "日次ノート" });
  // Select the command paragraph as a user would, without moving to the end of the note.
  const text = editor.querySelectorAll("p")[1]!.firstChild!;
  const selection = window.getSelection()!;
  act(() => {
    editor.focus();
    selection.collapse(text, text.textContent!.length);
  });
  fireEvent(document, new Event("selectionchange"));
  const candidate = await screen.findByRole("option", { name: /論文を読む/ });
  expect(candidate).toHaveTextContent("研究 / 調査 · 残り 120分");
  fireEvent.click(candidate);
  expect(await screen.findByText("予定: 論文を読む")).toBeInTheDocument();
  const saved = changed.mock.calls.at(-1)![0] as DailyPlanDocumentV1;
  expect(saved.blocks.map((block) => block.type)).toEqual([
    "text",
    "schedule_directive",
    "text",
    "text",
  ]);
  expect(saved.blocks[1]).toMatchObject({
    task_ref: { source: "task", id: "paper" },
    duration_override_minutes: 45,
    allowed_windows: [{ start: "13:00", end: "16:00" }],
  });
  expect(editor).toHaveTextContent("今日のメモ");
  expect(editor).toHaveTextContent("振り返り");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("keeps headings and editable task progress when reopening a note", async () => {
  render(
    <Notebook
      initial={{
        schema_version: 1,
        blocks: [
          {
            id: "heading",
            type: "text",
            text: "振り返り",
            content: {
              type: "heading",
              attrs: { level: 2 },
              content: [{ type: "text", text: "振り返り" }],
            },
          },
          {
            id: "list",
            type: "text",
            text: "調査済み",
            content: {
              type: "taskList",
              content: [
                {
                  type: "taskItem",
                  attrs: { checked: false },
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "調査済み" }],
                    },
                  ],
                },
              ],
            },
          },
        ],
      }}
    />,
  );
  expect(await screen.findByRole("heading", { level: 2 })).toHaveTextContent(
    "振り返り",
  );
  fireEvent.click(screen.getByRole("checkbox"));
  await waitFor(() =>
    expect(
      changed.mock.calls.at(-1)![0].blocks[1].content.content[0].attrs.checked,
    ).toBe(true),
  );
  expect(changed.mock.calls.at(-1)![0].blocks[0].content.type).toBe("heading");
});

it("cancels suggestions without converting ordinary Enter to a form", async () => {
  render(<Notebook />);
  const editor = await screen.findByRole("textbox", { name: "日次ノート" });
  fireEvent.paste(editor, {
    clipboardData: {
      getData: (type: string) => (type === "text/plain" ? "/schedule" : ""),
    },
  });
  await screen.findByRole("dialog", { name: "スケジュールの提案" });
  fireEvent.keyDown(editor, { key: "Escape" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(editor).toHaveTextContent("/schedule");
  fireEvent.keyDown(editor, { key: "Enter" });
  expect(screen.queryByText("予定: 自動配置")).not.toBeInTheDocument();
});

it("chooses tasks by keyboard and preserves the command on undo", async () => {
  render(<Notebook />);
  const editor = await screen.findByRole("textbox", { name: "日次ノート" });
  fireEvent.paste(editor, {
    clipboardData: {
      getData: (type: string) =>
        type === "text/plain" ? "/schedule 10:00-12:00" : "",
    },
  });
  await screen.findByRole("dialog");
  fireEvent.keyDown(editor, { key: "ArrowDown" });
  fireEvent.keyDown(editor, { key: "Enter" });
  expect(await screen.findByText("予定: 論文を読む")).toBeInTheDocument();
  fireEvent.keyDown(editor, { key: "z", ctrlKey: true });
  expect(screen.queryByText("予定: 論文を読む")).not.toBeInTheDocument();
  expect(editor).toHaveTextContent("/schedule 10:00-12:00");
});

it("requires correction of an invalid time range instead of silently replacing it", async () => {
  render(<Notebook />);
  const editor = await screen.findByRole("textbox", { name: "日次ノート" });
  fireEvent.paste(editor, {
    clipboardData: {
      getData: (type: string) =>
        type === "text/plain" ? "/schedule 17:00-09:00" : "",
    },
  });
  await screen.findByRole("alert");
  expect(
    screen.getByRole("option", {
      name: "この時間帯を条件に合うタスクで埋める",
    }),
  ).toBeDisabled();
  fireEvent.change(screen.getByLabelText("提案の終了時刻"), {
    target: { value: "18:00" },
  });
  fireEvent.click(
    screen.getByRole("option", {
      name: "この時間帯を条件に合うタスクで埋める",
    })!,
  );
  expect(await screen.findByText("予定: 自動配置")).toBeInTheDocument();
  expect(changed.mock.calls.at(-1)![0].blocks[0].allowed_windows).toEqual([
    { start: "17:00", end: "18:00" },
  ]);
});

it("edits and inserts schedules when randomUUID is unavailable on an HTTP origin", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(
    globalThis.crypto,
    "randomUUID",
  );
  Object.defineProperty(globalThis.crypto, "randomUUID", {
    configurable: true,
    value: undefined,
  });
  try {
    render(<Notebook />);
    const editor = await screen.findByRole("textbox", { name: "日次ノート" });
    fireEvent.paste(editor, {
      clipboardData: {
        getData: (type: string) =>
          type === "text/plain" ? "/schedule 10:00-12:00" : "",
      },
    });
    fireEvent.keyDown(editor, { key: "Enter" });
    expect(await screen.findByText("予定: 自動配置")).toBeInTheDocument();
    fireEvent.paste(editor, {
      clipboardData: {
        getData: (type: string) => (type === "text/plain" ? "追記" : ""),
      },
    });
    const saved = changed.mock.calls.at(-1)![0] as DailyPlanDocumentV1;
    expect(saved.blocks.map((block) => block.type)).toEqual([
      "schedule_directive",
      "text",
    ]);
    expect(new Set(saved.blocks.map((block) => block.id)).size).toBe(2);
    expect(saved.blocks[1]).toMatchObject({ text: "追記" });
  } finally {
    if (descriptor)
      Object.defineProperty(globalThis.crypto, "randomUUID", descriptor);
    else Reflect.deleteProperty(globalThis.crypto, "randomUUID");
  }
});

it.each(["bulletList", "orderedList", "taskList", "blockquote"])(
  "saves %s without leaking editor identity attributes into nested content",
  async (type) => {
    const paragraph = {
      type: "paragraph",
      content: [{ type: "text", text: "メモ" }],
    };
    const content =
      type === "blockquote"
        ? [paragraph]
        : [
            {
              type: type === "taskList" ? "taskItem" : "listItem",
              ...(type === "taskList" ? { attrs: { checked: false } } : {}),
              content: [paragraph],
            },
          ];
    render(
      <Notebook
        initial={{
          schema_version: 1,
          blocks: [
            {
              id: "list",
              type: "text",
              text: "メモ",
              content: { type, content },
            },
          ],
        }}
      />,
    );
    const editor = await screen.findByRole("textbox", { name: "日次ノート" });
    fireEvent.paste(editor, {
      clipboardData: {
        getData: (mime: string) => (mime === "text/plain" ? "追記" : ""),
      },
    });
    const saved = changed.mock.calls.at(-1)![0] as DailyPlanDocumentV1;
    expect(JSON.stringify(saved)).not.toContain("planId");
    expect(saved.blocks[0]).toMatchObject({
      id: "list",
      type: "text",
      content: { type },
    });
  },
);

it.each(["1200-1400 /schedule", "/schedule 1200-1400", "12:00 – 14:00 /s"])(
  "uses the time window from %s when choosing with the keyboard",
  async (text) => {
    render(<Notebook />);
    const editor = await screen.findByRole("textbox", { name: "日次ノート" });
    fireEvent.paste(editor, {
      clipboardData: {
        getData: (type: string) => (type === "text/plain" ? text : ""),
      },
    });
    await screen.findByRole("dialog", { name: "スケジュールの提案" });
    expect(screen.getByLabelText("提案の開始時刻")).toHaveValue("12:00");
    expect(screen.getByLabelText("提案の終了時刻")).toHaveValue("14:00");
    fireEvent.keyDown(editor, { key: "ArrowDown" });
    fireEvent.keyDown(editor, { key: "Enter" });
    expect(await screen.findByText("予定: 論文を読む")).toBeInTheDocument();
    expect(changed.mock.calls.at(-1)![0].blocks[0]).toMatchObject({
      type: "schedule_directive",
      task_ref: { id: "paper" },
      allowed_windows: [{ start: "12:00", end: "14:00" }],
    });
  },
);

it("keeps a time-prefixed command as prose after dismissal", async () => {
  render(<Notebook />);
  const editor = await screen.findByRole("textbox", { name: "日次ノート" });
  fireEvent.paste(editor, {
    clipboardData: {
      getData: (type: string) =>
        type === "text/plain" ? "1200-1400 /schedule" : "",
    },
  });
  await screen.findByRole("dialog");
  fireEvent.keyDown(editor, { key: "Escape" });
  fireEvent.keyDown(editor, { key: "Enter" });
  expect(
    changed.mock.calls
      .at(-1)![0]
      .blocks.every((block: { type: string }) => block.type === "text"),
  ).toBe(true);
  expect(editor).toHaveTextContent("1200-1400 /schedule");
});

it.each([
  [
    "プロジェクト",
    "新しい研究",
    { project_ids: ["project-empty"], goal_ids: [] },
  ],
  ["ゴール", "企画する", { project_ids: [], goal_ids: ["goal-empty"] }],
])(
  "selects a %s without any registered tasks",
  async (category, title, filter) => {
    render(
      <Notebook
        withoutTasks
        projects={[{ id: "project-empty", title: "新しい研究" }]}
        goals={[
          {
            id: "goal-empty",
            title: "企画する",
            projectId: "project-empty",
            projectTitle: "新しい研究",
          },
        ]}
      />,
    );
    const editor = await screen.findByRole("textbox", { name: "日次ノート" });
    fireEvent.paste(editor, {
      clipboardData: {
        getData: (type: string) =>
          type === "text/plain" ? "1200-1400 /schedule (45m)" : "",
      },
    });
    await screen.findByRole("dialog");
    fireEvent.click(
      screen.getByRole("button", { name: category as string, exact: true }),
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "予定に入れる候補を検索" }),
      { target: { value: title } },
    );
    fireEvent.click(
      screen.getByRole("option", { name: new RegExp(title as string) }),
    );
    expect(await screen.findByText(`予定: ${title}`)).toBeInTheDocument();
    expect(changed.mock.calls.at(-1)![0].blocks[0]).toMatchObject({
      type: "schedule_directive",
      mode: "filter",
      title,
      filter: { ...(filter as object), work_types: [] },
      duration_override_minutes: 45,
      allowed_windows: [{ start: "12:00", end: "14:00" }],
    });
    expect(changed.mock.calls.at(-1)![0].blocks[0].task_ref).toBeUndefined();
  },
);
