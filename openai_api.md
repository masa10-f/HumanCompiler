以下は **「自作 Python アプリで OpenAI API を使うための実践ガイド」** をそのまま貼って使える Markdown です。内容は **2025-08-12（JST）時点** の公式情報に基づいています。

---

# OpenAI Python API 速習ガイド（2025-08-12版）

> 公式ドキュメント：プラットフォーム概要、クイックスタート、APIリファレンス、ストリーミング、関数呼び出し、埋め込み、リアルタイムAPI へのリンクを本文中に示します。仕様は進化するため、コードの細部はリンク先で必ず最新を確認してください。([OpenAI][1], [OpenAI Platform][2])

---

## 1) セットアップ

### 1-1. インストール

```bash
pip install openai
```

> 公式クイックスタート/SDK案内を参照。([OpenAI Platform][2], [OpenAI][1])

### 1-2. 認証（APIキー）

**環境変数に設定**してから使うのが基本です。

* macOS/Linux（bash/zsh）

  ```bash
  export OPENAI_API_KEY="sk-...your key..."
  ```
* Windows（PowerShell）

  ```powershell
  setx OPENAI_API_KEY "sk-...your key..."
  ```

OpenAI は **API 経由の入力/出力を学習に使用しません**（既定）。プライバシー/保持ポリシーは概念ドキュメント参照。([OpenAI Platform][3])

---

## 2) 最小コード（Responses API 推奨）

> **Responses API** は従来の Chat Completions の簡潔さとツール実行の拡張性を統合した新しい基本 API です。まずはこれでテキスト生成を動かしましょう。([OpenAI][1])

```python
from openai import OpenAI
import os

client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])

resp = client.responses.create(
    model="gpt-5",
    input="3行で自己紹介を書いてください（日本語）。"
)

# SDK バージョンにより応答オブジェクトの形が異なる場合があります。
print(getattr(resp, "output_text", resp))
```

> Responses API の位置づけは API プラットフォームの案内を参照。([OpenAI][1])

---

## 3) Chat Completions（互換パターン）

既存コードや記事が多いエンドポイント。新規実装は Responses API を推奨しますが、互換性のための例を載せます。([OpenAI][1])

```python
from openai import OpenAI
client = OpenAI()

chat = client.chat.completions.create(
    model="gpt-5",
    messages=[{"role": "user", "content": "俳句を書いて"}]
)
print(chat.choices[0].message.content)
```

---

## 4) ストリーミング（逐次出力）

長文生成のユーザー体験向上に有効。([OpenAI Platform][4])

```python
from openai import OpenAI
client = OpenAI()

with client.chat.completions.create(
    model="gpt-5",
    messages=[{"role":"user","content":"500文字で要約して"}],
    stream=True,
) as stream:
    for chunk in stream:
        delta = chunk.choices[0].delta
        if delta and delta.content:
            print(delta.content, end="", flush=True)
```

---

## 5) 画像入力（Vision）

GPT-5 / GPT-4o 系は **テキスト＋画像入力**に対応（出力はテキスト）。([OpenAI][1], [OpenAI Platform][5])

```python
from openai import OpenAI
client = OpenAI()

chat = client.chat.completions.create(
    model="gpt-4o",  # 画像解析の代表モデル。GPT-5 でも可
    messages=[{
        "role":"user",
        "content":[
            {"type":"text","text":"この画像の要点を日本語で3つ箇条書きにして"},
            {"type":"image_url","image_url":{"url":"https://example.com/sample.jpg"}}
        ]
    }]
)
print(chat.choices[0].message.content)
```

> GPT-4o は「テキストと画像入力を受け取り、テキスト出力を返す」モデル。([OpenAI Platform][5])

---

## 6) ツール呼び出し（Function Calling）

モデルに **関数仕様（JSON Schema）** を渡して、必要時のみ道具を呼んでもらうパターン。([OpenAI Platform][6])

```python
from openai import OpenAI
client = OpenAI()

tools = [{
  "type": "function",
  "function": {
    "name": "get_current_weather",
    "description": "現在の天気を取得",
    "parameters": {
      "type": "object",
      "properties": {"city": {"type":"string"}},
      "required": ["city"]
    }
  }
}]

chat = client.chat.completions.create(
    model="gpt-5",
    messages=[{"role":"user","content":"上野の現在の天気は？"}],
    tools=tools
)

msg = chat.choices[0].message
if msg.tool_calls:
    # msg.tool_calls[0].function.arguments をパースして自前の関数を実行し、
    # 結果を "tool" ロールで追送して最終応答を得る（一般的なループ）。
    ...
```

---

## 7) 埋め込み（Embeddings）

検索/RAG のためのベクトル化。現行ガイドとモデルページはこちら。([OpenAI Platform][7])

```python
from openai import OpenAI
client = OpenAI()

emb = client.embeddings.create(
    model="text-embedding-3-large",
    input=["雷門は浅草にあります。", "東京スカイツリーはどこ？"]
)
print(len(emb.data[0].embedding))  # 次元数の確認
```

---

## 8) リアルタイム API（音声/低遅延会話）

