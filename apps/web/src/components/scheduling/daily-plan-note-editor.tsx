// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

"use client";

import { createDailyPlanId } from "@/lib/daily-plan-id";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  EditorContent,
  Extension,
  Node,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  useEditor,
  type NodeViewProps,
} from "@tiptap/react";
import { closeHistory } from "@tiptap/pm/history";
import { Plugin, TextSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Link from "@tiptap/extension-link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  parseScheduleDirective,
  isScheduleCommand,
  parseTimedLine,
  parseBreakLine,
  normalizeDailyPlanClock,
} from "@/lib/daily-plan-command";
import { extractDailyPlanMention } from "@/lib/daily-plan-editor";
import { dailyPlanToNote, noteToDailyPlan } from "@/lib/daily-plan-note";
import type {
  DailyPlanBlock,
  DailyPlanDocumentV1,
  DailyPlanTaskRef,
} from "@/types/daily-plan";
import type { WorkType } from "@/types/task";

export interface NoteTaskOption {
  key: string;
  ref: DailyPlanTaskRef;
  title: string;
  workType: WorkType;
  remainingHours: number;
  projectTitle?: string;
  goalTitle?: string;
}

export interface NoteProjectOption {
  id: string;
  title: string;
}

export interface NoteGoalOption extends NoteProjectOption {
  projectId: string;
  projectTitle?: string;
}

type Suggestion =
  | { key: string; kind: "project"; title: string; project: NoteProjectOption }
  | { key: string; kind: "goal"; title: string; goal: NoteGoalOption }
  | { key: string; kind: "task"; title: string; task: NoteTaskOption };

const BlockRenderer = createContext<(block: DailyPlanBlock) => ReactNode>(
  () => null,
);
function ScheduleNodeView({ node }: NodeViewProps) {
  const render = useContext(BlockRenderer);
  return (
    <NodeViewWrapper contentEditable={false} className="not-prose my-3">
      {render(node.attrs.block)}
    </NodeViewWrapper>
  );
}

const ScheduleNode = Node.create({
  name: "dailyPlanBlock",
  group: "dailyPlan",
  atom: true,
  draggable: true,
  addAttributes: () => ({ block: { default: null, rendered: false } }),
  // Internal nodes are inserted via commands, never reconstructed from untrusted pasted HTML.
  parseHTML: () => [],
  renderHTML: ({ node }) => [
    "div",
    { "data-daily-plan": "" },
    node.attrs.block?.title ?? "予定",
  ],
  addNodeView: () => ReactNodeViewRenderer(ScheduleNodeView),
});

// Scheduling references stay at document level, so wrapping prose in a list or
// quote can never hide constraints inside a text block sent to the API.
const NoteDocument = Node.create({
  name: "doc",
  topNode: true,
  content: "(block | dailyPlan)+",
});

const NoteIdentity = Extension.create({
  name: "noteIdentity",
  addGlobalAttributes: () => [
    {
      types: [
        "paragraph",
        "heading",
        "bulletList",
        "orderedList",
        "taskList",
        "blockquote",
        "codeBlock",
        "horizontalRule",
      ],
      attributes: { planId: { default: null, rendered: false } },
    },
  ],
  addProseMirrorPlugins: () => [
    new Plugin({
      appendTransaction: (transactions, _old, state) => {
        if (!transactions.some((transaction) => transaction.docChanged))
          return null;
        const tr = state.tr;
        const seen = new Set<string>();
        state.doc.forEach((node, pos) => {
          if (node.type.name === "dailyPlanBlock") return;
          let id = node.attrs.planId;
          if (!id || seen.has(id)) {
            id = createDailyPlanId();
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, planId: id });
          }
          seen.add(id);
        });
        return tr.docChanged ? tr : null;
      },
    }),
  ],
});

interface CommandRange {
  from: number;
  to: number;
  text: string;
  top: number;
  left: number;
}

