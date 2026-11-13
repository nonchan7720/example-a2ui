// HTTP サーバー。POST /api/chat を受け、Claude の応答を part ごとに SSE で返す。
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { RendererCapabilities, RendererState } from '@a2ui/agent'
import { z } from 'zod'
import { runTurn } from '../agent/claude.ts'
import { fetchOptions } from '../agent/options.ts'
import { createProcessor, openA2uiStream } from './a2ui.ts'
import { approvalForm, coerce, describeIssue, removeApprovalForm, type Schema } from './approval.ts'

type ChatRequest = {
  conversationId: string
  /** チャット欄からの発言。 */
  message?: string
  /** UI のボタンなどの操作。message の代わりに送る。 */
  action?: { name: string; surfaceId: string; context: unknown }
  capabilities?: Record<string, RendererCapabilities>
}

/** 承認フォームへの回答。input は承認時にフォームに入っていた値。 */
type ApprovalRequest = { surfaceId: string; approved: boolean; input?: Record<string, unknown> }

/** 会話ごとに、Agent SDK のセッション ID と A2UI の state を 1 つずつ持つ(メモリ上のみ)。 */
type Conversation = { sessionId?: string; state?: RendererState }
const conversations = new Map<string, Conversation>()

/** 回答待ちの承認フォーム。キーは surface の ID。 */
const pendingApprovals = new Map<string, (answer: ApprovalRequest) => void>()

async function chat(request: ChatRequest, response: ServerResponse) {
  response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
  const send = (event: string, data: unknown) => response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

  const conversation = conversations.get(request.conversationId) ?? {}
  conversations.set(request.conversationId, conversation)

  try {
    const processor = createProcessor(request.capabilities)
    // state は会話の間ずっと使い回す。クライアントのカタログが変わったときだけ作り直す。
    if (!conversation.state || !processor.acceptsState(conversation.state)) conversation.state = processor.createState()
    const state = conversation.state
    const stream = openA2uiStream(processor, state)

    // サーバーが自分で組み立てた A2UI のメッセージを送る。Claude の出力と同じ state を通すので、検証も記録もされる。
    const sendA2ui = (messages: unknown[]) => {
      state.apply(messages)
      send('part', { type: 'a2ui', a2ui: messages })
    }

    conversation.sessionId = await runTurn({
      // UI の操作は、次のユーザーメッセージとして Claude に渡す。
      prompt: request.action ? `[a2ui action] ${JSON.stringify(request.action)}` : (request.message ?? ''),
      promptSnippet: processor.promptSnippet,
      resume: conversation.sessionId,
      onText: (delta) => {
        if (process.env.LOG_RAW) process.stdout.write(delta)
        for (const part of stream.feed(delta)) send('part', part)
      },
      onTool: (name, input) => {
        if (process.env.LOG_RAW) console.log(`\n[tool] ${name} ${JSON.stringify(input)}`)
        send('part', { type: 'tool', name, input })
      },
      // 承認フォームを出し、POST /api/approval で回答が来るまで待つ。
      approve: async (toolName, { schema, check }, input) => {
        const formSchema = z.toJSONSchema(schema) as Schema
        const surfaceId = `approval_${crypto.randomUUID().replaceAll('-', '')}`
        sendA2ui(approvalForm(surfaceId, processor.catalogs[0].id, toolName, formSchema, input))
        try {
          for (;;) {
            const answer = await new Promise<ApprovalRequest>((resolve) => pendingApprovals.set(surfaceId, resolve))
            if (process.env.LOG_RAW) console.log(`\n[approval] ${JSON.stringify(answer)}`)
            if (!answer.approved) return undefined
            // 直された値を確かめる: まずツールのスキーマ(型・必須・範囲)、次にデータに照らした確認(満席、店に無いメニューなど)。
            // 正しくなければ理由を返し、フォームは開いたまま次の回答を待つ。
            const checked = schema.safeParse(coerce(formSchema, answer.input ?? input))
            const problems = checked.success ? (check?.(checked.data as Record<string, unknown>) ?? []) : checked.error.issues
            if (checked.success && problems.length === 0) return checked.data as Record<string, unknown>
            const reasons = problems.map((problem) => describeIssue(formSchema, problem.path, problem.message))
            send('part', { type: 'error', message: `入力を確認してください。\n${reasons.join('\n')}` })
          }
        } finally {
          pendingApprovals.delete(surfaceId)
          sendA2ui(removeApprovalForm(surfaceId))
        }
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

async function readJson<T>(request: IncomingMessage): Promise<T> {
  let body = ''
  for await (const chunk of request) body += chunk
  return JSON.parse(body) as T
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === 'POST' && request.url === '/api/chat') {
      const body = await readJson<ChatRequest>(request)
      if (typeof body.conversationId !== 'string' || (typeof body.message !== 'string' && typeof body.action?.name !== 'string')) throw new Error('bad request')
      await chat(body, response)
    } else if (request.method === 'POST' && request.url === '/api/approval') {
      // 待っている canUseTool に回答を渡す。応答の続きは、開いたままの /api/chat の SSE に流れる。
      const body = await readJson<ApprovalRequest>(request)
      const resolve = pendingApprovals.get(body.surfaceId)
      if (!resolve) throw new Error('bad request')
      resolve(body)
      response.writeHead(204).end()
    } else if (request.method === 'POST' && request.url === '/api/options') {
      // フォームの選択欄が、選択肢を 1 ページ取りに来る。エージェント層に頼む(agent/options.ts)。
      const body = await readJson<{ tool: string; args?: Record<string, unknown> }>(request)
      const started = Date.now()
      const page = await fetchOptions(body.tool, body.args ?? {})
      if (process.env.LOG_RAW) console.log(`\n[options] ${body.tool} ${JSON.stringify(body.args)} (${Date.now() - started}ms)`)
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(page))
    } else {
      response.writeHead(404).end()
    }
  } catch (error) {
    if (!response.headersSent) response.writeHead(400, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
  }
})

const port = Number(process.env.PORT ?? 8787)
server.listen(port, '127.0.0.1', () => console.log(`a2ui-chat server: http://127.0.0.1:${port}`))
