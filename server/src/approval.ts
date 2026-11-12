// ツール実行前の承認フォーム。
// Claude がツールに渡そうとした入力を初期値にしたフォーム(A2UI)を、ツールの入力スキーマ(JSON Schema)から組み立てる。
// ユーザーは値を直してから承認でき、直した値がそのままツールの入力になる。
//
//   文字列・数値       → TextField     真偽値             → CheckBox
//   オブジェクト(ネスト) → 見出し付きのグループ   オブジェクトの配列(明細) → LineItems(行を追加・削除できる表)
//
// ラベルにはスキーマの title を使う(無ければ引数名)。フォームの題も、スキーマの title(無ければツール名)。
type Schema = {
  type?: string
  title?: string
  properties?: Record<string, Schema>
  required?: string[]
  items?: Schema
}
type Component = { id: string; component: string; [property: string]: unknown }

const isNumber = (schema: Schema) => schema.type === 'number' || schema.type === 'integer'

/** 承認フォームを作る A2UI のメッセージ。 */
export function approvalForm(surfaceId: string, catalogId: string, toolName: string, schema: Schema, input: Record<string, unknown>): unknown[] {
  const components: Component[] = []

  /** スキーマの 1 項目をコンポーネントにし、その ID を返す。path はデータモデルの中の場所。 */
  const build = (schema: Schema, path: string[], label: string): string => {
    const id = `f_${path.join('_')}`
    const value = { '@path': `/${path.join('/')}` }
    if (schema.type === 'object') {
      const children = Object.entries(schema.properties ?? {}).map(([key, child]) => build(child, [...path, key], child.title ?? key))
      components.push({ id: `${id}_title`, component: 'Text', text: `**${label}**` }, { id, component: 'Column', children: [`${id}_title`, ...children] })
    } else if (schema.type === 'array' && schema.items?.type === 'object') {
      const columns = Object.entries(schema.items.properties ?? {}).map(([key, column]) => ({
        key,
        label: column.title ?? key,
        type: isNumber(column) ? 'number' : 'text',
      }))
      components.push({ id, component: 'LineItems', label, columns, value })
    } else if (schema.type === 'boolean') {
      components.push({ id, component: 'CheckBox', label, value })
    } else {
      components.push({ id, component: 'TextField', label, value, variant: isNumber(schema) ? 'number' : 'shortText' })
    }
    return id
  }

  const fields = Object.entries(schema.properties ?? {}).map(([key, child]) => build(child, ['input', key], child.title ?? key))
  components.push(
    { id: 'root', component: 'Card', child: 'body' },
    { id: 'body', component: 'Column', children: ['title', 'note', ...fields, 'buttons'] },
    { id: 'title', component: 'Text', text: `## 「${schema.title ?? toolName}」を実行しますか?` },
    { id: 'note', component: 'Text', variant: 'caption', text: '内容を確認し、必要なら直してから承認してください。' },
    { id: 'buttons', component: 'Row', justify: 'end', children: ['deny', 'approve'] },
    { id: 'deny', component: 'Button', child: 'deny_label', variant: 'default', action: { event: { name: 'tool_deny', context: {} } } },
    { id: 'deny_label', component: 'Text', text: 'キャンセル' },
    // 押した時点のフォームの値(データモデルの /input 全体)が context.input に入って返ってくる。
    {
      id: 'approve',
      component: 'Button',
      child: 'approve_label',
      variant: 'primary',
      action: { event: { name: 'tool_approve', context: { input: { '@path': '/input' } } } },
    },
    { id: 'approve_label', component: 'Text', text: '承認して実行' },
  )
  return [{ version: '1.0', createSurface: { surfaceId, catalogId, components, dataModel: { input } } }]
}

export function removeApprovalForm(surfaceId: string): unknown[] {
  return [{ version: '1.0', deleteSurface: { surfaceId } }]
}

/**
 * フォームから返ってきた値を、スキーマの型に合わせる(数値の欄は文字列で返ることがある)。
 * 空のまま残された任意の項目は、入力から外す。
 */
export function coerce(schema: Schema, value: unknown): unknown {
  if (schema.type === 'object') {
    const source = (value ?? {}) as Record<string, unknown>
    const result: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      const empty = source[key] === undefined || source[key] === null || source[key] === ''
      if (empty && !schema.required?.includes(key)) continue
      result[key] = coerce(child, source[key])
    }
    return result
  }
  if (schema.type === 'array') return (Array.isArray(value) ? value : []).map((item) => coerce(schema.items ?? {}, item))
  if (isNumber(schema)) return Number(value)
  if (schema.type === 'boolean') return Boolean(value)
  if (schema.type === 'string') return String(value ?? '')
  return value
}
