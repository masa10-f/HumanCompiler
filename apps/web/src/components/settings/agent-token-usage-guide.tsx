// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { getApiEndpoint, getFallbackApiEndpoint } from "@/lib/config";

const AGENT_API_PATH = "/api/agent/v1";
const HOOK_PATH = "/api/hooks/quick-tasks";
const MCP_PATH = "/mcp";

const REQUEST_FIELDS = [
  { name: "title", required: true, description: "タスク名（1〜200文字）" },
  { name: "description", required: false, description: "詳細（1000文字まで）" },
  {
    name: "estimate_hours",
    required: false,
    description:
      "見積時間（0より大きく999.99以下、小数点以下2桁まで。デフォルト 0.5）",
  },
  {
    name: "due_date",
    required: false,
    description:
      "締切（ISO 8601）。日付のみ（例: 2026-10-15）は日本時間 0:00 として扱います。時刻を含める場合は +09:00 などのタイムゾーンが必要です（省略すると 422）",
  },
  {
    name: "work_type",
    required: false,
    description: "light_work（デフォルト） / study / focused_work",
  },
  {
    name: "priority",
    required: false,
    description: "優先度 1（最高）〜5（最低）、デフォルト 3",
  },
  {
    name: "status",
    required: false,
    description: "pending（デフォルト） / in_progress / completed / cancelled",
  },
];

const buildMeExample = (base: string) =>
  `curl -H "Authorization: Bearer <AGENT_TOKEN>" ${base}${AGENT_API_PATH}/me`;

const buildListExample = (base: string) =>
  `curl -H "Authorization: Bearer <AGENT_TOKEN>" "${base}${AGENT_API_PATH}/tasks?limit=50"`;

const buildProposalExample = (base: string) => `curl -X POST ${base}${AGENT_API_PATH}/proposals \\
  -H "Authorization: Bearer <AGENT_TOKEN>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "kind": "quick_task",
    "title": "論文の図3を作り直す",
    "rationale": "査読コメントで軸のラベルが読めないと指摘されたため",
    "payload": { "title": "図3の軸ラベルを直す", "estimate_hours": 0.5 },
    "idempotency_key": "example:quick_task:fig3@v1"
  }'`;

const buildAcceptedExperimentsExample = (base: string) =>
  `curl -H "Authorization: Bearer <AGENT_TOKEN>" "${base}${AGENT_API_PATH}/proposals?kind=experiment&status=accepted&status=edited"`;

const AGENT_ERROR_RESPONSES = [
  "401: tokenがない・無効・失効済み",
  "403: tokenに必要なスコープがない（detail は Missing required scope: <scope>）",
  "429: rate limit。Retry-After ヘッダーの秒数だけ待ってから再試行してください",
];

const buildCurlExample = (endpoint: string) => `curl -X POST ${endpoint} \\
  -H "Authorization: Bearer <AGENT_TOKEN>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "title": "PRレビュー",
    "description": "コメントを確認する",
    "estimate_hours": 0.5,
    "due_date": "2026-10-15T18:00:00+09:00",
    "work_type": "focused_work",
    "priority": 2
  }'`;

// The shell expands ${HUMANCOMPILER_TOKEN} inside double quotes before `claude`
// runs, so this one-liner stores the resolved token in Claude Code's config.
const buildClaudeCliExample = (mcpUrl: string) =>
  `claude mcp add --transport http humancompiler ${mcpUrl} --header "Authorization: Bearer \${HUMANCOMPILER_TOKEN}"`;

// Claude Code expands ${VAR} in .mcp.json headers each time it loads the file.
const buildClaudeJsonExample = (mcpUrl: string) => `{
  "mcpServers": {
    "humancompiler": {
      "type": "http",
      "url": "${mcpUrl}",
      "headers": {
        "Authorization": "Bearer \${HUMANCOMPILER_TOKEN}"
      }
    }
  }
}`;

const buildCodexExample = (mcpUrl: string) => `[mcp_servers.humancompiler]
url = "${mcpUrl}"
bearer_token_env_var = "HUMANCOMPILER_TOKEN"`;

// The npm package `humancompiler` (packages/cli). It reads the same
// HUMANCOMPILER_TOKEN, so the token never appears in these commands.
const CLI_EXAMPLE = `npx humancompiler@0 roadmap <project-id> --goals-per-page 20
npx humancompiler@0 context project <project-id> -o context.md`;

const CLI_COMMANDS = [
  {
    command: "roadmap",
    description:
      "プロジェクトのロードマップを手元で画像にし、スケジュール（完了見込み、遅れ）を表示します。projects:read、goals:read、tasks:read、logs:read が必要です",
  },
  {
    command: "context",
    description:
      "プロジェクトやゴールのノート、タスク、作業履歴を、1つのMarkdownで書き出します。context:read が必要です",
  },
  {
    command: "setup claude-code / setup codex",
    description:
      "上のMCPの設定と、エージェント向けの使い方の案内（CLAUDE.md / AGENTS.md）を書き込みます",
  },
  {
    command: "doctor",
    description:
      "tokenが有効か、各コマンドに必要なスコープがあるかを確かめ、直し方を表示します",
  },
];

