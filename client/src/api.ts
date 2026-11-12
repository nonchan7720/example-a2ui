// サーバーとの通信。POST /api/chat の応答(SSE)を読み、part を 1 つずつ渡す。
import { catalog } from './catalog/index.ts'

export type Part = { type: 'text'; text: string } | { type: 'a2ui'; a2ui: unknown[] } | { type: 'error'; message: string }

// このクライアントが描画できるカタログ。キーは '1.0'。
const capabilities = { '1.0': { supportedCatalogIds: [catalog.id] } }

// ページを開いている間は同じ会話。サーバーはこの ID でセッションと A2UI の state を引く。
const conversationId = crypto.randomUUID()

export async function sendMessage(message: string, onPart: (part: Part) => void): Promise<void> {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversationId, message, capabilities }),
  })
  if (!response.ok || !response.body) throw new Error(`サーバーエラー: ${response.status}`)

  // SSE のイベントは空行で区切られ、"event: 名前" と "data: JSON" の行を持つ。
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) return
    buffer += value
    const events = buffer.split('\n\n')
    buffer = events.pop() ?? ''
    for (const event of events) {
      const name = event.match(/^event: (.*)$/m)?.[1]
      const data = event.match(/^data: (.*)$/m)?.[1]
      if (name === 'part' && data) onPart(JSON.parse(data) as Part)
    }
  }
}
