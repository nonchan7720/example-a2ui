# CopilotKit × Claude Agent SDK(TypeScript)× Go ゲートウェイ

React の SPA に [CopilotKit](https://docs.copilotkit.ai/claude-sdk-typescript/) を入れ、Go のサーバーを挟んで Claude Agent SDK のエージェントにつなぐサンプルです。Human in the loop(実行前の承認)を入れてあります。

```
ブラウザ(web/: Vite + React + CopilotKit)
   │  /api/copilotkit/*   AG-UI のイベントが SSE で流れる
   ▼
Go ゲートウェイ(gateway/)        SPA の配信と、エージェントランタイムへの中継
   │  同じパスのまま中継(X-Agent-Token を付ける)
   ▼
エージェントランタイム(agent/)    CopilotKit ランタイム + ClaudeAgentAdapter + Claude Agent SDK
```

![承認カード](../docs/evidence/copilotkit/01-approval.png)

## 起動手順

必要なもの: Node 26、pnpm 12、Go 1.24 以上。

```sh
pnpm install                         # リポジトリのルートで
export ANTHROPIC_API_KEY=...         # Claude Code にログイン済みの環境では不要
pnpm dev:copilotkit                  # agent (http://127.0.0.1:8000) と web (http://localhost:5174)
(cd copilotkit/gateway && go run .)  # ゲートウェイ (http://127.0.0.1:8080)。別のターミナルで
```

http://localhost:5174 を開き、「来週金曜の夜、4人で京都の和食を予約したい。名前は山田です。」のように送ります。開発中も `/api` は Vite から Go のゲートウェイを通ります。

SPA をビルドすれば、Vite なしで Go だけがブラウザの相手をします。

```sh
pnpm --filter copilotkit-web build
(cd copilotkit/gateway && go run .)  # http://127.0.0.1:8080 で SPA も返す
```

| 環境変数 | 既定値 | 使う側 | 意味 |
| --- | --- | --- | --- |
| `COPILOTKIT_AGENT_MODEL` | `claude-sonnet-5-5` | agent | 使うモデル |
| `AGENT_PORT` | `8000` | agent | エージェントランタイムのポート |
| `AGENT_URL` | `http://127.0.0.1:8000` | gateway | 中継先 |
| `GATEWAY_ADDR` | `127.0.0.1:8080` | gateway | 待ち受けるアドレス(変えるときは `web/vite.config.ts` の proxy も変える) |
| `STATIC_DIR` | `../web/dist` | gateway | SPA のビルド結果 |
| `AGENT_TOKEN` | なし | 両方 | 同じ値を両方に設定すると、ゲートウェイを通らないリクエストをエージェントランタイムが断る |

## 各部の役割

- `web/src/App.tsx`: `<CopilotKit runtimeUrl="/api/copilotkit">` と `<CopilotChat>`。`useHumanInTheLoop` で承認カードを登録する。
- `web/src/ReservationApproval.tsx`: 承認カード。Claude の提案を初期値にし、ユーザーが直して承認できる。
- `gateway/main.go`: 標準ライブラリだけの中継サーバー。`/api/copilotkit/` を中継し(SSE は溜めずに流す)、それ以外には SPA を返す。認証やレート制限を足す場所。
- `agent/src/server.ts`: `CopilotRuntime` に `ClaudeAgentAdapter` を登録し、`createCopilotNodeListener` で Node の HTTP サーバーにする。
- `agent/src/reservations.ts`: 予約のツール(プロセス内 MCP サーバー、データは架空でメモリ上のみ)。

Go が中継するだけで済むのは、ブラウザとランタイムの間が普通の HTTP(JSON の POST と SSE の応答)だからです。CopilotKit のランタイムは Node のライブラリなので、Go に置き換えることはできず、エージェントランタイム側のプロセスに入れています。

## Human in the loop の流れ

Claude Agent SDK(TypeScript)の連携では、`useInterrupt`(割り込み)は使えません。承認は「ブラウザ側のツール」として作ります。

1. `useHumanInTheLoop` が `confirm_reservation` というツールを登録する。ツールの定義は実行のたびにランタイムへ送られ、アダプターが Claude に見せる。
2. Claude が `search_availability` で空きを調べ、`confirm_reservation` を呼ぶ。ここで実行が止まり、チャットの中に承認カードが出る。
3. ユーザーが値を直して「承認して予約」を押すと、`respond({ approved: true, ...値 })` がツールの結果として Claude に返り、実行が続く。
4. Claude が、返ってきた値で `create_reservation` を呼ぶ。

承認を通すかどうかは、システムプロンプトの指示(「`create_reservation` の前に必ず `confirm_reservation` を呼ぶ」)に頼っています。Claude が指示を守らなければ承認なしで保存されるので、確実に止めたい操作には、ルートのサンプル(`server/`)のように Agent SDK の `canUseTool` でサーバー側から止める方法が向いています。

## 確認したこと

2026-11-15 に、ビルドした SPA を Go のゲートウェイから開き、ヘッドレスの Chromium で次を確かめました。

- 予約の依頼 → 承認カードが出る → 人数を 4 から 3 に直して承認 → 3 名で保存され、予約番号が返る([保存後の画面](../docs/evidence/copilotkit/02-saved.png))
- `go test ./...`: 中継先のパスとトークン、SSE が途中で届くこと、エージェントに届かないときの 502、SPA の配信

確かめていないこと: キャンセルしたときの流れ、`AGENT_TOKEN` を設定した状態での通し、複数ユーザーでの同時利用。

## 注意

- CopilotKit のオンボーディング CLI(`npx copilotkit@latest onboard start`)は使わず、公開されているドキュメントとパッケージの型定義をもとに手で組み込みました。CLI が作る構成とは違う可能性があります。
- CopilotKit のランタイムは、既定で利用状況(テレメトリー)を送ります。`agent` の `dev` スクリプトでは `COPILOTKIT_TELEMETRY_DISABLED=true` で止めています。インストール統計を送る `@scarf/scarf` の postinstall も、`pnpm-workspace.yaml` で実行しない設定にしています。
- 会話と予約はエージェントランタイムのメモリにあります。再起動で消えます。
- `@ag-ui/claude-agent-sdk` は 0.0.9 で、Claude Agent SDK は 0.3.306 に固定されます(ルートのサンプルは 0.3.322)。
- 認証はありません。ゲートウェイもエージェントランタイムも 127.0.0.1 だけで待ち受けます。
