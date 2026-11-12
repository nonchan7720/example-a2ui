// HTTP サーバー。POST /api/chat を受け、Claude の応答を part ごとに SSE で返す。
import { createServer, type ServerResponse } from 'node:http'
import type { RendererCapabilities, RendererState } from '@a2ui/agent'
import { createProcessor, openA2uiStream } from './a2ui.ts'
import { runTurn } from './claude.ts'

type ChatRequest = {
  conversationId: string
  message: string
  capabilities?: Record<string, RendererCapabilities>
}

/** 会話ごとに、Agent SDK のセッション ID と A2UI の state を 1 つずつ持つ(メモリ上のみ)。 */
type Conversation = { sessionId?: string; state?: RendererState }
const conversations = new Map<string, Conversation>()

async function chat(request: ChatRequest, response: ServerResponse) {
  response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
  const send = (event: string, data: unknown) => response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

  const conversation = conversations.get(request.conversationId) ?? {}
  conversations.set(request.conversationId, conversation)

  try {
    const processor = createProcessor(request.capabilities)
    // state は会話の間ずっと使い回す。クライアントのカタログが変わったときだけ作り直す。
    if (!conversation.state || !processor.acceptsState(conversation.state)) conversation.state = processor.createState()
    const stream = openA2uiStream(processor, conversation.state)

    conversation.sessionId = await runTurn({
      prompt: request.message,
      promptSnippet: processor.promptSnippet,
      resume: conversation.sessionId,
      onText: (delta) => {
        if (process.env.LOG_RAW) process.stdout.write(delta)
        for (const part of stream.feed(delta)) send('part', part)
      },
    })
    for (const part of stream.close()) send('part', part)
  } catch (error) {
    console.error(error)
    send('part', { type: 'error', message: error instanceof Error ? error.message : String(error) })
  }
  send('done', {})
  response.end()
}

const server = createServer(async (request, response) => {
  if (request.method !== 'POST' || request.url !== '/api/chat') {
    response.writeHead(404).end()
    return
  }
  let body = ''
  for await (const chunk of request) body += chunk
  try {
    const parsed = JSON.parse(body) as ChatRequest
    if (typeof parsed.conversationId !== 'string' || typeof parsed.message !== 'string') throw new Error('bad request')
    await chat(parsed, response)
  } catch {
    if (!response.headersSent) response.writeHead(400)
    response.end()
  }
})

const port = Number(process.env.PORT ?? 8787)
server.listen(port, '127.0.0.1', () => console.log(`a2ui-chat server: http://127.0.0.1:${port}`))
