import assert from 'node:assert/strict'
import { test } from 'node:test'
import { z } from 'zod'
import { Approvals } from './approval-gate.ts'

const gate = { confirmTool: 'confirm', gatedTool: 'mcp__app__save', schema: z.object({ name: z.string(), size: z.number() }) }
const call = (approvals: Approvals, thread: string, tool = gate.gatedTool) =>
  approvals.canUseTool(thread)(tool, { name: 'Claude が書いた値', size: 99 }, { signal: new AbortController().signal, toolUseID: 't' } as never)

test('承認が無ければ断る', async () => {
  const result = await call(new Approvals(gate), 'a')
  assert.equal(result?.behavior, 'deny')
})

test('承認された値に入力を差し替えて許可し、承認は 1 回で使い切る', async () => {
  const approvals = new Approvals(gate)
  approvals.record('a', 'confirm', JSON.stringify({ approved: true, name: '山田', size: 3, extra: '捨てられる' }))
  assert.deepEqual(await call(approvals, 'a'), { behavior: 'allow', updatedInput: { name: '山田', size: 3 } })
  assert.equal((await call(approvals, 'a'))?.behavior, 'deny')
})

test('承認は別のスレッドには効かない', async () => {
  const approvals = new Approvals(gate)
  approvals.record('a', 'confirm', JSON.stringify({ approved: true, name: '山田', size: 3 }))
  assert.equal((await call(approvals, 'b'))?.behavior, 'deny')
})

test('キャンセル・形の違う値・別のツールの結果は承認にならない', async () => {
  const approvals = new Approvals(gate)
  approvals.record('a', 'confirm', JSON.stringify({ approved: false }))
  approvals.record('b', 'confirm', JSON.stringify({ approved: true, name: '山田' }))
  approvals.record('c', 'other', JSON.stringify({ approved: true, name: '山田', size: 3 }))
  approvals.record('d', 'confirm', 'not json')
  for (const thread of ['a', 'b', 'c', 'd']) assert.equal((await call(approvals, thread))?.behavior, 'deny')
})

test('あとからキャンセルされたら、前の承認も取り消す', async () => {
  const approvals = new Approvals(gate)
  approvals.record('a', 'confirm', JSON.stringify({ approved: true, name: '山田', size: 3 }))
  approvals.record('a', 'confirm', JSON.stringify({ approved: false }))
  assert.equal((await call(approvals, 'a'))?.behavior, 'deny')
})

test('テキストのブロックの配列や { content } の形の結果も読める', async () => {
  const approvals = new Approvals(gate)
  const text = JSON.stringify({ approved: true, name: '山田', size: 3 })
  approvals.record('a', 'confirm', [{ type: 'text', text }])
  approvals.record('b', 'confirm', { content: text })
  for (const thread of ['a', 'b']) assert.equal((await call(approvals, thread))?.behavior, 'allow')
})

test('承認が要るツール以外は断る', async () => {
  assert.equal((await call(new Approvals(gate), 'a', 'Bash'))?.behavior, 'deny')
})
