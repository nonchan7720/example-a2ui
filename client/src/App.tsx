import { renderMarkdown } from '@a2ui/markdown-it'
import { A2uiSurface, MarkdownContext, type ReactCatalogComponent } from '@a2ui/react'
import { type ActionPayload, MessageProcessor, type SurfaceModel } from '@a2ui/web_core'
import { injectBasicCatalogStyles } from '@a2ui/web_core/catalogs/basic/v1'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { type Input, type Part, sendApproval, sendMessage } from './api.ts'
import { catalog } from './catalog/index.ts'

injectBasicCatalogStyles()

type Surface = SurfaceModel<ReactCatalogComponent>
type ChatMessage = { role: 'user' | 'assistant' | 'action' | 'tool' | 'error'; text: string }

export function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [surfaces, setSurfaces] = useState<Surface[]>([])
  const [busy, setBusy] = useState(false)
  const [input, setInput] = useState('')

  // 1 ターン: 発言か UI の操作を送り、届いた part を順に処理する。
  async function send(input: Input) {
    if (busy) return
    setBusy(true)
    const shown: ChatMessage =
      'message' in input ? { role: 'user', text: input.message } : { role: 'action', text: `▶ ${input.action.name} ${JSON.stringify(input.action.context)}` }
    setMessages((list) => [...list, shown, { role: 'assistant', text: '' }])
    const onPart = (part: Part) => {
      if (part.type === 'a2ui') {
        // A2UI のメッセージは MessageProcessor に渡すだけ。surface の生成や更新はここで起きる。
        processor.current?.processMessages(part.a2ui as Parameters<MessageProcessor['processMessages']>[0])
      } else if (part.type === 'text') {
        // text は最後のアシスタント発言に足していく。
        setMessages((list) => {
          const last = list[list.length - 1]
          return [...list.slice(0, -1), { ...last, text: last.text + part.text }]
        })
      } else if (part.type === 'tool') {
        // Claude が呼んだツール(MCP)を、チャットに 1 行で出す。
        setMessages((list) => [
          ...list,
          { role: 'tool', text: `🔧 ${part.name.replace(/^mcp__/, '')} ${JSON.stringify(part.input)}` },
          { role: 'assistant', text: '' },
        ])
      } else {
        setMessages((list) => [...list, { role: 'error', text: part.message }, { role: 'assistant', text: '' }])
      }
    }
    try {
      await sendMessage(input, onPart)
    } catch (error) {
      setMessages((list) => [...list, { role: 'error', text: String(error) }])
    }
    setBusy(false)
  }

  // ボタンなどの操作は、次の入力としてサーバーへ送る(サーバーがユーザーメッセージにして Claude に渡す)。
  const onAction = useRef<(action: ActionPayload) => void>(() => {})
  onAction.current = ({ name, surfaceId, context }) => {
    if (name === 'tool_approve' || name === 'tool_deny') {
      // ツール実行前の承認フォーム(server/src/approval.ts)への回答。新しいターンではなく、待っているターンに返す。
      const approved = name === 'tool_approve'
      setMessages((list) => [
        ...list,
        { role: 'action', text: approved ? `▶ 承認 ${JSON.stringify(context.input)}` : '▶ キャンセル' },
        { role: 'assistant', text: '' },
      ])
      void sendApproval(surfaceId, approved, context.input)
    } else {
      void send({ action: { name, surfaceId, context } })
    }
  }

  // MessageProcessor は 1 つだけ作り、surface の増減を画面の state に写す。
  const processor = useRef<MessageProcessor<ReactCatalogComponent> | null>(null)
  useEffect(() => {
    const p = new MessageProcessor<ReactCatalogComponent>([catalog], (action) => onAction.current(action))
    processor.current = p
    const sync = () => setSurfaces([...p.model.surfacesMap.values()])
    const created = p.onSurfaceCreated(sync)
    const deleted = p.onSurfaceDeleted(sync)
    return () => {
      created.unsubscribe()
      deleted.unsubscribe()
      p.dispose()
      processor.current = null
    }
  }, [])

  // 新しい surface(承認フォームなど)が出たら、見える位置までスクロールする。
  const surfaceList = useRef<HTMLElement>(null)
  const surfaceCount = surfaces.length
  useEffect(() => {
    if (surfaceCount > 0) surfaceList.current?.querySelector('.surface:last-of-type')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [surfaceCount])

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!input.trim()) return
    void send({ message: input.trim() })
    setInput('')
  }

  return (
    <main>
      <section className="chat">
        <h1>チャット</h1>
        <ol>
          {messages
            .filter((message) => message.text.trim())
            .map((message, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: 追記しかしないリストなので index で足りる
              <li key={index} className={message.role}>
                {message.text.trim()}
              </li>
            ))}
          {busy && <li className="busy">応答を待っています…</li>}
        </ol>
        <form onSubmit={onSubmit}>
          <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="メッセージを入力" aria-label="メッセージ" />
          <button type="submit" disabled={busy}>
            送信
          </button>
        </form>
      </section>
      <section className="surfaces" ref={surfaceList}>
        <h1>A2UI</h1>
        <MarkdownContext.Provider value={renderMarkdown}>
          {surfaces.map((surface) => (
            <div key={surface.id} className="surface" data-surface-id={surface.id}>
              <A2uiSurface surface={surface} />
            </div>
          ))}
        </MarkdownContext.Provider>
        {surfaces.length === 0 && <p className="empty">Claude が返した UI がここに表示されます。</p>}
      </section>
    </main>
  )
}
