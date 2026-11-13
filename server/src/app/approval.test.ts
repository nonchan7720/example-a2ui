import assert from 'node:assert/strict'
import { test } from 'node:test'
import { z } from 'zod'
import { APPROVALS, CREATE_TOOL } from '../mcp/reservation-mcp.ts'
import { createProcessor } from './a2ui.ts'
import { approvalForm, coerce, describeIssue, removeApprovalForm, type Schema } from './approval.ts'
import { DOCUMENT_CATALOG_ID } from './document-catalog.ts'

const { schema: tool, check } = APPROVALS[CREATE_TOOL]
const schema = z.toJSONSchema(tool) as Schema
const input = {
  restaurantId: 'kamoshiki',
  date: '2026-11-20',
  time: '19:00',
  partySize: 4,
  contact: { name: '山田 太郎', phone: '090-1234-5678' },
  items: [{ menuItemId: 'kamoshiki-01', quantity: 4 }],
}

test('承認フォームは、ラベル・選択肢・入力チェック・ネストした項目・明細の表を持ち、レンダラーの state に受け入れられる', () => {
  const processor = createProcessor({ '1.0': { supportedCatalogIds: [DOCUMENT_CATALOG_ID] } })
  const state = processor.createState()
  const form = approvalForm('approval_1', DOCUMENT_CATALOG_ID, CREATE_TOOL, schema, input)
  state.apply(form)

  const text = JSON.stringify(form)
  // 引数名ではなく、スキーマの title がラベルになる。
  assert.match(text, /"component":"TextField","label":"日付","value":\{"@path":"\/input\/date"\}/)
  // enum は、その場で選ぶ選択肢になる。データモデルでは選んだ値を配列で持つ。
  assert.match(text, /"component":"ChoicePicker","label":"時間",.*\{"value":"19:00","label":"19:00"\}/)
  assert.match(text, /"time":\["19:00"\]/)
  // optionsFrom は、別のツールから選択肢を取る欄になる。選択肢そのものはフォームに入らない。
  assert.match(text, /"component":"Lookup","label":"店","source":\{"tool":"list_restaurants"\},"value":\{"@path":"\/input\/restaurantId"\}/)
  // 未指定の任意項目(ご要望)は空文字で入る。
  assert.match(text, /"notes":""\}\}/)
  // 範囲や必須はフォーム上のチェックになり、承認ボタンにも同じチェックが付く。
  assert.match(text, /"label":"人数",.*"@call":"numeric","args":\{"value":\{"@path":"\/input\/partySize"\},"min":1,"max":20\}/)
  assert.match(text, /"id":"approve",.*"checks":\[/)
  // ネストした項目は、親の見出しの下に入る。
  assert.match(text, /"text":"\*\*連絡先\*\*"/)
  assert.match(text, /"label":"お名前","value":\{"@path":"\/input\/contact\/name"\}/)
  // 明細は表入力になる。メニューの列は、選ばれている店を引数にしてツールから選択肢を取る。
  assert.match(
    text,
    /"component":"LineItems","label":"事前注文","columns":\[\{"key":"menuItemId","label":"メニュー","type":"lookup","source":\{"tool":"list_menu_items","params":\{"restaurantId":"restaurantId"\}\}\},\{"key":"quantity","label":"数量","type":"number"\}\]/,
  )

  state.apply(removeApprovalForm('approval_1'))
})

test('フォームから返った値は、ネストや明細の中までスキーマの型に合わせられる', () => {
  const edited = {
    ...input,
    time: ['19:30'],
    partySize: '5',
    contact: { name: '山田 花子', phone: '090-1234-5678' },
    items: [
      { menuItemId: 'kamoshiki-01', quantity: '3' },
      { menuItemId: 'kamoshiki-12', quantity: '2' },
    ],
    notes: '',
    unknown: 'x',
  }
  assert.deepEqual(coerce(schema, edited), {
    restaurantId: 'kamoshiki',
    date: '2026-11-20',
    time: '19:30',
    partySize: 5,
    contact: { name: '山田 花子', phone: '090-1234-5678' },
    items: [
      { menuItemId: 'kamoshiki-01', quantity: 3 },
      { menuItemId: 'kamoshiki-12', quantity: 2 },
    ],
  })
})

test('直された値が正しくなければ、どこが違うかをフォームのラベルで言える', () => {
  // スキーマで分かる誤り(範囲)。
  const outOfRange = tool.safeParse(coerce(schema, { ...input, partySize: 0, items: [input.items[0], { menuItemId: 'kamoshiki-02', quantity: 0 }] }))
  assert.deepEqual(
    outOfRange.error?.issues.map((issue) => describeIssue(schema, issue.path, issue.message).replace(/: .*/, '')),
    ['人数', '事前注文 2 行目 数量'],
  )
  // データに照らして分かる誤り(店に無いメニュー)。
  const problems = check?.({ ...input, items: [input.items[0], { menuItemId: 'hanakago-01', quantity: 1 }] }) ?? []
  assert.deepEqual(
    problems.map((problem) => describeIssue(schema, problem.path, problem.message)),
    ['事前注文 2 行目 メニュー: 鴨四季 のメニューにありません'],
  )
})
