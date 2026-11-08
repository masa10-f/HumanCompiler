// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle,
  Copy,
  Loader2,
  Lock,
  Plus,
  Save,
  Scale,
  Trash2,
} from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useProjectOptions } from "@/hooks/use-project-query";
import { weeklyRhythmApi } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import { isSelectableProject } from "@/lib/project-filters";
import { queryKeys } from "@/lib/query-keys";
import {
  RHYTHM_KIND_LABELS,
  WEEKDAY_DISPLAY_ORDER,
  WEEKDAY_LABELS,
  formatRhythmHours,
  rhythmBlocksForWeekday,
  rhythmValidationError,
} from "@/lib/weekly-rhythm";
import { workTypeLabels, type WorkType } from "@/types/task";
import type { TriageCapacitySettings } from "@/types/triage";
import type {
  Weekday,
  WeeklyRhythm,
  WeeklyRhythmBlockInput,
  WeeklyRhythmBlockKind,
} from "@/types/weekly-rhythm";

interface DraftBlock extends WeeklyRhythmBlockInput {
  key: string;
}

const SELECT_CLASS =
  "h-9 rounded-md border bg-background px-2 text-sm disabled:opacity-50";
const WORK_TYPES: WorkType[] = ["focused_work", "study", "light_work"];
const NO_PROJECT = "";

const errorText = (error: unknown) =>
  error instanceof Error ? getErrorMessage(error) : "不明なエラー";

let draftCounter = 0;
const draftKey = () => `draft-${(draftCounter += 1)}`;

function toDrafts(rhythm: WeeklyRhythm): DraftBlock[] {
  return rhythm.blocks.map((block) => ({
    key: block.id,
    weekday: block.weekday,
    start: block.start,
    end: block.end,
    kind: block.kind,
    title: block.title,
    project_id: block.project_id,
    work_type: block.work_type,
    locked: block.locked,
  }));
}

function toInput({ key: _key, ...block }: DraftBlock): WeeklyRhythmBlockInput {
  const title = block.title?.trim() || null;
  return {
    ...block,
    title,
    project_id: block.kind === "schedule" ? (block.project_id ?? null) : null,
  };
}

