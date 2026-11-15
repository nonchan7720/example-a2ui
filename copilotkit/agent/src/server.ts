// エージェントランタイム: CopilotKit のランタイム(AG-UI のエンドポイント)と Claude Agent SDK を 1 つのプロセスで動かす。
// ブラウザからは直接呼ばせず、Go のゲートウェイ(../gateway)だけがここへ中継する。
import { createServer } from 'node:http'
import type { AbstractAgent } from '@ag-ui/client'
import { CopilotRuntime, InMemoryAgentRunner } from '@copilotkit/runtime/v2'
import { createCopilotNodeListener } from '@copilotkit/runtime/v2/node'
import { Approvals, GatedClaudeAgent } from './approval-gate.ts'
import { CREATE_TOOL, createReservationMcp, READ_TOOLS, reservationInput } from './reservations.ts'

const SYSTEM_PROMPT = `You are the assistant inside a restaurant reservation app for Kyoto.
- When the user wants a reservation, call search_availability first.
- Never call create_reservation directly. First call the confirm_reservation tool with your proposal. It shows the user an approval card where they can change the values, and returns JSON: {"approved": true, ...the values to use} or {"approved": false}.
- If approved, call create_reservation with the returned values. If not approved, do not save anything and ask what to change.
- The server enforces this: create_reservation is refused without an approval, and it saves the values the user approved, whatever arguments you pass. Tell the user what the tool result says was saved.
- Say a reservation is made only after create_reservation returned a reservationId.
Reply in the user's language, in one or two short sentences.`

// ClaudeAgentAdapter は AG-UI の 1 回の実行(RunAgentInput)を Agent SDK の query() に変換し、AG-UI のイベントを返す。
// ブラウザ側で登録したツール(useHumanInTheLoop の confirm_reservation)は、アダプターが `ag_ui` という MCP サーバーとして Claude に見せる。
// GatedClaudeAgent は、それに「confirm_reservation で承認された値でしか create_reservation を実行させない」を足したもの(approval-gate.ts)。
GatedClaudeAgent.approvals = new Approvals({ confirmTool: 'confirm_reservation', gatedTool: CREATE_TOOL, schema: reservationInput })
const agent = new GatedClaudeAgent({
  agentId: 'default',
  description: 'Restaurant reservation assistant',
  model: process.env.COPILOTKIT_AGENT_MODEL ?? 'claude-sonnet-5-5',
  systemPrompt: SYSTEM_PROMPT,
  // 組み込みツール(ファイル編集や Bash など)も、ディスク上の設定(CLAUDE.md、hooks など)も使わない。
  tools: [],
  settingSources: [],
  mcpServers: { reservations: createReservationMcp() },
  // 読むだけのツールは常に許可する。それ以外(予約の保存)は canUseTool に来る。
  allowedTools: READ_TOOLS,
  maxTurns: 10,
})

// 型の上だけの変換。@ag-ui/claude-agent-sdk は CommonJS 用の型定義(.d.ts)、ランタイムは ESM 用(.d.mts)から
// AbstractAgent を読むので、同じクラスなのに TypeScript には別物に見える。実行時は同じ 1 つのクラス。
const agents = { default: agent as unknown as AbstractAgent }
const runtime = new CopilotRuntime({ agents, runner: new InMemoryAgentRunner() })
const copilotkit = createCopilotNodeListener({ runtime, basePath: '/api/copilotkit' })

// ゲートウェイと共有する合言葉。設定されていれば、それを持たないリクエストは断る。
const token = process.env.AGENT_TOKEN

const server = createServer((request, response) => {
  if (token && request.headers['x-agent-token'] !== token) {
    response.writeHead(401, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'unauthorized' }))
    return
  }
  if (request.url === '/healthz') {
    response.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok')
    return
  }
  void copilotkit(request, response)
})

const port = Number(process.env.AGENT_PORT ?? 8000)
server.listen(port, '127.0.0.1', () => console.log(`agent runtime: http://127.0.0.1:${port}/api/copilotkit`))
