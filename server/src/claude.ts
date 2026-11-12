// Claude Agent SDK 側の処理: 1 ターン分の query() を呼び、テキストの差分とツール呼び出しを取り出す。
import { query } from '@anthropic-ai/claude-agent-sdk'
import { APPROVAL_SCHEMAS, createReservationMcp, READ_TOOLS } from './reservation-mcp.ts'
import type { Reservations } from './reservations.ts'

const ROLE = `You are the assistant inside a chat app that can render UI.
When a form, a choice or structured data helps the user, reply with a short sentence plus an A2UI surface instead of asking in prose.
The user's clicks come back to you as a user message that starts with "[a2ui action]" and carries the action name, its surfaceId and its context as JSON. Treat it as the user's answer and continue the conversation.
Surfaces stay on screen for the whole conversation. To change one you created in an earlier turn (for example to turn a submitted form into a summary), write \`surface("its-id", update=true)\` and define \`root\` again. Starting a block with \`surface("its-id")\` alone creates a surface and fails if that id already exists, so use a new id for new UI, and remove surfaces that are no longer useful with \`deleteSurface("its-id")\`.
Everything you write outside an <a2ui> block is shown to the user as chat text, so write only the reply itself there: no planning, calculations or notes to yourself, and nothing before a tool call.

## Restaurant reservations
You can book restaurants in Kyoto with the reservations tools.
- When the user wants a reservation, call search_availability first, then show one form whose initial values come from the result: the restaurants as choices (value = restaurant id) with the first one selected, a time that is available, the date and the party size. Ask for the name and phone number in the same form.
- When the user submits that form, call create_reservation with those values. For courses, pre-fill one line: the restaurant's first course for the whole party. The app then shows the user an approval form with your arguments, which they may edit before approving, so do not ask for confirmation yourself and do not draw a confirmation UI.
- The tool result tells you what was actually saved. Say a reservation is made only after create_reservation returned a reservationId, and show that id and the saved values. If the user declined or it failed, say so and let them change the form.

Reply in the user's language. Apart from the reservations tools you have no tools: never claim to have sent or saved anything else.`

// 使うモデル。UI を返すだけなので、速い Sonnet を既定にしている。
const MODEL = process.env.A2UI_CHAT_MODEL ?? 'claude-sonnet-5-5'

export type Turn = {
  /** ユーザーの発言、または UI 操作を文章にしたもの。 */
  prompt: string
  /** A2UI の processor.promptSnippet。 */
  promptSnippet: string
  /** 会話の続きなら、前のターンが返した Agent SDK のセッション ID。 */
  resume?: string
  /** 書き込みをするツールの実行前に呼ばれる。ユーザーが承認したら、(直されたかもしれない)入力を返す。断られたら undefined。 */
  approve: (toolName: string, schema: unknown, input: Record<string, unknown>) => Promise<Record<string, unknown> | undefined>
  reservations: Reservations
  onText: (delta: string) => void
  onTool: (name: string, input: unknown) => void
}

/** 1 ターン実行し、次のターンで resume に渡すセッション ID を返す。 */
export async function runTurn({ prompt, promptSnippet, resume, approve, reservations, onText, onTool }: Turn): Promise<string> {
  let sessionId = resume ?? ''
  const messages = query({
    prompt,
    options: {
      model: MODEL,
      resume,
      systemPrompt: { type: 'preset', preset: 'claude_code', append: `${ROLE}\n\n${promptSnippet}` },
      includePartialMessages: true,
      // 組み込みツール(ファイル編集や Bash など)も、ディスク上の設定(CLAUDE.md、MCP、hooks など)も使わない。
      tools: [],
      settingSources: [],
      strictMcpConfig: true,
      // 使えるのは予約の MCP サーバーだけ。読むだけのツールは常に許可する。
      mcpServers: { reservations: createReservationMcp(reservations) },
      allowedTools: READ_TOOLS,
      // それ以外のツール(予約の保存)はここに来る。入力スキーマから承認フォームを出し、ユーザーが直した入力で実行する。
      canUseTool: async (toolName, input) => {
        const schema = APPROVAL_SCHEMAS[toolName]
        if (!schema) return { behavior: 'deny', message: 'This tool is not available.' }
        const approved = await approve(toolName, schema, input)
        return approved ? { behavior: 'allow', updatedInput: approved } : { behavior: 'deny', message: 'The user declined this action.' }
      },
      maxTurns: 6,
    },
  })
  for await (const message of messages) {
    if (message.type === 'system' && message.subtype === 'init') sessionId = message.session_id
    if (message.type === 'stream_event') {
      const event = message.event
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') onText(event.delta.text)
    }
    if (message.type === 'assistant') {
      for (const block of message.message.content) if (block.type === 'tool_use') onTool(block.name, block.input)
    }
    if (message.type === 'result' && message.subtype !== 'success') throw new Error(`Claude の呼び出しに失敗しました: ${message.subtype}`)
  }
  return sessionId
}
