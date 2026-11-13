// 選択肢をツールから取る選択欄。開くと 1 ページ目を取り、検索すると取り直し、下までスクロールすると続きを取る。
// 持つ値は選んだ項目の ID。表示名は、ID を指定してツールに問い合わせて引く。
import { useEffect, useRef, useState } from 'react'
import { fetchOptions, type OptionPage } from '../api.ts'

export type OptionSource = { tool: string; params?: Record<string, string> }

const PAGE_SIZE = 10

/** source.params に従って、フォームの今の値からツールの引数を作る。ChoicePicker の値は配列なので、先頭を取る。 */
export function sourceArgs(source: OptionSource, context: unknown): Record<string, unknown> {
  const values = (context ?? {}) as Record<string, unknown>
  return Object.fromEntries(Object.entries(source.params ?? {}).map(([argument, key]) => [argument, Array.isArray(values[key]) ? values[key][0] : values[key]]))
}

/** ID から表示名を引く。同じ瞬間に頼まれた ID は、1 回の問い合わせにまとめる(明細の各行が同時に頼むため)。 */
const names = new Map<string, Promise<string | undefined>>()
let waiting: { tool: string; args: Record<string, unknown>; ids: string[]; resolve: (page: OptionPage) => void }[] = []
function lookupName(tool: string, args: Record<string, unknown>, id: string): Promise<string | undefined> {
  const key = JSON.stringify([tool, args, id])
  let name = names.get(key)
  if (!name) {
    name = new Promise<OptionPage>((resolve) => {
      const group = JSON.stringify([tool, args])
      let batch = waiting.find((candidate) => JSON.stringify([candidate.tool, candidate.args]) === group)
      if (!batch) {
        const created = { tool, args, ids: [] as string[], resolve: (_page: OptionPage) => {} }
        batch = created
        waiting.push(created)
        setTimeout(() => {
          waiting = waiting.filter((candidate) => candidate !== created)
          fetchOptions(tool, { ...args, ids: created.ids, limit: 50 }).then(created.resolve, () => created.resolve({ items: [] }))
        })
      }
      batch.ids.push(id)
      const previous = batch.resolve
      batch.resolve = (page) => {
        previous(page)
        resolve(page)
      }
    }).then((page) => page.items.find((item) => item.id === id)?.name)
    names.set(key, name)
  }
  return name
}

export function RemoteSelect(props: { label: string; source: OptionSource; context: unknown; value: string; onChange: (id: string) => void }) {
  const { label, source, value, onChange } = props
  const args = sourceArgs(source, props.context)
  const argsKey = JSON.stringify(args)

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<OptionPage['items']>([])
  const [nextCursor, setNextCursor] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [name, setName] = useState<string>()
  // 引数や検索語が変わった後に届いた古い結果を捨てるための番号。
  const generation = useRef(0)

  // 選ばれている ID の表示名を引く。
  useEffect(() => {
    let current = true
    setName(undefined)
    if (value) lookupName(source.tool, JSON.parse(argsKey), value).then((found) => current && setName(found ?? `${value}(選択肢にありません)`))
    return () => {
      current = false
    }
  }, [source.tool, argsKey, value])

  const load = async (cursor: string | undefined, search: string) => {
    const mine = ++generation.current
    setLoading(true)
    setError('')
    try {
      const page = await fetchOptions(source.tool, { ...args, query: search || undefined, cursor, limit: PAGE_SIZE })
      if (mine !== generation.current) return
      setItems((list) => (cursor ? [...list, ...page.items] : page.items))
      setNextCursor(page.nextCursor)
    } catch (failure) {
      if (mine === generation.current) setError(String(failure))
    }
    if (mine === generation.current) setLoading(false)
  }

  // 開いたとき、検索語が変わったとき、引数(たとえば店)が変わったときに、1 ページ目から取り直す。検索は入力が止まってから。
  // biome-ignore lint/correctness/useExhaustiveDependencies: load は毎回作り直されるが、取り直すきっかけは下の 3 つだけ
  useEffect(() => {
    if (!open) return
    setItems([])
    setNextCursor(undefined)
    const timer = setTimeout(() => load(undefined, query), query ? 500 : 0)
    return () => clearTimeout(timer)
  }, [open, query, argsKey])

  return (
    <div className="remote-select">
      <button type="button" className="remote-select-value" aria-label={label} aria-expanded={open} onClick={() => setOpen(!open)}>
        {value ? (name ?? '読み込み中…') : '選択してください'}
      </button>
      {open && (
        <div className="remote-select-popup">
          <input aria-label={`${label}を検索`} placeholder="検索" value={query} onChange={(event) => setQuery(event.target.value)} />
          <ul
            aria-label={`${label}の選択肢`}
            onScroll={(event) => {
              // 下端まで来たら、続きの 1 ページを取る。
              const list = event.currentTarget
              if (nextCursor && !loading && list.scrollTop + list.clientHeight >= list.scrollHeight - 8) load(nextCursor, query)
            }}
          >
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  aria-pressed={item.id === value}
                  onClick={() => {
                    names.set(JSON.stringify([source.tool, args, item.id]), Promise.resolve(item.name))
                    onChange(item.id)
                    setOpen(false)
                  }}
                >
                  {item.name}
                </button>
              </li>
            ))}
            {loading && <li className="remote-select-note">読み込み中…</li>}
            {error && <li className="remote-select-note">{error}</li>}
            {!loading && !error && items.length === 0 && <li className="remote-select-note">見つかりません</li>}
          </ul>
        </div>
      )}
    </div>
  )
}