**Realtime API** は音声入出力や低遅延の双方向対話に最適。WebRTC/SSE で扱えます（詳細は公式ガイドへ）。([OpenAI Platform][8])

---

## 9) 運用のベストプラクティス

* **モデル選定**：複雑な推論/エージェント → GPT-5、軽量/高速 → GPT-5 mini/nano、画像解析 → GPT-5 もしくは GPT-4o。([OpenAI][1], [OpenAI Platform][5])
* **レート制限/リトライ**：429/5xx では指数バックオフで自動再試行を。API リファレンスを参照。([OpenAI Platform][9])
* **セキュリティ**：API キーは環境変数/Secret Managerで管理。**APIデータは学習に利用しない**方針を理解しつつ、必要ならゼロデータ保持オプションも検討。([OpenAI Platform][3], [OpenAI][1])
* **ツール拡張**：Web 検索・ファイル検索・コード実行・Computer Use など組み込みツールを活用（Responses/Assistants/Agents SDK 経由）。([OpenAI][1])
* **非同期/バッチ**：大量処理には Batch API を検討。([OpenAI][1])

---

## 10) 最新の GPT ラインナップ（API向け）

> 2025-08-12 時点。価格/制限は変更されるため **モデルページ/プライシング** を随時確認してください。([OpenAI][1])

| モデル          | 主要モダリティ                     |                    文脈長（例） | 主な用途/特徴                                            | 参考                   |
| --------------- | ---------------------------------- | ------------------------------: | -------------------------------------------------------- | ---------------------- |
| **GPT-5**       | テキスト & 画像入力 / テキスト出力 | **最大 400k**（出力 128k 目安） | コーディング・高度推論・エージェント用途のフラッグシップ | ([OpenAI][1])          |
| **GPT-5 mini**  | 同上                               |                   **最大 400k** | 低コスト・高速。明確なタスクに最適                       | ([OpenAI][1])          |
| **GPT-5 nano**  | 同上                               |                   **最大 400k** | 最小コスト/最速。要約・分類など                          | ([OpenAI][1])          |
| **GPT-4o**      | テキスト & 画像入力 / テキスト出力 |            （モデルページ参照） | 汎用マルチモーダルの実績モデル                           | ([OpenAI Platform][5]) |
| **GPT-4o mini** | テキスト中心                       |     （モデルページ/価格表参照） | 省コスト運用                                             | ([OpenAI][1])          |

> 上記は **公式 API プラットフォーム** および **GPT-5 紹介記事/システムカード** の記載に基づく概要です。詳細スペックはドキュメントを確認してください。([OpenAI][1])

---

## 付録：よくある落とし穴

* **レスポンスオブジェクトの構造差**：SDK のバージョンやエンドポイント（Responses vs Chat Completions）で返り値の階層が違います。まず `print(response)` で形を把握し、公式の **API リファレンス** を随時参照。([OpenAI Platform][9])
* **モデルの寿命**：古いモデルは廃止・置換されます。**Deprecations** ページを定期チェック。([OpenAI Platform][10])
* **ストリーミングの実装差**：エンドポイントごとに実装が異なるため、**Streaming Responses** ガイドを参照。([OpenAI Platform][4])

---

### 参考リンク（公式）

* API プラットフォーム/モデル/価格・機能一覧：([OpenAI][1])
* クイックスタート：([OpenAI Platform][2])
* API リファレンス：([OpenAI Platform][9])
* ストリーミング：([OpenAI Platform][4])
* 関数呼び出し（Function Calling）：([OpenAI Platform][6])
* 埋め込み（Embeddings）ガイド/モデル：([OpenAI Platform][7])
* Realtime API：([OpenAI Platform][8])
* データの扱い/概念：([OpenAI Platform][3])

---

必要なら、この Markdown を `.md` ファイルとして書き出してお渡しします。内容をもう少し詳細化（例：RAG/検索、Agents SDK、音声リアルタイムの実装）することもできます。

[1]: https://openai.com/api/ "API Platform | OpenAI"
[2]: https://platform.openai.com/docs/quickstart?utm_source=chatgpt.com "Developer quickstart - OpenAI API"
[3]: https://platform.openai.com/docs/concepts?utm_source=chatgpt.com "Key concepts - OpenAI API"
[4]: https://platform.openai.com/docs/guides/streaming-responses?utm_source=chatgpt.com "Streaming API responses"
[5]: https://platform.openai.com/docs/models/gpt-4o?utm_source=chatgpt.com "Model - OpenAI API"
[6]: https://platform.openai.com/docs/guides/function-calling?utm_source=chatgpt.com "Function calling - OpenAI API"
[7]: https://platform.openai.com/docs/guides/embeddings?utm_source=chatgpt.com "Vector embeddings - OpenAI API"
[8]: https://platform.openai.com/docs/guides/realtime?utm_source=chatgpt.com "Realtime API Beta"
[9]: https://platform.openai.com/docs/api-reference/introduction?utm_source=chatgpt.com "API Reference"
[10]: https://platform.openai.com/docs/deprecations?utm_source=chatgpt.com "Deprecations - OpenAI API"
