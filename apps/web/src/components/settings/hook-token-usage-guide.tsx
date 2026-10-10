// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

'use client';

import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { getApiEndpoint } from '@/lib/config';

const HOOK_PATH = '/api/hooks/quick-tasks';

const REQUEST_FIELDS = [
  { name: 'title', required: true, description: 'タスク名（1〜200文字）' },
  { name: 'description', required: false, description: '詳細（1000文字まで）' },
  { name: 'estimate_hours', required: false, description: '見積時間（0より大きい値、デフォルト 0.5）' },
  {
    name: 'due_date',
    required: false,
    description: '締切（ISO 8601）。タイムゾーン省略時はUTCとして扱われるため +09:00 などを付けてください',
  },
  {
    name: 'work_type',
    required: false,
    description: 'light_work（デフォルト） / study / focused_work',
  },
  { name: 'priority', required: false, description: '優先度 1（最高）〜5（最低）、デフォルト 3' },
  {
    name: 'status',
    required: false,
    description: 'pending（デフォルト） / in_progress / completed / cancelled',
  },
];

const buildCurlExample = (endpoint: string) => `curl -X POST ${endpoint} \\
  -H "Authorization: Bearer <HOOK_TOKEN>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "title": "PRレビュー",
    "description": "コメントを確認する",
    "estimate_hours": 0.5,
    "due_date": "2026-10-15T18:00:00+09:00",
    "work_type": "focused_work",
    "priority": 2
  }'`;

export function HookTokenUsageGuide() {
  const [isOpen, setIsOpen] = useState(false);
  const [apiBaseUrl, setApiBaseUrl] = useState('');

  useEffect(() => {
    // Production uses a relative API base behind Vercel rewrites, but external
    // services need an absolute URL, so fall back to the current origin.
    setApiBaseUrl(getApiEndpoint() || window.location.origin);
  }, []);

  const endpoint = `${apiBaseUrl}${HOOK_PATH}`;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="rounded border">
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="flex h-auto w-full items-center justify-start gap-2 p-3 text-left"
          aria-expanded={isOpen}
        >
          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <span className="text-sm font-medium">使用方法</span>
        </Button>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="space-y-4 border-t p-3 text-sm">
          <p className="text-muted-foreground">
            作成したtokenを付けて以下のエンドポイントにJSONをPOSTすると、Quick Task（未分類タスク）として登録されます。
          </p>

          <div className="space-y-1">
            <div className="font-medium">エンドポイント</div>
            <code className="block overflow-x-auto rounded bg-muted px-2 py-1 text-xs">
              POST {endpoint}
            </code>
          </div>

          <div className="space-y-1">
            <div className="font-medium">認証ヘッダー（どちらか一方）</div>
            <code className="block overflow-x-auto rounded bg-muted px-2 py-1 text-xs">
              Authorization: Bearer &lt;HOOK_TOKEN&gt;
            </code>
            <code className="block overflow-x-auto rounded bg-muted px-2 py-1 text-xs">
              X-HumanCompiler-Hook-Token: &lt;HOOK_TOKEN&gt;
            </code>
          </div>

          <div className="space-y-1">
            <div className="font-medium">リクエスト例</div>
            <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">
              <code>{buildCurlExample(endpoint)}</code>
            </pre>
          </div>

          <div className="space-y-1">
            <div className="font-medium">フィールド</div>
            <ul className="space-y-1">
              {REQUEST_FIELDS.map((field) => (
                <li key={field.name} className="flex flex-col gap-1 sm:flex-row sm:gap-2">
                  <span className="shrink-0 sm:w-36">
                    <code className="rounded bg-muted px-1 text-xs">{field.name}</code>
                    {field.required && <span className="ml-1 text-xs text-red-600">必須</span>}
                  </span>
                  <span className="text-muted-foreground">{field.description}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-1">
            <div className="font-medium">レスポンス</div>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              <li>201: 作成したQuick TaskをJSONで返します</li>
              <li>401: tokenがない・無効・失効済み</li>
              <li>422: フィールドの値が不正</li>
            </ul>
          </div>

          <p className="text-muted-foreground">
            プロジェクトやゴールへの振り分けは、登録後に「タスク」画面のQuick Task一覧から行ってください。
          </p>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