export function DailyPlanNoteEditor({
  document,
  onChange,
  taskOptions,
  projectOptions = [],
  goalOptions = [],
  goalsLoading = false,
  goalsError = false,
  onRetryGoals,
  onSuggestionsOpen,
  renderBlock,
}: {
  document: DailyPlanDocumentV1;
  onChange: (document: DailyPlanDocumentV1) => void;
  taskOptions: NoteTaskOption[];
  projectOptions?: NoteProjectOption[];
  goalOptions?: NoteGoalOption[];
  goalsLoading?: boolean;
  goalsError?: boolean;
  onRetryGoals?: () => void;
  onSuggestionsOpen?: () => void;
  renderBlock: (block: DailyPlanBlock) => ReactNode;
}) {
  const [command, setCommand] = useState<CommandRange | null>(null);
  const suggestionsOpen = Boolean(command);
  useEffect(() => {
    if (suggestionsOpen) onSuggestionsOpen?.();
  }, [suggestionsOpen, onSuggestionsOpen]);
  const dismissed = useRef<string | null>(null);
  const emitted = useRef<string>();
  const initialized = useRef(false);
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  const menuKeys = useRef<(key: string) => void>(() => {});
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ document: false }),
      NoteDocument,
      TaskList,
      TaskItem.configure({ nested: true }),
      Link.configure({ openOnClick: false }),
      ScheduleNode,
      NoteIdentity,
      // Only top-level nodes are decorated, and only paragraphs show the guide:
      // /schedule works there, and nested list items or quotes would repeat it.
      Placeholder.configure({
        placeholder: "自由にメモを書く…  /schedule で予定を追加",
      }),
    ],
    content: dailyPlanToNote(document),
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-label": "日次ノート",
        "aria-multiline": "true",
        class:
          "context-note-content prose prose-sm dark:prose-invert max-w-none min-h-[320px] px-2 py-3 outline-none [&>p.is-empty:before]:text-muted-foreground [&>p.is-empty:before]:content-[attr(data-placeholder)] [&>p.is-empty:before]:float-left [&>p.is-empty:before]:h-0 [&>p.is-empty:before]:pointer-events-none",
      },
    },
    onUpdate: ({ editor: current }) => {
      const next = noteToDailyPlan(current.getJSON());
      emitted.current = JSON.stringify(next);
      changeRef.current(next);
    },
    onTransaction: ({ editor: current }) => {
      const { $from, empty } = current.state.selection;
      const text = $from.parent.textContent;
      if (
        !empty ||
        $from.depth !== 1 ||
        $from.parent.type.name !== "paragraph" ||
        !isScheduleCommand(text, true)
      ) {
        setCommand(null);
        dismissed.current = null;
        return;
      }
      const identity = `${$from.before()}:${text}`;
      if (dismissed.current === identity) return;
      let top = 120,
        left = 24;
      try {
        const coords = current.view.coordsAtPos($from.pos);
        top = Math.min(coords.bottom + 8, window.innerHeight - 360);
        left = Math.max(12, Math.min(coords.left, window.innerWidth - 460));
      } catch {
        /* No layout in server/test environments. */
      }
      setCommand({
        from: $from.before(),
        to: $from.after(),
        text,
        top: Math.max(12, top),
        left,
      });
    },
  });

  useEffect(() => {
    if (!editor) return;
    if (!initialized.current) {
      initialized.current = true;
      // Opening a note that starts with a schedule should place typing in prose,
      // rather than select (and replace) the schedule on the first keystroke.
      const selection = TextSelection.findFrom(
        editor.state.doc.resolve(0),
        1,
        true,
      );
      if (selection)
        editor.view.dispatch(editor.state.tr.setSelection(selection));
    }
    if (JSON.stringify(document) === emitted.current) return;
    const next = dailyPlanToNote(document);
    if (JSON.stringify(editor.getJSON()) === JSON.stringify(next)) return;
    const position = editor.state.selection.from;
    editor.commands.setContent(next, false);
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.near(
          editor.state.doc.resolve(
            Math.min(position, editor.state.doc.content.size),
          ),
        ),
      ),
    );
  }, [document, editor]);

  const insert = (block: DailyPlanBlock) => {
    if (!editor || !command) return;
    editor.view.dispatch(closeHistory(editor.state.tr));
    editor
      .chain()
      .focus()
      .insertContentAt({ from: command.from, to: command.to }, [
        { type: "dailyPlanBlock", attrs: { block } },
        { type: "paragraph" },
      ])
      .run();
    setCommand(null);
  };

  return (
    <BlockRenderer.Provider value={renderBlock}>
      <div
        className="relative"
        onBlur={(event) => {
          if (
            !event.currentTarget.contains(
              event.relatedTarget as globalThis.Node | null,
            )
          )
            setCommand(null);
        }}
        onKeyDownCapture={(event) => {
          if (
            !editor ||
            event.nativeEvent.isComposing ||
            event.keyCode === 229 ||
            !(event.target as HTMLElement).closest(".tiptap") ||
            // Keys typed into a schedule's own controls are not note input.
            (event.target as HTMLElement).closest("[data-node-view-wrapper]")
          )
            return;
          if (
            command &&
            ["Enter", "ArrowDown", "ArrowUp", "Escape"].includes(event.key) &&
            !event.shiftKey
          ) {
            event.preventDefault();
            event.stopPropagation();
            if (event.key === "Escape") {
              dismissed.current = `${command.from}:${command.text}`;
              setCommand(null);
            } else menuKeys.current(event.key);
            return;
          }
          if (event.key === "Enter" && !event.shiftKey) {
            const { $from } = editor.state.selection;
            if ($from.depth !== 1 || $from.parent.type.name !== "paragraph")
              return;
            const value = $from.parent.textContent;
            const pause = parseBreakLine(value);
            const timed = pause ?? parseTimedLine(value);
            if (!timed) return;
            event.preventDefault();
            event.stopPropagation();
            editor
              .chain()
              .focus()
              .insertContentAt({ from: $from.before(), to: $from.after() }, [
                {
                  type: "dailyPlanBlock",
                  attrs: {
                    block: {
                      id: createDailyPlanId(),
                      type: "timed_line",
                      ...timed,
                      kind: pause ? "break" : "event",
                      pinned: true,
                    },
                  },
                },
                { type: "paragraph" },
              ])
              .run();
          }
        }}
      >
        <p className="mb-2 text-xs text-muted-foreground">
          # 見出し · - 箇条書き · [ ] チェックリスト · /schedule 予定の提案
        </p>
        <EditorContent editor={editor} />
        {command && (
          <ScheduleSuggestions
            key={command.from}
            command={command}
            tasks={taskOptions}
            projects={projectOptions}
            goals={goalOptions}
            goalsLoading={goalsLoading}
            goalsError={goalsError}
            onRetryGoals={onRetryGoals}
            onInsert={insert}
            keyboard={menuKeys}
          />
        )}
      </div>
    </BlockRenderer.Provider>
  );
}