export function AgentTokenUsageGuide() {
  const [isOpen, setIsOpen] = useState(false);
  const [apiBaseUrl, setApiBaseUrl] = useState("");
  const [showDocs, setShowDocs] = useState(false);

  useEffect(() => {
    // On the client every branch of getApiEndpoint() returns an absolute API
    // URL; '' only comes back during SSR. The fallbacks are kept defensively:
    // a relative base would go through a proxy and make Fly see its egress IP
    // for every user (shared per-IP auth-failure limit, skewed audit-log IPs),
    // so prefer the direct API host. The web origin is the last resort and
    // never serves /docs, so the docs pointer needs a real API host.
    const apiHost = getApiEndpoint() || getFallbackApiEndpoint();
    setApiBaseUrl(apiHost || window.location.origin);
    setShowDocs(apiHost !== "");
  }, []);

  const endpoint = `${apiBaseUrl}${HOOK_PATH}`;
  const mcpUrl = `${apiBaseUrl}${MCP_PATH}`;

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      className="rounded border"
    >
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="flex h-auto w-full items-center justify-start gap-2 p-3 text-left"
        >
          {isOpen ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
          <span className="text-sm font-medium">使用方法</span>
        </Button>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="space-y-6 border-t p-3 text-sm">
          <section className="space-y-4">
            <h4 className="text-sm font-semibold">Agent API</h4>
            <p className="text-muted-foreground">
              作成したtokenを付けて {AGENT_API_PATH}{" "}
              以下のエンドポイントを呼び出すと、タスクなどのデータを読み取れます。tokenに付けたスコープの範囲だけ使えます。
            </p>

            <div className="space-y-1">
              <div className="font-medium">認証ヘッダー（どちらか一方）</div>
              <code className="block overflow-x-auto rounded bg-muted px-2 py-1 text-xs">
                Authorization: Bearer &lt;AGENT_TOKEN&gt;
              </code>
              <code className="block overflow-x-auto rounded bg-muted px-2 py-1 text-xs">
                X-HumanCompiler-Agent-Token: &lt;AGENT_TOKEN&gt;
              </code>
            </div>

            <div className="space-y-1">
              <div className="font-medium">動作確認</div>
              <p className="text-muted-foreground">
                tokenの名前、prefix、スコープ、user_id が返ります。
              </p>
              <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">
                <code>{buildMeExample(apiBaseUrl)}</code>
              </pre>
            </div>

            <div className="space-y-1">
              <div className="font-medium">一覧の取得</div>
              <p className="text-muted-foreground">
                tasks:read スコープが必要です。limit は省略すると 100、最大 200
                です。
              </p>
              <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">
                <code>{buildListExample(apiBaseUrl)}</code>
              </pre>
              <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                <li>
                  応答は items（結果の配列）と next_cursor（次のページがなければ
                  null）です
                </li>
                <li>
                  次のページは、next_cursor の値を cursor=&lt;next_cursor&gt;
                  として付けて取得します
                </li>
                <li>
                  updated_since に、タイムゾーン付きのISO 8601（例:
                  2026-10-15T00:00:00+09:00）を指定すると、それ以降に更新されたものだけを取得できます（タイムゾーンがないと
                  422）
                </li>
              </ul>
            </div>

            <div className="space-y-1">
              <div className="font-medium">レスポンス</div>
              <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                {AGENT_ERROR_RESPONSES.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>

            {showDocs && (
              <p className="text-muted-foreground">
                エンドポイントごとの詳しい仕様は、APIの {apiBaseUrl}/docs
                で確認できます。
              </p>
            )}
          </section>

          <section className="space-y-4 border-t pt-4">
            <h4 className="text-sm font-semibold">Quick task hook</h4>
            <p className="text-muted-foreground">
              quick_tasks:write
              スコープのtokenを付けて以下のエンドポイントにJSONをPOSTすると、Quick
              Task（未分類タスク）として登録されます。
            </p>

            <div className="space-y-1">
              <div className="font-medium">エンドポイント</div>
              <code className="block overflow-x-auto rounded bg-muted px-2 py-1 text-xs">
                POST {endpoint}
              </code>
            </div>

            <div className="space-y-1">
              <div className="font-medium">認証ヘッダー</div>
              <p className="text-muted-foreground">
                Agent
                APIと同じヘッダーを使えます。既存のhook向けに、次のヘッダーも使えます。
              </p>
              <code className="block overflow-x-auto rounded bg-muted px-2 py-1 text-xs">
                X-HumanCompiler-Hook-Token: &lt;AGENT_TOKEN&gt;
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
                  <li
                    key={field.name}
                    className="flex flex-col gap-1 sm:flex-row sm:gap-2"
                  >
                    <span className="shrink-0 sm:w-36">
                      <code className="rounded bg-muted px-1 text-xs">
                        {field.name}
                      </code>
                      {field.required && (
                        <span className="ml-1 text-xs text-red-600">必須</span>
                      )}
                    </span>
                    <span className="text-muted-foreground">
                      {field.description}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-1">
              <div className="font-medium">レスポンス</div>
              <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                <li>201: 作成したQuick TaskをJSONで返します</li>
                <li>401: tokenがない・無効・失効済み</li>
                <li>
                  403: tokenに quick_tasks:write スコープがない（detail は
                  Missing required scope: quick_tasks:write）
                </li>
                <li>422: フィールドの値が不正</li>
                <li>
                  429: rate limit。Retry-After ヘッダーの秒数だけ待ってください
                </li>
              </ul>
            </div>

            <p className="text-muted-foreground">
              プロジェクトやゴールへの振り分けは、登録後に「タスク」画面のQuick
              Task一覧から行ってください。
            </p>
          </section>

          <section className="space-y-4 border-t pt-4">
            <h4 className="text-sm font-semibold">提案（proposals）</h4>
            <p className="text-muted-foreground">
              提案を送るtokenには proposals:write
              スコープが必要です（「提案するエージェント」プリセットに含まれています）。同じ
              idempotency_key を送り直しても、2件目の提案は作られません。
            </p>

            <div className="space-y-1">
              <div className="font-medium">提案を送る</div>
              <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">
                <code>{buildProposalExample(apiBaseUrl)}</code>
              </pre>
            </div>

            <div className="space-y-1">
              <div className="font-medium">承認された実験の取得</div>
              <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">
                <code>{buildAcceptedExperimentsExample(apiBaseUrl)}</code>
              </pre>
            </div>
          </section>

          <section className="space-y-4 border-t pt-4">
            <h4 className="text-sm font-semibold">
              MCP（Claude Code・Codex から使う）
            </h4>
            <p className="text-muted-foreground">
              MCP
              に対応したエージェントから、tokenのスコープの範囲で、Goal・Task・ノート・作業ログ（時間記録）の読み書きができます。書き込みには「作業するエージェント」プリセットなどのtokenが必要です。作業ログの記録には logs:write スコープが要ります。スコープは作成後に変えられないため、このスコープが無いtokenでは、tokenを作り直してください。
            </p>

            <div className="space-y-1">
              <div className="font-medium">サーバーURL</div>
              <code className="block overflow-x-auto rounded bg-muted px-2 py-1 text-xs">
                {mcpUrl}
              </code>
            </div>

            <div className="space-y-1">
              <div className="font-medium">事前の準備</div>
              <p className="text-muted-foreground">
                作成したtokenを、環境変数 HUMANCOMPILER_TOKEN
                に入れておきます（例: シェルの設定ファイルの
                export、またはパスワードマネージャー）。
              </p>
            </div>

            <div className="space-y-1">
              <div className="font-medium">Claude Code</div>
              <p className="text-muted-foreground">
                プロジェクトの .mcp.json に次のように書きます。Claude Code
                が読み込むたびに、環境変数から tokenを展開します。
                ファイルに書くのは変数名だけなので、コミットしても安全です。プロジェクトのサーバーは、初回に
                Claude Code が承認を求めます。
              </p>
              <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">
                <code>{buildClaudeJsonExample(mcpUrl)}</code>
              </pre>
              <div className="pt-2 font-medium">
                手早く試す場合（この方法ではトークンそのものが ~/.claude.json
                に保存されます）
              </div>
              <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">
                <code>{buildClaudeCliExample(mcpUrl)}</code>
              </pre>
              <p className="text-muted-foreground">
                このコマンドは、ダブルクォートの中の ${"{HUMANCOMPILER_TOKEN}"}{" "}
                をシェルが先に展開するため、tokenの値が Claude Code
                の設定ファイル（~/.claude.json）に保存されます。
              </p>
            </div>

            <div className="space-y-1">
              <div className="font-medium">Codex</div>
              <p className="text-muted-foreground">
                ~/.codex/config.toml に追記します。bearer_token_env_var
                には環境変数の名前を書きます（tokenの値は書きません）。
              </p>
              <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">
                <code>{buildCodexExample(mcpUrl)}</code>
              </pre>
            </div>

            <div className="space-y-1">
              <div className="font-medium">
                コマンドラインツール（npx humancompiler）
              </div>
              <p className="text-muted-foreground">
                同じ環境変数 HUMANCOMPILER_TOKEN
                のtokenで動くCLIです。エージェントは、MCP の find
                でプロジェクトのIDを調べてから実行します。データはCLIが直接取得するので、エージェントは表示された要約や、ファイルの必要な部分だけを読みます。
              </p>
              <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">
                <code>{CLI_EXAMPLE}</code>
              </pre>
              <ul className="space-y-1">
                {CLI_COMMANDS.map((item) => (
                  <li
                    key={item.command}
                    className="flex flex-col gap-1 sm:flex-row sm:gap-2"
                  >
                    <span className="shrink-0 sm:w-36">
                      <code className="rounded bg-muted px-1 text-xs">
                        {item.command}
                      </code>
                    </span>
                    <span className="text-muted-foreground">
                      {item.description}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <p className="text-muted-foreground">
              トークンは環境変数やファイルに置き、設定ファイルやチャットに直接書かないでください
            </p>
          </section>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
