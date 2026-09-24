// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

import {
  DAILY_PLAN_LINE_NOTE_MAX_LENGTH,
  dailyPlanSaveMessage,
  validateDailyPlanNote,
} from "../daily-plan-validation";
import { isPermanentDailyPlanSaveError } from "../daily-plan-editor";
import { ApiError } from "../errors";
import type { DailyPlanDocumentV1 } from "@/types/daily-plan";

const note = (text: string): DailyPlanDocumentV1 => ({
  schema_version: 1,
  blocks: [
    {
      id: "paragraph",
      type: "text",
      text,
      content: { type: "paragraph", content: [{ type: "text", text }] },
    },
  ],
});

it("allows long paragraphs and explains which paragraph exceeds the limit", () => {
  expect(() => validateDailyPlanNote(note("研究".repeat(4000)))).not.toThrow();
  const invalid = note("研究".repeat(26000));
  try {
    validateDailyPlanNote(invalid);
    throw new Error("validation was skipped");
  } catch (error) {
    expect(isPermanentDailyPlanSaveError(error)).toBe(true);
    expect(dailyPlanSaveMessage(error, invalid)).toMatch(
      /1番目の段落・項目.*50,000文字/,
    );
  }
});

it("identifies oversized formatting and excessive nesting before sending a request", () => {
  const rich = note("x".repeat(49990));
  expect(() => validateDailyPlanNote(rich)).toThrow("書式を含む内容");
  let content: { type: string; content: unknown[] } = {
    type: "paragraph",
    content: [],
  };
  for (let i = 0; i < 22; i++)
    content = { type: "blockquote", content: [content] };
  expect(() =>
    validateDailyPlanNote({
      schema_version: 1,
      blocks: [{ id: "deep", type: "text", text: "", content }],
    }),
  ).toThrow("入れ子が深すぎます");
});

it("bounds total UTF-8 size and the number of blocks with actionable messages", () => {
  const block = note("あ".repeat(20000)).blocks[0]!;
  expect(() =>
    validateDailyPlanNote({
      schema_version: 1,
      blocks: Array.from({ length: 45 }, (_, index) => ({
        ...block,
        id: String(index),
      })),
    }),
  ).toThrow("5MB");
  expect(() =>
    validateDailyPlanNote({
      schema_version: 1,
      blocks: Array.from({ length: 501 }, (_, index) => ({
        id: String(index),
        type: "text",
        text: "",
      })),
    }),
  ).toThrow("500件");
});

it("maps API validation locations to the affected note item without exposing raw JSON", () => {
  const error = new ApiError(422, "validation failed", {
    responseData: {
      detail: "Request validation failed",
      errors: [
        {
          type: "note_too_deep",
          field: "body -> document -> blocks -> 0 -> text -> content",
        },
      ],
    },
  });
  expect(dailyPlanSaveMessage(error, note("調査メモ"))).toBe(
    "1番目の段落・項目「調査メモ」: リストなどの入れ子が深すぎます。階層を浅くしてください。",
  );
});

it("limits memos under schedule lines and explains API rejections", () => {
  const line = (text: string): DailyPlanDocumentV1 => ({
    schema_version: 1,
    blocks: [
      {
        id: "line",
        type: "timed_line",
        title: "設計レビュー",
        start: "10:00",
        end: "11:00",
        note: text,
      },
    ],
  });
  expect(() =>
    validateDailyPlanNote(line("メ".repeat(DAILY_PLAN_LINE_NOTE_MAX_LENGTH))),
  ).not.toThrow();
  const invalid = line("メ".repeat(DAILY_PLAN_LINE_NOTE_MAX_LENGTH + 1));
  expect(() => validateDailyPlanNote(invalid)).toThrow(
    "1番目の段落・項目「設計レビュー」: メモが上限の10,000文字",
  );
  const error = new ApiError(422, "validation failed", {
    responseData: {
      detail: "Request validation failed",
      errors: [
        {
          type: "string_too_long",
          field: "body -> document -> blocks -> 0 -> timed_line -> note",
        },
      ],
    },
  });
  expect(dailyPlanSaveMessage(error, invalid)).toMatch(
    /^1番目の段落・項目「設計レビュー」: メモが上限の10,000文字/,
  );
});
