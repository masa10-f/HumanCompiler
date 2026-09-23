// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

import { createElement, type ReactNode } from "react";
import type { JSONContent } from "@tiptap/react";
import type { DailyPlanDocumentV1 } from "@/types/daily-plan";

// Render a read-only view with React: raw HTML and arbitrary attributes are never applied.
function richContent(node: JSONContent, key: number): ReactNode {
  const children = node.content?.map(richContent);
  if (node.type === "text") {
    let text: ReactNode = node.text ?? "";
    for (const mark of node.marks ?? []) {
      if (mark.type === "bold") text = <strong>{text}</strong>;
      if (mark.type === "italic") text = <em>{text}</em>;
      if (mark.type === "strike") text = <s>{text}</s>;
      if (mark.type === "code") text = <code>{text}</code>;
      if (mark.type === "link" && typeof mark.attrs?.href === "string") {
        const href = mark.attrs.href;
        try {
          if (
            ["http:", "https:", "mailto:", "tel:"].includes(
              new URL(href, "https://relative.invalid").protocol,
            )
          )
            text = (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {text}
              </a>
            );
        } catch {
          /* Invalid links remain visible as text. */
        }
      }
    }
    return <span key={key}>{text}</span>;
  }
  switch (node.type) {
    case "heading": {
      const level = Number(node.attrs?.level);
      return createElement(
        `h${level >= 1 && level <= 6 && Number.isInteger(level) ? level : 2}`,
        { key },
        children,
      );
    }
    case "paragraph":
      return <p key={key}>{children ?? <br />}</p>;
    case "bulletList":
      return <ul key={key}>{children}</ul>;
    case "orderedList":
      return (
        <ol key={key} start={Number(node.attrs?.start) || 1}>
          {children}
        </ol>
      );
    case "listItem":
      return <li key={key}>{children}</li>;
    case "taskList":
      return (
        <ul key={key} className="list-none pl-0">
          {children}
        </ul>
      );
    case "taskItem":
      return (
        <li key={key} className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={Boolean(node.attrs?.checked)}
            disabled
            aria-label="ノートのチェック項目"
            className="mt-1.5"
          />
          <div className="min-w-0 [&>p]:my-0">{children}</div>
        </li>
      );
    case "blockquote":
      return <blockquote key={key}>{children}</blockquote>;
    case "codeBlock":
      return (
        <pre key={key}>
          <code>{children}</code>
        </pre>
      );
    case "hardBreak":
      return <br key={key} />;
    case "horizontalRule":
      return <hr key={key} />;
    default:
      return <span key={key}>{children ?? node.text}</span>;
  }
}

export function DailyNotePreview({
  document,
}: {
  document: DailyPlanDocumentV1;
}) {
  return (
    <article
      aria-label="今日のノート本文"
      className="prose prose-sm max-h-96 max-w-none overflow-y-auto break-words whitespace-pre-wrap rounded-lg border p-4 dark:prose-invert"
    >
      {document.blocks.map((block) => (
        <div key={block.id}>
          {block.type === "text" ? (
            block.content ? (
              richContent(block.content, 0)
            ) : (
              <p>{block.text || <br />}</p>
            )
          ) : block.type === "checklist_item" ? (
            <p className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={block.checked}
                disabled
                aria-label={block.title}
                className="mt-1"
              />
              <span>{block.title}</span>
            </p>
          ) : (
            <p className="rounded bg-muted p-2">
              <span className="mr-2 font-mono text-muted-foreground">
                {block.type === "timed_line"
                  ? `${block.start}–${block.end}`
                  : (block.allowed_windows ?? [])
                      .map((window) => `${window.start}–${window.end}`)
                      .join(", ")}
              </span>
              {block.title || "タスクを自動配置"}
              {block.type === "schedule_directive" &&
              block.duration_override_minutes
                ? `（${block.duration_override_minutes}分）`
                : ""}
            </p>
          )}
        </div>
      ))}
    </article>
  );
}
