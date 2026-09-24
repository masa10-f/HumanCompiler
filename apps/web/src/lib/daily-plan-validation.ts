// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

import type { DailyPlanDocumentV1 } from "@/types/daily-plan";
import { ApiError } from "@/lib/errors";

export class DailyPlanValidationError extends Error {}

/** Matches the API limit on memos written under schedule lines. */
export const DAILY_PLAN_LINE_NOTE_MAX_LENGTH = 10000;
const lineNoteTooLong =
  "メモが上限の10,000文字を超えています。長い内容は本文の段落に分けてください。";

const reasons: Record<string, string> = {
  note_content_too_large:
    "書式を含む内容が上限の50,000文字を超えています。段落やリストを分けてください。",
  note_too_deep: "リストなどの入れ子が深すぎます。階層を浅くしてください。",
  note_document_too_large:
    "ノート全体が上限の5MBを超えています。別の日のノートへ内容を分けてください。",
  note_unsafe_link:
    "保存できない形式のリンクがあります。http、https、mailto、telのリンクに変更してください。",
};

function blockLabel(document: DailyPlanDocumentV1, index: number): string {
  const block = document.blocks[index];
  const text = block?.type === "text" ? block.text : block?.title;
  return `${index + 1}番目の段落・項目${text ? `「${Array.from(text).slice(0, 30).join("")}」` : ""}: `;
}

export function validateDailyPlanNote(document: DailyPlanDocumentV1): void {
  if (document.blocks.length > 500)
    throw new DailyPlanValidationError(
      "段落・項目は1日500件までです。不要な空行を減らすか、別の日のノートへ内容を分けてください。",
    );
  document.blocks.forEach((block, index) => {
    const fail = (message: string): never => {
      throw new DailyPlanValidationError(blockLabel(document, index) + message);
    };
    if (block.type === "timed_line" || block.type === "schedule_directive") {
      if (
        block.note &&
        Array.from(block.note).length > DAILY_PLAN_LINE_NOTE_MAX_LENGTH
      )
        fail(lineNoteTooLong);
      return;
    }
    if (block.type !== "text") return;
    if (Array.from(block.text).length > 50000)
      fail(
        "本文が上限の50,000文字を超えています。段落やリストを分けてください。",
      );
    if (!block.content) return;
    if (Array.from(JSON.stringify(block.content)).length > 50000)
      fail(reasons.note_content_too_large!);
    const checkDepth = (node: { content?: unknown }, depth: number) => {
      if (depth > 20) fail(reasons.note_too_deep!);
      if (Array.isArray(node.content))
        node.content.forEach((child) => checkDepth(child, depth + 1));
    };
    checkDepth(block.content, 0);
  });
  if (new Blob([JSON.stringify(document)]).size > 5000000)
    throw new DailyPlanValidationError(reasons.note_document_too_large!);
}

export function dailyPlanSaveMessage(
  error: unknown,
  document: DailyPlanDocumentV1,
): string {
  if (error instanceof ApiError && error.statusCode === 422) {
    const data = error.context.responseData as
      | { detail?: unknown; errors?: unknown }
      | undefined;
    const entries = Array.isArray(data?.errors) ? data.errors : data?.detail;
    if (Array.isArray(entries)) {
      const messages = entries.map(
        (entry: { type?: string; loc?: unknown[]; field?: string }) => {
          const location =
            entry.loc ??
            entry.field
              ?.split(" -> ")
              .map((part) => (/^\d+$/.test(part) ? Number(part) : part)) ??
            [];
          const blockAt = location.indexOf("blocks");
          const index = location[blockAt + 1];
          const prefix =
            blockAt >= 0 && typeof index === "number"
              ? blockLabel(document, index)
              : "";
          const reason = reasons[entry.type ?? ""];
          if (reason) return prefix + reason;
          if (entry.type === "string_too_long" && location.at(-1) === "note")
            return prefix + lineNoteTooLong;
          if (entry.type === "string_too_long" && location.at(-1) === "text")
            return (
              prefix +
              "本文が上限の50,000文字を超えています。段落やリストを分けてください。"
            );
          if (entry.type === "too_long" && location.at(-1) === "blocks")
            return "段落・項目は1日500件までです。不要な空行を減らしてください。";
          return (
            prefix +
            "内容または書式を保存できません。該当する段落・項目を確認してください。"
          );
        },
      );
      if (messages.length) return [...new Set(messages)].join("\n");
    }
  }
  return error instanceof Error ? error.message : "保存に失敗しました";
}
