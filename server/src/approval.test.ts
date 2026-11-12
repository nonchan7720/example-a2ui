import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createProcessor } from './a2ui.ts'
import { approvalForm, coerce, removeApprovalForm } from './approval.ts'
import { DOCUMENT_CATALOG_ID } from './document-catalog.ts'
import { APPROVAL_SCHEMAS, CREATE_TOOL } from './reservation-mcp.ts'

const schema = APPROVAL_SCHEMAS[CREATE_TOOL] as Parameters<typeof approvalForm>[3]
const input = {
  restaurantId: 'kamoshiki',
  date: '2026-11-20',
  time: '19:00',
  partySize: 4,
  contact: { name: '山田 太郎', phone: '090-1234-5678' },
  courses: [{ course: 'おまかせ 15,000円', quantity: 4 }],
}

test('承認フォームは、ラベル・ネストした項目・明細の表を持ち、レンダラーの state に受け入れられる', () => {
  const processor = createProcessor({ '1.0': { supportedCatalogIds: [DOCUMENT_CATALOG_ID] } })
  const state = processor.createState()
  const form = approvalForm('approval_1', DOCUMENT_CATALOG_ID, CREATE_TOOL, schema, input)
  state.apply(form)

  const text = JSON.stringify(form)
  // 引数名ではなく、スキーマの title がラベルになる。
  assert.match(text, /"component":"TextField","label":"店","value":\{"@path":"\/input\/restaurantId"\}/)
  // ネストした項目は、親の見出しの下に入る。
  assert.match(text, /"text":"\*\*連絡先\*\*"/)
  assert.match(text, /"label":"お名前","value":\{"@path":"\/input\/contact\/name"\}/)
  // 明細は表入力になる。
  assert.match(
    text,
    /"component":"LineItems","label":"コースの事前注文","columns":\[\{"key":"course","label":"コース","type":"text"\},\{"key":"quantity","label":"数量","type":"number"\}\]/,
  )

  state.apply(removeApprovalForm('approval_1'))
})

test('フォームから返った値は、ネストや明細の中までスキーマの型に合わせられる', () => {
  const edited = {
    ...input,
    partySize: '5',
    contact: { name: '山田 花子', phone: '090-1234-5678' },
    courses: [
      { course: 'おまかせ 15,000円', quantity: '3' },
      { course: '鴨鍋コース 9,800円', quantity: '2' },
    ],
    notes: '',
    unknown: 'x',
  }
  assert.deepEqual(coerce(schema, edited), {
    restaurantId: 'kamoshiki',
    date: '2026-11-20',
    time: '19:00',
    partySize: 5,
    contact: { name: '山田 花子', phone: '090-1234-5678' },
    courses: [
      { course: 'おまかせ 15,000円', quantity: 3 },
      { course: '鴨鍋コース 9,800円', quantity: 2 },
    ],
  })
})
