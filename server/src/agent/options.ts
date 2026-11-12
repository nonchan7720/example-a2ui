// フォームの選択欄のために、選択肢を 1 ページ取ってくる。
// MCP のツールを呼ぶのは Claude(Agent SDK)だけ、という構成を保つため、アプリ層は MCP を直接呼ばない。
// 代わりに、選択肢のツール 1 つだけを許可した短い query() を回し、Claude にそのツールを呼ばせる。
// ブラウザへ返すのは、ツールが返した結果そのもの(Claude に書き写させない)。
import { query } from '@anthropic-ai/claude-agent-sdk'
import { createReservationMcp, OPTION_TOOLS } from '../mcp/reservation-mcp.ts'

// 「言われたツールを言われた引数で呼ぶ」だけなので、速いモデルにする。
const MODEL = process.env.A2UI_CHAT_OPTIONS_MODEL ?? 'claude-haiku-5-5'

export async function fetchOptions(tool: string, args: Record<string, unknown>): Promise<unknown> {
  if (!OPTION_TOOLS.includes(tool)) throw new Error(`選択肢のツールではありません: ${tool}`)
  const toolName = `mcp__reservations__${tool}`

  const messages = query({
    prompt: `Call the tool ${toolName} once with exactly these arguments and nothing else:\n${JSON.stringify(args)}`,
    options: {
      model: MODEL,
      systemPrompt: 'You fetch one page of choices for a form. Call the tool you are told to call, with exactly the given arguments. Do not write any text.',
      tools: [],
      settingSources: [],
      strictMcpConfig: true,
      mcpServers: { reservations: createReservationMcp() },
      allowedTools: [toolName],
      maxTurns: 2,
      persistSession: false,
    },
  })
  for await (const message of messages) {
    if (message.type !== 'user' || typeof message.message.content === 'string') continue
    for (const block of message.message.content) {
      if (block.type !== 'tool_result') continue
      const text = typeof block.content === 'string' ? block.content : block.content?.find((part) => part.type === 'text')?.text
      if (block.is_error || !text) throw new Error(`選択肢を取得できませんでした: ${text ?? ''}`)
      // 結果が取れたら、Claude の続きの応答は待たずに終える(ループを抜けると query() は止まる)。
      return JSON.parse(text)
    }
  }
  throw new Error('選択肢を取得できませんでした: ツールが呼ばれませんでした')
}
