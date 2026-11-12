import { renderMarkdown } from '@a2ui/markdown-it'
import { A2uiSurface, MarkdownContext, type ReactCatalogComponent } from '@a2ui/react'
import { type ActionPayload, MessageProcessor, type SurfaceModel } from '@a2ui/web_core'
import { injectBasicCatalogStyles } from '@a2ui/web_core/catalogs/basic/v1'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { type Part, sendMessage } from './api.ts'
import { catalog } from './catalog/index.ts'

injectBasicCatalogStyles()

type Surface = SurfaceModel<ReactCatalogComponent>
type ChatMessage = { role: 'user' | 'assistant' | 'action' | 'error'; text: string }

export function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [surfaces, setSurfaces] = useState<Surface[]>([])
  const [busy, setBusy] = useState(false)
  const [input, setInput] = useState('')

  // 1 ターン: メッセージを送り、届いた part を順に処理する。
  async function send(text: string, role: 'user' | 'action' = 'user') {
    if (busy) return
    setBusy(true)
    setMessages((list) => [...list, { role, text }, { role: 'assistant', text: '' }])
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
      } else {
        setMessages((list) => [...list, { role: 'error', text: part.message }, { role: 'assistant', text: '' }])
      }
    }
    try {
      await sendMessage(text, onPart)
    } catch (error) {
      setMessages((list) => [...list, { role: 'error', text: String(error) }])
    }
    setBusy(false)
  }

  // ボタンなどの操作は、次のユーザーメッセージとして Claude に戻す。
  const onAction = useRef<(action: ActionPayload) => void>(() => {})
  onAction.current = ({ name, surfaceId, context }) => {
    void send(`[a2ui action] ${JSON.stringify({ name, surfaceId, context })}`, 'action')
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

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!input.trim()) return
    void send(input.trim())
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
      <section className="surfaces">
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
