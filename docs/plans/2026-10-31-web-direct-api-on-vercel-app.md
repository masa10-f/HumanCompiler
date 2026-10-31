# Web: vercel.app からも API を直接呼ぶ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `human-compiler.vercel.app` で開いた Web も、独自ドメインと同じく `https://humancompiler-api-masa.fly.dev` を直接呼ぶ。これで API 側のクライアント IP がユーザーの IP になり、全ユーザーが1つのレート制限（200/分）を共有しなくなる。

**Architecture:** `getApiEndpoint()` の `human-compiler.vercel.app` の分岐を、独自ドメイン（#269 から直接呼んでいる）と同じにする。`apps/web/vercel.json` の `rewrites`（`/api/health` と `/api/(.*)`）と、`/api/(.*)` 用の `headers` を消す。API は変えない。

**Tech Stack:** Next.js 15、Jest、Vercel（`apps/web/vercel.json`）

**Spec:** masa10-f/HumanCompiler#393。選んだのは Option 2（ブラウザから Fly を直接呼ぶ）。理由は、独自ドメインではすでにこの形で動いているため（2026-10-31 のユーザーの判断）。

## 確認済みの前提（2026-10-31）

- Vercel 経由のリクエストは、Fly の access log で `54.249.97.175` に見える。直接呼ぶと、自分の IP に見える（#393 のコメントを参照）。
- `Origin: https://human-compiler.vercel.app` からのプリフライトは、本番 API が `200` を返す。`access-control-allow-origin` はその origin、`allow-headers` は `*`。
- `vercel.json` の CSP の `connect-src` には、`https://humancompiler-api-masa.fly.dev` がすでにある。
- `apps/web/src/app/api` はない。Vercel 上の `/api/*` を使うのは、この rewrite だけ。

## 決めたこと

- **SSR の分岐（`typeof window === 'undefined'` で、production なら `''` を返す）は変えない。** Node の `fetch` は相対 URL を解決できないので、rewrite があってもなくても動きは同じ。範囲外にする。
- **`getFallbackApiEndpoint()` は変えない。** vercel.app でも production を返すので、そのままでよい。
- **`/api/health` の rewrite も消す。** リポジトリの中に使っているところはない（`.github/workflows` も含めて確認済み）。

## Global Constraints

- コミットと PR は英語の Conventional Commits。`--amend` は使わない
- 新しいファイルには SPDX ヘッダーを付ける（`.spdx-header-typescript.txt`）
- Web のチェックは CI と同じ: `pnpm --filter web type-check`、`pnpm --filter web lint`、`pnpm --filter web test`

## Review Focus

1. **vercel.app で開いた画面からの API 呼び出し**: `fly.dev` へ直接行く → `config.test.ts` で `getApiEndpoint()` が production を返すこと
2. **独自ドメイン、preview、localhost**: 動きが変わらない → `config.test.ts` の既存のテストと `config-production-fallback.test.ts`
3. **merge の後、vercel.app 上の `/api/*`**: 404 になる（rewrite がないため）。これは意図した動きで、PR に書く
4. **使い方ガイドの API ホスト**（`agent-token-usage-guide.tsx` の `getApiEndpoint() || getFallbackApiEndpoint()`）: vercel.app でも production の URL を表示する → 動きは変わらない

---

### Task 1: vercel.app から API を直接呼び、Vercel の rewrite を消す

**Files:**
- Modify: `apps/web/src/lib/config.ts`（`getApiEndpoint()` の `human-compiler.vercel.app` の分岐）
- Modify: `apps/web/src/lib/__tests__/config.test.ts`
- Modify: `apps/web/vercel.json`（`rewrites` と `/api/(.*)` の `headers` を消す）
- Modify: `docs/design/agent-gateway.md:268`（「Vercel が書き換えるのは `/api/*` だけのため」は rewrite がなくなるので、理由の部分を消す）

**Interfaces:**
- Consumes: なし
- Produces: なし（`getApiEndpoint(): string` のシグネチャは同じ）

- [ ] **Step 1: テストを直す**

`config.test.ts` の `'should return empty string for production hostname'` を書き換える。

```ts
it('should return the production API for the vercel.app production hostname', () => {
  mockWindow('human-compiler.vercel.app');
  expect(getApiEndpoint()).toBe(appConfig.api.endpoints.production);
});

it('should return the production API for the custom domain', () => {
  mockWindow('human-compiler.rityo-lab.com');
  expect(getApiEndpoint()).toBe(appConfig.api.endpoints.production);
});
```

SSR のテスト（`toBe('')`）は変えない。

- [ ] **Step 2: 失敗を確かめる**

Run: `pnpm --filter web test -- src/lib/__tests__/config.test.ts`
Expected: vercel.app のテストが FAIL（`''` が返る）

- [ ] **Step 3: `getApiEndpoint()` を直す**

`human-compiler.vercel.app` と `human-compiler.rityo-lab.com` を1つの分岐にまとめ、`appConfig.api.endpoints.production` を返す。コメントは、両方の本番ドメインがブラウザから API を直接呼ぶこと、その理由（Vercel の rewrite を通すと API には Vercel の IP しか見えず、IP 単位のレート制限を全ユーザーで共有してしまう。#393）を書く。

- [ ] **Step 4: `vercel.json` から rewrite を消す**

`rewrites` 配列を丸ごと消す。`"source": "/api/(.*)"` の `headers` の要素も消す。`"/(.*)"` の `headers`（CSP を含む）は残す。

- [ ] **Step 5: spec を直す**

`docs/design/agent-gateway.md:268` の「（Vercel が書き換えるのは `/api/*` だけのため）」を消す。

- [ ] **Step 6: チェックを通す**

Run: `pnpm --filter web type-check && pnpm --filter web lint && pnpm --filter web test`
Expected: すべて PASS

- [ ] **Step 7: Commit** — `fix(web): Call the API directly on human-compiler.vercel.app`

PR の本文:
- `Closes #393` を付ける
- Deployment Notes に次を書く
  - merge 後は vercel.app 上の `/api/*` が 404 になること
  - merge 後に確かめること: vercel.app で開いた画面の通信が `fly.dev` へ行くこと、Fly の access log がユーザーの IP になること
