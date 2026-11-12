// Claude Agent SDK 側の処理: 1 ターン分の query() を呼び、テキストの差分だけを取り出す。
import { query } from '@anthropic-ai/claude-agent-sdk'

const ROLE = `You are the assistant inside a chat app that can render UI.
When a form, a choice or structured data helps the user, reply with a short sentence plus an A2UI surface instead of asking in prose.
The user's clicks come back to you as a user message that starts with "[a2ui action]" and carries the action name, its surfaceId and its context as JSON. Treat it as the user's answer and continue the conversation.
Surfaces stay on screen for the whole conversation. To change one you created in an earlier turn (for example to turn a submitted form into a summary), write \`surface("its-id", update=true)\` and define \`root\` again. Starting a block with \`surface("its-id")\` alone creates a surface and fails if that id already exists, so use a new id for new UI, and remove surfaces that are no longer useful with \`deleteSurface("its-id")\`.
Everything you write outside an <a2ui> block is shown to the user as chat text, so write only the reply itself there: no planning, calculations or notes to yourself.
Reply in the user's language. You have no tools: never claim to have actually booked, sent or saved anything.`

// 使うモデル。UI を返すだけなので、速い Sonnet を既定にしている。
const MODEL = process.env.A2UI_CHAT_MODEL ?? 'claude-sonnet-5-5'

export type Turn = {
  /** ユーザーの発言、または UI 操作を文章にしたもの。 */
  prompt: string
  /** A2UI の processor.promptSnippet。 */
  promptSnippet: string
  /** 会話の続きなら、前のターンが返した Agent SDK のセッション ID。 */
  resume?: string
  onText: (delta: string) => void
}

/** 1 ターン実行し、次のターンで resume に渡すセッション ID を返す。 */
export async function runTurn({ prompt, promptSnippet, resume, onText }: Turn): Promise<string> {
  let sessionId = resume ?? ''
  const messages = query({
    prompt,
    options: {
      model: MODEL,
      resume,
      systemPrompt: { type: 'preset', preset: 'claude_code', append: `${ROLE}\n\n${promptSnippet}` },
      includePartialMessages: true,
      // UI を返すだけなので、組み込みツールも、ディスク上の設定(CLAUDE.md、MCP、hooks など)も使わない。
      tools: [],
      settingSources: [],
      strictMcpConfig: true,
      maxTurns: 1,
    },
  })
  for await (const message of messages) {
    if (message.type === 'system' && message.subtype === 'init') sessionId = message.session_id
    if (message.type === 'stream_event') {
      const event = message.event
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') onText(event.delta.text)
    }
    if (message.type === 'result' && message.subtype !== 'success') throw new Error(`Claude の呼び出しに失敗しました: ${message.subtype}`)
  }
  return sessionId
}
