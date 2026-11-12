import assert from 'node:assert/strict'
import { test } from 'node:test'
import { z } from 'zod'
import { createProcessor } from './a2ui.ts'
import { approvalForm, coerce, describeIssue, removeApprovalForm, type Schema } from './approval.ts'
import { DOCUMENT_CATALOG_ID } from './document-catalog.ts'
import { APPROVAL_SCHEMAS, CREATE_TOOL } from './reservation-mcp.ts'

const tool = APPROVAL_SCHEMAS[CREATE_TOOL]
const schema = z.toJSONSchema(tool) as Schema
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
  assert.match(text, /"component":"TextField","label":"日付","value":\{"@path":"\/input\/date"\}/)
  // enum は選択肢になり、値ではなく表示名が出る。データモデルでは選んだ値を配列で持つ。
  assert.match(text, /"component":"ChoicePicker","label":"店",.*\{"value":"kamoshiki","label":"鴨四季/)
  assert.match(text, /"dataModel":\{"input":\{"restaurantId":\["kamoshiki"\]/)
  // 未指定の任意項目(ご要望)は空文字で入る。
  assert.match(text, /"notes":""\}\}/)
  // 範囲や必須はフォーム上のチェックになり、承認ボタンにも同じチェックが付く。
  assert.match(text, /"label":"人数",.*"@call":"numeric","args":\{"value":\{"@path":"\/input\/partySize"\},"min":1,"max":20\}/)
  assert.match(text, /"id":"approve",.*"checks":\[/)
  // ネストした項目は、親の見出しの下に入る。
  assert.match(text, /"text":"\*\*連絡先\*\*"/)
  assert.match(text, /"label":"お名前","value":\{"@path":"\/input\/contact\/name"\}/)
  // 明細は表入力になる。
  assert.match(text, /"component":"LineItems","label":"コースの事前注文","columns":\[\{"key":"course","label":"コース","type":"select","options":\[/)
  assert.match(text, /\{"key":"quantity","label":"数量","type":"number"\}\]/)

  state.apply(removeApprovalForm('approval_1'))
})

test('フォームから返った値は、ネストや明細の中までスキーマの型に合わせられる', () => {
  const edited = {
    ...input,
    restaurantId: ['kamoshiki'],
    time: ['19:00'],
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

test('直された値が正しくなければ、どこが違うかをフォームのラベルで言える', () => {
  const edited = { ...input, partySize: 0, courses: [input.courses[0], { course: 'おまかせ 15,000円', quantity: 0 }] }
  const checked = tool.safeParse(coerce(schema, edited))
  assert.equal(checked.success, false)
  const reasons = checked.error?.issues.map((issue) => describeIssue(schema, issue.path, issue.message)) ?? []
  assert.equal(reasons.length, 2)
  assert.match(reasons[0], /^人数: /)
  assert.match(reasons[1], /^コースの事前注文 2 行目 数量: /)
})