function addHour(value: string): string {
  const [hours, minutes] = value.split(":").map(Number);
  const total = Math.min(hours! * 60 + minutes! + 60, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function WeeklyRhythmEditor() {
  const queryClient = useQueryClient();
  const rhythmQuery = useQuery({
    queryKey: queryKeys.weeklyRhythm.current(),
    queryFn: () => weeklyRhythmApi.get(),
  });
  const { data: projectData = [] } = useProjectOptions();
  const [drafts, setDrafts] = useState<DraftBlock[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<ReactNode>("");
  const [copySource, setCopySource] = useState<Weekday | null>(null);
  const [copyTargets, setCopyTargets] = useState<Weekday[]>([]);
  const [confirmApply, setConfirmApply] = useState(false);

  const rhythm = rhythmQuery.data;
  useEffect(() => {
    // Never overwrite edits in progress with a background refetch.
    if (rhythm && !dirty) setDrafts(toDrafts(rhythm));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rhythm]);

  // In-progress projects, plus any other project the template already uses.
  const projectOptions = useMemo(() => {
    const used = new Set(drafts.map((block) => block.project_id));
    return projectData.filter(
      (project) => isSelectableProject(project) || used.has(project.id),
    );
  }, [drafts, projectData]);
  const projectTitle = (id: string | null) =>
    projectData.find((project) => project.id === id)?.title;

  const inputs = useMemo(() => drafts.map(toInput), [drafts]);
  const validationError = rhythmValidationError(inputs);

  // Counts edits so a save response never overwrites edits made while it ran.
  const editVersion = useRef(0);
  const edit = (updater: (current: DraftBlock[]) => DraftBlock[]) => {
    editVersion.current += 1;
    setDrafts(updater);
    setDirty(true);
    setError("");
    setSuccess("");
  };
  const updateBlock = (key: string, patch: Partial<DraftBlock>) =>
    edit((current) =>
      current.map((block) => (block.key === key ? { ...block, ...patch } : block)),
    );
  const addBlock = (weekday: Weekday) =>
    edit((current) => {
      const last = rhythmBlocksForWeekday(current, weekday).at(-1);
      const start = last && last.end < "23:00" ? last.end : "09:00";
      return [
        ...current,
        {
          key: draftKey(),
          weekday,
          start,
          end: addHour(start),
          kind: "schedule",
          title: null,
          project_id: null,
          work_type: "focused_work",
          locked: false,
        },
      ];
    });
  const copyDay = () => {
    if (copySource === null || !copyTargets.length) return;
    edit((current) => {
      const source = rhythmBlocksForWeekday(current, copySource);
      return [
        ...current.filter((block) => !copyTargets.includes(block.weekday)),
        ...copyTargets.flatMap((weekday) =>
          source.map((block) => ({ ...block, key: draftKey(), weekday })),
        ),
      ];
    });
    setCopySource(null);
    setCopyTargets([]);
  };

  const save = async () => {
    if (validationError) return;
    setSaving(true);
    setError("");
    setSuccess("");
    const savedVersion = editVersion.current;
    try {
      const saved = await weeklyRhythmApi.replace(inputs);
      queryClient.setQueryData(queryKeys.weeklyRhythm.current(), saved);
      if (editVersion.current === savedVersion) {
        setDrafts(toDrafts(saved));
        setDirty(false);
        setSuccess("週のリズムを保存しました");
      } else {
        // Keep the newer edits on screen and still unsaved.
        setSuccess("保存しました。保存中に加えた変更はまだ保存されていません");
      }
    } catch (err) {
      setError(`保存に失敗しました: ${errorText(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const applyToTriage = async () => {
    setConfirmApply(false);
    setApplying(true);
    setError("");
    setSuccess("");
    try {
      const settings: TriageCapacitySettings = await weeklyRhythmApi.applyToTriage();
      setSuccess(
        <>
          トリアージの容量を週{settings.weekly_capacity_hours}h（会議バッファ
          {settings.meeting_buffer_hours}h を含む）に設定しました。
          <Link href="/settings#triage-settings" className="ml-1 underline">
            トリアージ設定を開く
          </Link>
        </>,
      );
    } catch (err) {
      setError(`トリアージへの反映に失敗しました: ${errorText(err)}`);
    } finally {
      setApplying(false);
    }
  };

  if (rhythmQuery.isLoading) {
    return (
      <div className="flex min-h-48 items-center justify-center gap-2" role="status">
        <Loader2 className="h-5 w-5 animate-spin" />
        週のリズムを読み込み中…
      </div>
    );
  }
  if (rhythmQuery.isError || !rhythm) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription className="flex flex-wrap items-center gap-3">
          週のリズムを読み込めませんでした: {errorText(rhythmQuery.error)}
          <Button size="sm" variant="outline" onClick={() => void rhythmQuery.refetch()}>
            再読み込み
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  const summary = rhythm.summary;
  const allocation = summary.triage_allocation;
  const dayMinutes = (weekday: Weekday) =>
    summary.days.find((day) => day.weekday === weekday)?.schedule_minutes ?? 0;

  return (
    <div className="space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {success && (
        <Alert>
          <CheckCircle className="h-4 w-4" />
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-4">
        {WEEKDAY_DISPLAY_ORDER.map((weekday) => {
          const dayBlocks = rhythmBlocksForWeekday(drafts, weekday);
          return (
            <Card key={weekday}>
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  {WEEKDAY_LABELS[weekday]}
                  <Badge variant="secondary">
                    予定枠 {formatRhythmHours(dayMinutes(weekday))}
                  </Badge>
                </CardTitle>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!dayBlocks.length}
                    onClick={() => {
                      setCopySource(weekday);
                      setCopyTargets([]);
                    }}
                  >
                    <Copy className="mr-1 h-4 w-4" />
                    ほかの曜日にコピー
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => addBlock(weekday)}>
                    <Plus className="mr-1 h-4 w-4" />
                    枠を追加
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {!dayBlocks.length && (
                  <p className="text-sm text-muted-foreground">枠はありません</p>
                )}
                {dayBlocks.map((block) => {
                  const name = `${WEEKDAY_LABELS[weekday]} ${block.start}-${block.end}`;
                  return (
                    <div
                      key={block.key}
                      className="flex flex-wrap items-center gap-2 rounded-md border p-2"
                      data-testid="rhythm-block"
                    >
                      <Input
                        type="time"
                        aria-label={`${name} の開始`}
                        className="w-28"
                        value={block.start}
                        onChange={(event) =>
                          updateBlock(block.key, { start: event.target.value })
                        }
                      />
                      <span aria-hidden>–</span>
                      <Input
                        type="time"
                        aria-label={`${name} の終了`}
                        className="w-28"
                        value={block.end}
                        onChange={(event) =>
                          updateBlock(block.key, { end: event.target.value })
                        }
                      />
                      <select
                        aria-label={`${name} の種類`}
                        className={SELECT_CLASS}
                        value={block.kind}
                        onChange={(event) =>
                          updateBlock(block.key, {
                            kind: event.target.value as WeeklyRhythmBlockKind,
                          })
                        }
                      >
                        {(
                          Object.keys(RHYTHM_KIND_LABELS) as WeeklyRhythmBlockKind[]
                        ).map((kind) => (
                          <option key={kind} value={kind}>
                            {RHYTHM_KIND_LABELS[kind]}
                          </option>
                        ))}
                      </select>
                      {block.kind === "schedule" && (
                        <>
                          <select
                            aria-label={`${name} のプロジェクト`}
                            className={`${SELECT_CLASS} max-w-48`}
                            value={block.project_id ?? NO_PROJECT}
                            onChange={(event) =>
                              updateBlock(block.key, {
                                project_id: event.target.value || null,
                              })
                            }
                          >
                            <option value={NO_PROJECT}>プロジェクト指定なし</option>
                            {projectOptions.map((project) => (
                              <option key={project.id} value={project.id}>
                                {project.title}
                                {isSelectableProject(project) ? "" : "（進行中以外）"}
                              </option>
                            ))}
                            {block.project_id && !projectTitle(block.project_id) && (
                              <option value={block.project_id}>不明なプロジェクト</option>
                            )}
                          </select>
                          <select
                            aria-label={`${name} の作業タイプ`}
                            className={SELECT_CLASS}
                            value={block.work_type}
                            onChange={(event) =>
                              updateBlock(block.key, {
                                work_type: event.target.value as WorkType,
                              })
                            }
                          >
                            {WORK_TYPES.map((workType) => (
                              <option key={workType} value={workType}>
                                {workTypeLabels[workType]}
                              </option>
                            ))}
                          </select>
                        </>
                      )}
                      <Input
                        aria-label={`${name} の名前`}
                        className="min-w-32 flex-1"
                        placeholder={
                          block.kind === "schedule" ? "名前（任意・例: 実験）" : "名前（例: 昼食）"
                        }
                        maxLength={200}
                        value={block.title ?? ""}
                        onChange={(event) =>
                          updateBlock(block.key, { title: event.target.value })
                        }
                      />
                      <label className="flex items-center gap-1 text-sm">
                        <Checkbox
                          aria-label={`${name} を動かさない`}
                          checked={block.locked}
                          onCheckedChange={(checked) =>
                            updateBlock(block.key, { locked: checked === true })
                          }
                        />
                        <Lock className="h-3 w-3" aria-hidden />
                        動かさない
                      </label>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`${name} を削除`}
                        onClick={() =>
                          edit((current) =>
                            current.filter((item) => item.key !== block.key),
                          )
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-end gap-3 border-t bg-gray-50/95 py-3 dark:bg-gray-900/95">
        {validationError && (
          <p className="mr-auto text-sm text-destructive" role="alert">
            {validationError}
          </p>
        )}
        {!validationError && dirty && (
          <p className="mr-auto text-sm text-muted-foreground">未保存の変更があります</p>
        )}
        <Button onClick={() => void save()} disabled={!dirty || saving || Boolean(validationError)}>
          {saving ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          保存
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">週の合計</CardTitle>
          <CardDescription>
            予定枠の時間から、同じ曜日の固定予定・休憩と重なる時間を除いて集計します（保存済みの内容）。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {summary.projects.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>プロジェクト</TableHead>
                  <TableHead className="text-right">週の時間</TableHead>
                  <TableHead className="text-right">うち動かさない</TableHead>
                  <TableHead className="text-right">配分</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.projects.map((row) => {
                  const percent = row.project_id
                    ? allocation?.project_allocations[row.project_id]
                    : allocation?.inbox_allocation_percent;
                  return (
                    <TableRow key={row.project_id ?? "inbox"}>
                      <TableCell>
                        {row.project_id
                          ? (row.project_title ?? "不明なプロジェクト")
                          : "プロジェクト指定なし（Inbox）"}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatRhythmHours(row.minutes)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatRhythmHours(row.locked_minutes)}
                      </TableCell>
                      <TableCell className="text-right">{percent ?? 0}%</TableCell>
                    </TableRow>
                  );
                })}
                <TableRow>
                  <TableCell className="font-medium">合計</TableCell>
                  <TableCell className="text-right font-medium">
                    {formatRhythmHours(summary.total_schedule_minutes)}
                  </TableCell>
                  <TableCell />
                  <TableCell className="text-right font-medium">100%</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">予定枠はまだありません</p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              トリアージとタイムラインが使う週の容量と配分を、この合計に合わせられます。
            </p>
            <Button
              variant="outline"
              disabled={!allocation || dirty || applying}
              onClick={() => setConfirmApply(true)}
            >
              {applying ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Scale className="mr-2 h-4 w-4" />
              )}
              トリアージ配分に反映
            </Button>
          </div>
          {dirty && allocation && (
            <p className="text-xs text-muted-foreground">
              反映する前に変更を保存してください。
            </p>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={copySource !== null}
        onOpenChange={(open) => !open && setCopySource(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {copySource !== null && WEEKDAY_LABELS[copySource]}の枠をコピー
            </DialogTitle>
            <DialogDescription>
              選んだ曜日の枠は、コピーした枠で置き換わります。
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-3">
            {WEEKDAY_DISPLAY_ORDER.filter((weekday) => weekday !== copySource).map(
              (weekday) => (
                <label key={weekday} className="flex items-center gap-1 text-sm">
                  <Checkbox
                    aria-label={`${WEEKDAY_LABELS[weekday]}にコピー`}
                    checked={copyTargets.includes(weekday)}
                    onCheckedChange={(checked) =>
                      setCopyTargets((current) =>
                        checked === true
                          ? [...current, weekday]
                          : current.filter((item) => item !== weekday),
                      )
                    }
                  />
                  {WEEKDAY_LABELS[weekday]}
                </label>
              ),
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCopySource(null)}>
              キャンセル
            </Button>
            <Button disabled={!copyTargets.length} onClick={copyDay}>
              コピー
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmApply} onOpenChange={setConfirmApply}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>トリアージ配分に反映しますか？</DialogTitle>
            <DialogDescription>
              トリアージの実働時間（週の容量 − 会議バッファ）が予定枠の合計
              {formatRhythmHours(summary.total_schedule_minutes)}
              になるよう週の容量を変え、プロジェクト配分を上の表の割合に置き換えます。プロジェクト指定なしの枠は
              Inbox の配分になります。会議バッファやそのほかの設定は変わりません。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmApply(false)}>
              キャンセル
            </Button>
            <Button onClick={() => void applyToTriage()}>反映する</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
