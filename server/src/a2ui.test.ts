import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createProcessor, openA2uiStream, type WirePart } from './a2ui.ts'
import { DOCUMENT_CATALOG_ID } from './document-catalog.ts'

/** 文字列を小さな chunk に割って流し、返ってきた part を集める。 */
function run(response: string, chunkSize = 7, state = createProcessor().createState(), processor = createProcessor()): WirePart[] {
  const stream = openA2uiStream(processor, state)
  const parts: WirePart[] = []
  for (let i = 0; i < response.length; i += chunkSize) parts.push(...stream.feed(response.slice(i, i + chunkSize)))
  parts.push(...stream.close())
  return parts
}

test('正しい A2UI Express は a2ui の part になる', () => {
  const parts = run('フォームです。\n<a2ui>\nsurface("s1")\nroot = Column([Text("こんにちは"), Button(Text("送信"), action=Event("submit"))])\n</a2ui>')
  assert.deepEqual(
    parts.map((p) => p.type).filter((t) => t !== 'text'),
    parts.filter((p) => p.type === 'a2ui').map(() => 'a2ui'),
    'error の part は無い',
  )
  const messages = parts.flatMap((p) => (p.type === 'a2ui' ? p.a2ui : []))
  assert.ok(messages.length > 0)
  assert.match(JSON.stringify(messages), /createSurface/)
})

test('壊れた DSL は error の part になり、後ろの text は読み続ける', () => {
  const parts = run('前の文。\n<a2ui>\nroot = Column([Text("閉じていない"\n</a2ui>\n後ろの文。')
  const errors = parts.filter((p) => p.type === 'error')
  assert.equal(errors.length, 1)
  assert.match(errors[0].message, /Syntax error/)
  // ストリームは読めた行から順に送るので、拒否される前の createSurface は先に届いていてよい。
  // 壊れた行のコンポーネントは届かない。
  assert.doesNotMatch(JSON.stringify(parts.filter((p) => p.type === 'a2ui')), /閉じていない/)
  const text = parts.flatMap((p) => (p.type === 'text' ? [p.text] : [])).join('')
  assert.match(text, /前の文。/)
  assert.match(text, /後ろの文。/)
})

test('カタログに無いコンポーネントは error の part になる', () => {
  const parts = run('<a2ui>\nroot = NoSuchComponent("x")\n</a2ui>')
  assert.equal(parts.filter((p) => p.type === 'error').length, 1)
  assert.equal(parts.filter((p) => p.type === 'a2ui').length, 0)
})

test('閉じタグが無いまま終わった応答は close() で error の part になる', () => {
  const parts = run('<a2ui>\nroot = Text("途中で切れ')
  assert.equal(parts.at(-1)?.type, 'error')
})

test('state を使い回すと、次のターンで既存の surface を update=true で書き換えられる', () => {
  const state = createProcessor().createState()
  const first = run('<a2ui>\nsurface("form")\nroot = Text("入力フォーム")\n</a2ui>', 7, state)
  assert.equal(first.filter((p) => p.type === 'error').length, 0)

  const updated = run('<a2ui>\nsurface("form", update=true)\nroot = Text("受け付けました")\n</a2ui>', 7, state)
  assert.equal(updated.filter((p) => p.type === 'error').length, 0)
  assert.match(JSON.stringify(updated), /updateComponents/)

  // update=true を付けずに同じ ID を使うと createSurface になり、拒否される。
  const recreated = run('<a2ui>\nsurface("form")\nroot = Text("もう一度")\n</a2ui>', 7, state)
  assert.match(recreated.find((p) => p.type === 'error')?.message ?? '', /already exists/)
})

test('資料表示のカタログでは Table などを書ける。基本カタログだけのクライアントには拒否される', () => {
  const response = '<a2ui>\nsurface("sales")\nroot = Table("売上", ["月", "売上"], [["4月", 100], ["5月", 120]])\n</a2ui>'

  const documents = createProcessor({ '1.0': { supportedCatalogIds: [DOCUMENT_CATALOG_ID] } })
  const accepted = run(response, 7, documents.createState(), documents)
  assert.equal(accepted.filter((p) => p.type === 'error').length, 0)
  assert.match(JSON.stringify(accepted), /"component":"Table"/)

  const rejected = run(response)
  assert.equal(rejected.filter((p) => p.type === 'error').length, 1)
})
