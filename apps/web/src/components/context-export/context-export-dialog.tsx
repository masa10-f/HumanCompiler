// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

'use client';

import { useId, useRef, useState } from 'react';
import { Bot, Copy, Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/hooks/use-toast';
import { contextExportApi } from '@/lib/api';
import {
  DEFAULT_CONTEXT_EXPORT_OPTIONS,
  type ContextExportOptions,
  type ContextExportResponse,
  type ContextExportScope,
} from '@/types/context-export';

type ToggleKey = 'includeCompleted' | 'includeWorkSessions' | 'includeDailyPlans';

const TOGGLES: Array<{ key: ToggleKey; label: string; description: string }> = [
  {
    key: 'includeCompleted',
    label: '完了・キャンセル済みを含める',
    description: '終わったタスク（プロジェクトの場合はゴールも）を含めます。',
  },
  {
    key: 'includeWorkSessions',
    label: '作業セッションを含める',
    description: '予定成果・判断・KPT・中断メモなどの作業記録です。',
  },
  {
    key: 'includeDailyPlans',
    label: 'デイリープランの記録を含める',
    description: 'タスクに紐づいた予定行とそのメモです。',
  },
];

const PERIOD_OPTIONS: Array<{ value: string; label: string; days: number | null }> = [
  { value: 'all', label: '全期間', days: null },
  { value: '30', label: '直近30日', days: 30 },
  { value: '90', label: '直近90日', days: 90 },
];

interface ContextExportDialogProps {
  scope: ContextExportScope;
  targetId: string;
}

async function writeToClipboard(text: string): Promise<boolean> {
  if (!navigator.clipboard?.writeText) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Exports a project's or goal's notes and work history as a Markdown file
 * that can be pasted or attached to an AI chat as context.
 */
export function ContextExportDialog({ scope, targetId }: ContextExportDialogProps) {
  const idPrefix = useId();
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<ContextExportOptions>(
    DEFAULT_CONTEXT_EXPORT_OPTIONS,
  );
  const [result, setResult] = useState<ContextExportResponse | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const runRef = useRef(0);
  const previewRef = useRef<HTMLTextAreaElement>(null);

  const scopeLabel = scope === 'project' ? 'プロジェクト' : 'ゴール';

  // Any change invalidates the loaded export and ignores in-flight requests.
  const resetResult = () => {
    runRef.current += 1;
    setResult(null);
    setIsGenerating(false);
  };

  const updateOptions = (patch: Partial<ContextExportOptions>) => {
    setOptions((prev) => ({ ...prev, ...patch }));
    resetResult();
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) resetResult();
  };

  const generate = async () => {
    const runId = runRef.current + 1;
    runRef.current = runId;
    setIsGenerating(true);
    setResult(null);
    try {
      const response = await contextExportApi.get(scope, targetId, options);
      if (runRef.current === runId) setResult(response);
    } catch (error) {
      if (runRef.current !== runId) return;
      toast({
        title: '書き出しに失敗しました',
        description:
          error instanceof Error ? error.message : 'しばらくしてから再度お試しください。',
        variant: 'destructive',
      });
    } finally {
      if (runRef.current === runId) setIsGenerating(false);
    }
  };

  const copy = async () => {
    if (!result) return;
    if (await writeToClipboard(result.markdown)) {
      toast({
        title: 'クリップボードにコピーしました',
        description: 'AIとのチャットに貼り付けて使えます。',
      });
      return;
    }
    // Leave the text selected so it can be copied by hand.
    previewRef.current?.select();
    toast({
      title: 'コピーできませんでした',
      description: 'プレビューを選択した状態にしたので、手動でコピーしてください。',
      variant: 'destructive',
    });
  };

  const download = () => {
    if (!result) return;
    const blob = new Blob([result.markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = result.filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast({ title: 'ダウンロードを開始しました', description: result.filename });
  };

  const periodValue =
    PERIOD_OPTIONS.find((option) => option.days === options.periodDays)?.value ?? 'all';

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Bot className="mr-2 h-4 w-4" />
          AI用に書き出し
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>AI用に書き出し</DialogTitle>
          <DialogDescription>
            この{scopeLabel}のノート・タスク・作業記録を1つのMarkdownにまとめます。
            コピーしてAIとのチャットに貼り付けるか、ファイルとして添付してください。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-3">
            {TOGGLES.map(({ key, label, description }) => (
              <div key={key} className="flex items-start space-x-2">
                <Checkbox
                  id={`${idPrefix}-${key}`}
                  checked={options[key]}
                  onCheckedChange={(checked) => updateOptions({ [key]: checked === true })}
                />
                <div className="space-y-1">
                  <Label htmlFor={`${idPrefix}-${key}`} className="text-sm">
                    {label}
                  </Label>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{description}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <Label className="text-sm">作業記録の期間</Label>
            <RadioGroup
              value={periodValue}
              onValueChange={(value) =>
                updateOptions({
                  periodDays:
                    PERIOD_OPTIONS.find((option) => option.value === value)?.days ?? null,
                })
              }
              className="flex flex-wrap gap-4"
            >
              {PERIOD_OPTIONS.map((option) => (
                <div key={option.value} className="flex items-center space-x-2">
                  <RadioGroupItem
                    value={option.value}
                    id={`${idPrefix}-period-${option.value}`}
                  />
                  <Label
                    htmlFor={`${idPrefix}-period-${option.value}`}
                    className="text-sm font-normal"
                  >
                    {option.label}
                  </Label>
                </div>
              ))}
            </RadioGroup>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              作業セッションとデイリープランに適用されます。ノートとタスクは常にすべて含まれます。
            </p>
          </div>

          <Button onClick={generate} disabled={isGenerating} className="w-full">
            {isGenerating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                生成中...
              </>
            ) : (
              '生成'
            )}
          </Button>

          {result && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0 text-sm text-gray-600 dark:text-gray-400">
                  <span className="break-all font-medium">{result.filename}</span>
                  <span className="ml-2">
                    {result.markdown.length.toLocaleString()}文字
                  </span>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={copy}>
                    <Copy className="mr-2 h-4 w-4" />
                    コピー
                  </Button>
                  <Button variant="outline" size="sm" onClick={download}>
                    <Download className="mr-2 h-4 w-4" />
                    ダウンロード
                  </Button>
                </div>
              </div>
              <Textarea
                ref={previewRef}
                readOnly
                value={result.markdown}
                aria-label="書き出し内容のプレビュー"
                className="h-64 font-mono text-xs"
              />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
