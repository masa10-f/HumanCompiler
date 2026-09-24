// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

import { createDailyPlanId } from "@/lib/daily-plan-id";
import type { JSONContent } from "@tiptap/react";
import type { DailyPlanBlock, DailyPlanDocumentV1 } from "@/types/daily-plan";

export function noteText(node: JSONContent): string {
  if (node.type === "hardBreak") return "\n";
  return (
    node.text ??
    (node.content ?? [])
      .map(noteText)
      .join(
        ["paragraph", "heading", "codeBlock"].includes(node.type ?? "")
          ? ""
          : "\n",
      )
  );
}

export function dailyPlanToNote(document: DailyPlanDocumentV1): JSONContent {
  const content = document.blocks.map(
    (block): JSONContent =>
      block.type === "text"
        ? {
            ...(block.content ?? {
              type: "paragraph",
              content: block.text ? [{ type: "text", text: block.text }] : [],
            }),
            attrs: { ...block.content?.attrs, planId: block.id },
          }
        : { type: "dailyPlanBlock", attrs: { block } },
  );
  // Always leave a normal paragraph after an embedded schedule.
  if (!content.length || content.at(-1)?.type === "dailyPlanBlock")
    content.push({ type: "paragraph" });
  return { type: "doc", content };
}

// planId belongs to the editor, including null/default IDs on nested paragraphs.
// Persist stable IDs on document blocks only, never in rich content.
function persistedNoteContent(node: JSONContent): JSONContent {
  const attrs = { ...node.attrs };
  delete attrs.planId;
  return {
    ...node,
    ...(node.attrs ? { attrs } : {}),
    ...(node.content ? { content: node.content.map(persistedNoteContent) } : {}),
  };
}

export function noteToDailyPlan(note: JSONContent): DailyPlanDocumentV1 {
  const ids = new Set<string>();
  const blocks = (note.content ?? []).flatMap(
    (node, index): DailyPlanBlock[] => {
      if (node.type === "dailyPlanBlock") {
        const block = node.attrs?.block as DailyPlanBlock;
        const id = ids.has(block.id) ? createDailyPlanId() : block.id;
        ids.add(id);
        return [{ ...block, id }];
      }
      // The editor's trailing empty cursor position is not a saved memo.
      if (
        index === (note.content?.length ?? 0) - 1 &&
        node.type === "paragraph" &&
        !node.content?.length
      )
        return [];
      let id = node.attrs?.planId as string | undefined;
      if (!id || ids.has(id)) id = createDailyPlanId();
      ids.add(id);
      const content = persistedNoteContent(node);
      return [{ id, type: "text", text: noteText(node), content }];
    },
  );
  return { schema_version: 1, blocks };
}

export function schedulingBlocks(
  document: DailyPlanDocumentV1,
): DailyPlanBlock[] {
  return document.blocks.filter(
    (block) =>
      block.type === "schedule_directive" || block.type === "timed_line",
  );
}

// JSON property order can differ after a server round trip.
export function sameSchedulingBlocks(
  left: DailyPlanBlock[],
  right: DailyPlanBlock[],
): boolean {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .filter(([, item]) => item !== undefined && item !== null)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => [key, canonical(item)]),
      );
    return value;
  };
  const defaults = (blocks: DailyPlanBlock[]) =>
    blocks.map((block) => {
      // Line memos are not scheduling input, so editing one keeps the schedule current.
      if (block.type === "schedule_directive") {
        const conditions = { ...block };
        delete conditions.note;
        return { work_type: "light_work", allowed_windows: [], ...conditions };
      }
      if (block.type === "timed_line") {
        const conditions = { ...block };
        delete conditions.completed;
        delete conditions.note;
        return { pinned: true, kind: "event", ...conditions };
      }
      return block;
    });
  return (
    JSON.stringify(canonical(defaults(left))) ===
    JSON.stringify(canonical(defaults(right)))
  );
}