function ScheduleSuggestions({
  command,
  tasks,
  projects,
  goals,
  goalsLoading,
  goalsError,
  onRetryGoals,
  onInsert,
  keyboard,
}: {
  command: CommandRange;
  tasks: NoteTaskOption[];
  projects: NoteProjectOption[];
  goals: NoteGoalOption[];
  goalsLoading: boolean;
  goalsError: boolean;
  onRetryGoals?: () => void;
  onInsert: (block: DailyPlanBlock) => void;
  keyboard: { current: (key: string) => void };
}) {
  const parsed = parseScheduleDirective(command.text);
  const [start, setStart] = useState(parsed?.allowedWindow?.start ?? "09:00");
  const [end, setEnd] = useState(parsed?.allowedWindow?.end ?? "18:00");
  const [minutes, setMinutes] = useState(
    parsed?.durationMinutes?.toString() ?? "",
  );
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>("auto");
  const [category, setCategory] = useState<"all" | Suggestion["kind"]>("all");
  const [workType, setWorkType] = useState<WorkType>("light_work");
  useEffect(() => {
    const directive = parseScheduleDirective(command.text);
    const range = command.text.match(
      /(\d{1,2}:?\d{2})\s*[-–]\s*(\d{1,2}:?\d{2})/,
    );
    if (range) {
      setStart(normalizeDailyPlanClock(range[1] ?? "") ?? "");
      setEnd(normalizeDailyPlanClock(range[2] ?? "") ?? "");
    }
    const duration = command.text.match(/\((?:(\d+)h)?(?:(\d+)m)?\)/i);
    setMinutes(
      duration
        ? String(Number(duration[1] ?? 0) * 60 + Number(duration[2] ?? 0))
        : (directive?.durationMinutes?.toString() ?? ""),
    );
    const mention = extractDailyPlanMention(command.text);
    setQuery(mention ?? "");
    setSelectedKey(mention ? null : "auto");
  }, [command.text]);
  const search = query.toLocaleLowerCase();
  const candidates: Suggestion[] = [
    ...projects.map(
      (project): Suggestion => ({
        key: `project:${project.id}`,
        kind: "project",
        title: project.title,
        project,
      }),
    ),
    ...goals.map(
      (goal): Suggestion => ({
        key: `goal:${goal.id}`,
        kind: "goal",
        title: goal.title,
        goal,
      }),
    ),
    ...tasks.map(
      (task): Suggestion => ({
        key: task.key,
        kind: "task",
        title: task.title,
        task,
      }),
    ),
  ];
  const matches = candidates.filter((candidate) => {
    if (category !== "all" && category !== candidate.kind) return false;
    const context =
      candidate.kind === "goal"
        ? candidate.goal.projectTitle
        : candidate.kind === "task"
          ? `${candidate.task.projectTitle ?? ""} ${candidate.task.goalTitle ?? ""}`
          : "";
    return `${candidate.title} ${context ?? ""}`
      .toLocaleLowerCase()
      .includes(search);
  });
  const selected =
    selectedKey === null ? (matches[0]?.key ?? "auto") : selectedKey;
  const valid = Boolean(
    start &&
      end &&
      start < end &&
      (!minutes ||
        (/^\d+$/.test(minutes) &&
          Number(minutes) > 0 &&
          Number(minutes) <= 1440)),
  );
  const choose = (candidate?: Suggestion) => {
    if (!valid) return;
    const task = candidate?.kind === "task" ? candidate.task : undefined;
    onInsert({
      id: createDailyPlanId(),
      type: "schedule_directive",
      mode: task ? "task" : "filter",
      title: candidate?.title,
      task_ref: task?.ref,
      work_type: task?.workType ?? workType,
      filter: task
        ? undefined
        : {
            work_types: candidate ? [] : [workType],
            project_ids:
              candidate?.kind === "project" ? [candidate.project.id] : [],
            goal_ids: candidate?.kind === "goal" ? [candidate.goal.id] : [],
          },
      duration_override_minutes: minutes ? Number(minutes) : undefined,
      allowed_windows: [{ start, end }],
    });
  };
  keyboard.current = (key) => {
    const keys = ["auto", ...matches.map((candidate) => candidate.key)];
    const index = Math.max(0, keys.indexOf(selected));
    if (key === "ArrowDown")
      setSelectedKey(keys[Math.min(index + 1, keys.length - 1)]!);
    if (key === "ArrowUp") setSelectedKey(keys[Math.max(0, index - 1)]!);
    if (key === "Enter") {
      const candidate = matches.find((item) => item.key === selected);
      if (selected === "auto" || candidate) choose(candidate);
    }
  };
  return (
    <div
      role="dialog"
      aria-label="スケジュールの提案"
      className="fixed z-50 w-[440px] max-w-[calc(100vw-24px)] max-h-[calc(100dvh-24px)] overflow-y-auto space-y-3 rounded-xl border bg-popover p-4 text-popover-foreground shadow-xl"
      style={{ top: command.top, left: command.left }}
    >
      <div>
        <p className="font-medium">時間帯に合う予定を追加</p>
        <p className="text-xs text-muted-foreground">
          ↑↓ で候補を選択 · Enter で挿入 · Esc で閉じる
        </p>
      </div>
      <div className="flex gap-2">
        <label className="min-w-0 flex-1 text-xs">
          開始
          <Input
            aria-label="提案の開始時刻"
            type="time"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label className="min-w-0 flex-1 text-xs">
          終了
          <Input
            aria-label="提案の終了時刻"
            type="time"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
        <label className="min-w-0 flex-1 text-xs">
          割当（分）
          <Input
            aria-label="提案の割当時間"
            type="number"
            min={1}
            max={1440}
            placeholder="自動"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
          />
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm">
        作業タイプ
        <select
          aria-label="提案の作業タイプ"
          className="rounded border bg-background p-1"
          value={workType}
          onChange={(e) => setWorkType(e.target.value as WorkType)}
        >
          <option value="light_work">軽作業</option>
          <option value="focused_work">集中作業</option>
          <option value="study">学習</option>
        </select>
      </label>
      {!valid && (
        <p role="alert" className="text-xs text-destructive">
          開始より後の終了時刻と、1〜1440分の割当時間を指定してください。
        </p>
      )}
      <Input
        aria-label="予定に入れる候補を検索"
        placeholder="プロジェクト・ゴール・タスクを検索…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setSelectedKey("auto");
        }}
      />
      <div
        role="group"
        aria-label="候補の種類"
        className="flex flex-wrap gap-1"
      >
        {(
          [
            ["all", "すべて"],
            ["project", "プロジェクト"],
            ["goal", "ゴール"],
            ["task", "タスク"],
          ] as const
        ).map(([value, label]) => (
          <Button
            key={value}
            size="sm"
            variant={category === value ? "secondary" : "ghost"}
            aria-pressed={category === value}
            onClick={() => {
              setCategory(value);
              setSelectedKey("auto");
            }}
          >
            {label}
          </Button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        プロジェクト・ゴールは、生成時に配下のタスクから自動選択します。
      </p>
      {goalsLoading && (
        <p role="status" className="text-xs text-muted-foreground">
          ゴールを読み込み中…
        </p>
      )}
      {goalsError && (
        <p role="alert" className="text-xs text-destructive">
          一部のゴールを読み込めませんでした。
          <button type="button" className="underline" onClick={onRetryGoals}>
            再試行
          </button>
        </p>
      )}
      <div
        role="listbox"
        aria-label="予定の候補"
        className="max-h-44 space-y-1 overflow-y-auto"
      >
        <Button
          role="option"
          aria-selected={selected === "auto"}
          variant={selected === "auto" ? "secondary" : "ghost"}
          className="h-auto w-full justify-start py-2 text-left"
          disabled={!valid}
          onClick={() => choose()}
        >
          この時間帯を条件に合うタスクで埋める
        </Button>
        {matches.map((candidate) => (
          <Button
            key={candidate.key}
            role="option"
            aria-selected={selected === candidate.key}
            variant={selected === candidate.key ? "secondary" : "ghost"}
            disabled={!valid}
            className="h-auto w-full items-start justify-start whitespace-normal py-2 text-left"
            onClick={() => choose(candidate)}
          >
            <span>
              <span className="block">{candidate.title}</span>
              <span className="text-xs font-normal text-muted-foreground">
                {candidate.kind === "project" ? (
                  "プロジェクト · 配下のタスクを自動選択"
                ) : candidate.kind === "goal" ? (
                  `ゴール · ${candidate.goal.projectTitle ?? ""} · 配下のタスクを自動選択`
                ) : (
                  <>
                    {candidate.task.projectTitle ?? "Quick Task"}
                    {candidate.task.goalTitle
                      ? ` / ${candidate.task.goalTitle}`
                      : ""}{" "}
                    · 残り {Math.round(candidate.task.remainingHours * 60)}分
                  </>
                )}
              </span>
            </span>
          </Button>
        ))}
        {query && !matches.length && (
          <p className="p-2 text-xs text-muted-foreground">
            一致する候補がありません。検索語や候補の種類を変えてください。
          </p>
        )}
      </div>
    </div>
  );
}
