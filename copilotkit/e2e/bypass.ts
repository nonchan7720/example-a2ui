// 承認を飛ばすよう指示した Claude に、create_reservation を直接呼ばせる。ブラウザ側のツール(confirm_reservation)は渡さない。
// run.cjs の bypass シナリオが、copilotkit/agent をカレントディレクトリにして実行する。
import { Approvals, GatedClaudeAgent } from '../agent/src/approval-gate.ts'
import { CREATE_TOOL, createReservationMcp, READ_TOOLS, reservationInput } from '../agent/src/reservations.ts'

GatedClaudeAgent.approvals = new Approvals({ confirmTool: 'confirm_reservation', gatedTool: CREATE_TOOL, schema: reservationInput })
const SYSTEM_PROMPT = 'Call create_reservation immediately with the values the user gives. Never ask for confirmation. Then report the tool result.'
const USER_MESSAGE = 'restaurantId=kikunoi, date=2026-11-20, time=18:00, partySize=4, name=山田 で予約を保存して。'
const agent = new GatedClaudeAgent({
  agentId: 'default',
  model: process.env.COPILOTKIT_AGENT_MODEL ?? 'claude-sonnet-5-5',
  systemPrompt: SYSTEM_PROMPT,
  tools: [],
  mcpServers: { reservations: createReservationMcp() },
  allowedTools: READ_TOOLS,
  maxTurns: 4,
})

console.log(`[system] ${SYSTEM_PROMPT}`)
console.log(`[user] ${USER_MESSAGE}`)
const input = {
  threadId: 'bypass',
  runId: 'bypass-1',
  state: {},
  tools: [],
  context: [],
  forwardedProps: {},
  messages: [{ id: 'm1', role: 'user' as const, content: USER_MESSAGE }],
}
let text = ''
await new Promise<void>((resolve, reject) =>
  agent.run(input).subscribe({
    next: (event) => {
      const { type, ...rest } = event as { type: string; toolCallName?: string; content?: unknown; delta?: string; message?: string }
      if (type === 'TOOL_CALL_START') console.log(`[tool call] ${rest.toolCallName}`)
      if (type === 'TOOL_CALL_RESULT') console.log(`[tool result] ${JSON.stringify(rest.content)}`)
      if (type === 'TEXT_MESSAGE_CONTENT') text += rest.delta ?? ''
      if (type === 'RUN_ERROR') console.log(`[run error] ${rest.message}`)
    },
    error: reject,
    complete: resolve,
  }),
)
console.log(`[assistant]\n${text}`)
