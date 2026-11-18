# LiteLLM Proxy 経由で tool search が使えるかの検証

2026-11-18 に、Claude Agent SDK(TypeScript 版)から LiteLLM Proxy を通して本物の Claude を呼び、tool search が動くことを確かめた結果です。検証コードは [`verify/litellm-toolsearch/`](../verify/litellm-toolsearch/)、実行結果は [`evidence/litellm-toolsearch/result.txt`](evidence/litellm-toolsearch/result.txt) にあります。

## 結論

**動く。** LiteLLM を挟んでも、直接つないだときと同じく ToolSearch で必要なツールだけが読み込まれた。LiteLLM は tool search に関わる部分(`defer_loading`、`tool_reference` ブロック、`anthropic-beta` ヘッダー)を変えずに上流へ渡していた。

ただし実際に動かして確かめたのは「上流が Anthropic API、認証は OAuth トークンの転送」の構成だけです。上流が Bedrock の場合は、LiteLLM が Bedrock へ送る内容までしか確かめていません([上流が Bedrock の場合](#上流が-bedrock-の場合)、[未確認のこと](#未確認のこと))。

## 実行した環境

| 項目 | 値 |
| --- | --- |
| SDK | `@anthropic-ai/claude-agent-sdk` 0.3.317(TypeScript 版。同梱の Claude Code バイナリも 0.3.317) |
| LiteLLM Proxy | 1.108.9(Docker、`ghcr.io/berriai/litellm:v1.108.9`) |
| Node.js | 22.23.5 |
| モデル | `claude-sonnet-5-5` |
| 上流 | Anthropic API(`anthropic/claude-sonnet-5-5`) |
| 認証 | `ANTHROPIC_API_KEY` は未設定。SDK が送る OAuth の `Authorization` ヘッダーを LiteLLM がそのまま上流へ渡す |

## 方法

```
SDK ─→ 中継(4100) ─→ LiteLLM(4000, Docker) ─→ 中継(4101) ─→ api.anthropic.com
```

- LiteLLM の前後に記録用の中継([`tap.mjs`](../verify/litellm-toolsearch/tap.mjs))を置き、SDK が送った内容と、LiteLLM が Anthropic API へ送った内容を突き合わせた。
- SDK には 15 個のツールを持つ MCP サーバーを渡し、そのうち 1 個(`warehouse_secret_code`)だけが返す合言葉を取ってこさせた([`toolsearch.mjs`](../verify/litellm-toolsearch/toolsearch.mjs))。合言葉は実行のたびに変わる乱数なので、ツールを呼ばないと答えられない。
- `ENABLE_TOOL_SEARCH` を未設定・`true`・`false` の 3 通りにして比べた。比較用に、LiteLLM を挟まない直結も 1 回流した。

LiteLLM の設定([`litellm.yaml`](../verify/litellm-toolsearch/litellm.yaml))で効いているのは `forward_client_headers_to_llm_api: true` だけです。SDK 側は次の 2 つを設定します。

```sh
export ANTHROPIC_BASE_URL=http://127.0.0.1:4000
export ANTHROPIC_CUSTOM_HEADERS="x-litellm-api-key: Bearer $LITELLM_MASTER_KEY"
```

LiteLLM 自身の認証を `x-litellm-api-key` で渡すのは、`Authorization` を Claude の認証のまま上流へ通すためです。

## 結果

| 経路 | `ENABLE_TOOL_SEARCH` | ToolSearch の呼び出し | 最初のリクエストに載った MCP ツール | 合言葉の取得 |
| --- | --- | --- | --- | --- |
| 直結 | 未設定 | あり | (記録なし) | 成功 |
| LiteLLM | 未設定 | あり | 0 個 | 成功 |
| LiteLLM | `true` | あり | 0 個 | 成功 |
| LiteLLM | `false` | なし | 15 個すべて | 成功 |

tool search が有効なときの流れ(LiteLLM 経由、実際のログから):

```
tool_use: ToolSearch {"query":"select:mcp__biz__warehouse_secret_code","max_results":1}
tool_result: [{"type":"tool_reference","tool_name":"mcp__biz__warehouse_secret_code"}]
tool_use: mcp__biz__warehouse_secret_code {"vault":"A7"}
tool_result: [{"type":"text","text":"vault=A7 code=ZEBRA-348974"}]
```

Anthropic API に届いたリクエストを見ると:

1. 1 回目は MCP ツールの定義が 1 個も載っていない(ツール名の一覧だけがプロンプトにある)。
2. ToolSearch の後の 2 回目から、選ばれた 1 個だけが `defer_loading: true` 付きで `tools` に加わり、`tool_result` の中に `tool_reference` ブロックが入る。
3. どのリクエストも、LiteLLM の前後で `tools` と `messages` は完全に一致し、`anthropic-beta` ヘッダー(`advanced-tool-use-2025-11-20` を含む)は 1 つも落ちていない。
4. LiteLLM のマスターキー(`x-litellm-api-key`)は上流へ渡っていない。

`ENABLE_TOOL_SEARCH=false` では ToolSearch ツール自体が無くなり、15 個の MCP ツールすべてが最初から `tools` に載った。

## 上流が Bedrock の場合

**Bedrock が実際に受け付けるかは未確認です。** Bedrock を呼べる認証情報が無かったため、LiteLLM が Bedrock へ送ろうとする内容だけを確かめました。

方法: 上の検証で SDK が LiteLLM へ送った実リクエスト 3 件を、Bedrock 向け設定([`bedrock/litellm.yaml`](../verify/litellm-toolsearch/bedrock/litellm.yaml)、東京リージョンの `jp.anthropic.claude-sonnet-4-5-20250929-v1:0`)の LiteLLM に流し直し、Bedrock の代わりに置いた中継で記録した。結果は [`evidence/litellm-toolsearch/bedrock-conversion.txt`](evidence/litellm-toolsearch/bedrock-conversion.txt)。

| 項目 | LiteLLM が Bedrock へ送った内容 |
| --- | --- |
| 宛先 | `POST /model/jp.anthropic.claude-sonnet-4-5-20250929-v1:0/invoke-with-response-stream` |
| `tools`(`defer_loading` を含む) | SDK が送ったものと完全一致 |
| `tool_reference` ブロック | 残っている |
| tool search のベータ | `advanced-tool-use-2025-11-20` を落とし、Bedrock 用の `tool-search-tool-2025-10-19` に置き換えた |
| そのまま送ったベータ | `context-management-2025-06-27`、`effort-2025-11-24`、`mid-conversation-tool-changes-2026-07-01`、`per-turn-control-2026-07-01`、`thinking-display-updates-2026-08-18` |
| 落としたベータ | `claude-code-20250219`、`oauth-2025-04-20`、`interleaved-thinking-2025-05-14`、`inline-tools-2026-09-15`、`advisor-tool-2026-03-01`、`thinking-token-count-2026-05-13`、`extended-cache-ttl-2025-04-11` |
| 落とした項目 | `context_management`、`output_config`(`model` と `stream` は URL に移る) |
| `thinking` | `{"type":"adaptive","display":"updates"}` → `{"type":"enabled","budget_tokens":2048}` |

読み取れること:

- tool search に必要なもの(`defer_loading`、`tool_reference`、tool search のベータ)は LiteLLM を通っても残る。LiteLLM は tool search を Bedrock 向けに通すつもりで作られている。
- 残る不安は Bedrock 側。SDK 0.3.317 は選ばれたツールを会話の途中で `tools` に足す方式で、LiteLLM は `mid-conversation-tool-changes-2026-07-01` などの新しいベータも Bedrock へ送る。Bedrock がこれらを受け付けるか、受け付けたうえで途中の `tools` の変更を許すかは、実際に呼ばないと分からない。
- 流し直したリクエストは、SDK が Anthropic API の `claude-sonnet-5-5` 向けに作ったもの。Bedrock の Sonnet 4.5 を相手にしたときに SDK が送る内容と同じとは限らない。

Bedrock を呼べる環境では、[`litellm.yaml`](../verify/litellm-toolsearch/litellm.yaml) の `model` を `bedrock/<推論プロファイル ID>` に変え、`api_base` と `forward_client_headers_to_llm_api` を消して AWS の認証情報を渡せば、`run.sh` がそのまま実機の検証になります。

## 未確認のこと

| 項目 | 理由 |
| --- | --- |
| `ENABLE_TOOL_SEARCH` 未設定のときの既定 | 未設定でも有効になったが、実行環境(Claude Code のクラウドセッション)の設定が既定の判定に影響している可能性を切り分けていない。LiteLLM 経由で使うなら `ENABLE_TOOL_SEARCH=true` を明示するのが確実 |
| `ANTHROPIC_API_KEY` を LiteLLM 側に持たせる構成 | この環境にキーが無い |
| 上流が Bedrock の構成で、Bedrock が実際に受け付けるか | Bedrock を呼べる認証情報が無い。LiteLLM が送る内容までは確かめた([上流が Bedrock の場合](#上流が-bedrock-の場合)) |
| 上流が Vertex AI の構成 | 試していない |
| `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` を設定した場合 | SDK のコードを読む限り tool search は無効になるが、実行しては確かめていない |
| Python 版の SDK | 試していない |

## 作り直し方

Node.js 22 以上、Docker、Claude Code のログインが必要です。

```sh
cd verify/litellm-toolsearch
bash run.sh
```

LiteLLM のコンテナと中継を起動し、4 パターンを流して、結果を `docs/evidence/litellm-toolsearch/result.txt` に書き出します(本物の Claude を呼びます)。続けて `bash bedrock/run.sh` を実行すると、Bedrock 向けの変換内容を `bedrock-conversion.txt` に書き出します(こちらは Claude も Bedrock も呼びません)。このディレクトリは SDK の版を 0.3.317 に固定するため、pnpm のワークスペースには入れていません。依存は `run.sh` が npm で入れます。
