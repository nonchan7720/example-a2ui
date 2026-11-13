// ツール実行前の承認フォーム。
// Claude がツールに渡そうとした入力を初期値にしたフォーム(A2UI)を、ツールの入力スキーマ(JSON Schema)から組み立てる。
// ユーザーは値を直してから承認でき、直した値がそのままツールの入力になる。
//
//   文字列・数値         → TextField          真偽値               → CheckBox
//   enum               → ChoicePicker(選択肢) オブジェクト(ネスト)   → 見出し付きのグループ
//   optionsFrom        → Lookup(別のツールから選択肢を取る。検索と、スクロールでの続きの読み込みができる)
//   オブジェクトの配列(明細) → LineItems(行を追加・削除できる表。enum や optionsFrom の列は選択肢)
//
// ラベルにはスキーマの title を使う(無ければ引数名)。enum の選択肢の表示名は labels(値 → 表示名)。
// 必須・文字数・数値の範囲は、フォーム上のチェックになる。チェックに通らない間は承認ボタンを押せない。
export type Schema = {
  type?: string
  title?: string
  properties?: Record<string, Schema>
  required?: string[]
  items?: Schema
  enum?: string[]
  labels?: Record<string, string>
  /** 選択肢を返すツールと、その引数に渡すフォームの項目(引数名 → /input 直下の項目名)。 */
  optionsFrom?: { tool: string; params?: Record<string, string> }
  minLength?: number
  maxLength?: number
  minimum?: number
  maximum?: number
}
type Component = { id: string; component: string; [property: string]: unknown }
type Check = { condition: { '@call': string; args: Record<string, unknown> }; message: string }

const isNumber = (schema: Schema) => schema.type === 'number' || schema.type === 'integer'
const options = (schema: Schema) => (schema.enum ?? []).map((value) => ({ value, label: schema.labels?.[value] ?? value }))
/** zod は上限の無い整数に Number.MAX_SAFE_INTEGER を出すので、それは上限として扱わない。 */
const bound = (value: number | undefined) => (value !== undefined && Math.abs(value) < Number.MAX_SAFE_INTEGER ? value : undefined)

/** 1 項目のスキーマから、フォーム上のチェックを作る。 */
function checksFor(schema: Schema, label: string, value: unknown, required: boolean): Check[] {
  const checks: Check[] = []
  const [min, max] = [bound(schema.minimum), bound(schema.maximum)]
  if (isNumber(schema)) {
    if (required) checks.push({ condition: { '@call': 'required', args: { value } }, message: `${label}を入力してください` })
    if (min !== undefined || max !== undefined) {
      const range = `${min ?? ''}〜${max ?? ''}`
      checks.push({ condition: { '@call': 'numeric', args: { value, min, max } }, message: `${label}は ${range} の範囲で入力してください` })
    }
  } else if (schema.type === 'string') {
    if (required || (schema.minLength ?? 0) > 0) checks.push({ condition: { '@call': 'required', args: { value } }, message: `${label}を入力してください` })
    const minLength = (schema.minLength ?? 0) > 1 ? schema.minLength : undefined
    if (minLength !== undefined || schema.maxLength !== undefined) {
      const range = `${minLength ?? ''}〜${schema.maxLength ?? ''}`
      checks.push({
        condition: { '@call': 'length', args: { value, min: minLength, max: schema.maxLength } },
        message: `${label}は ${range} 文字で入力してください`,
      })
    }
  }
  return checks
}

/** 承認フォームを作る A2UI のメッセージ。 */
export function approvalForm(surfaceId: string, catalogId: string, toolName: string, schema: Schema, input: Record<string, unknown>): unknown[] {
  const components: Component[] = []
  const allChecks: Check[] = []

  /** スキーマの 1 項目をコンポーネントにし、その ID を返す。path はデータモデルの中の場所。 */
  const build = (schema: Schema, path: string[], label: string, required: boolean): string => {
    const id = `f_${path.join('_')}`
    const value = { '@path': `/${path.join('/')}` }
    if (schema.type === 'object') {
      const children = Object.entries(schema.properties ?? {}).map(([key, child]) =>
        build(child, [...path, key], child.title ?? key, schema.required?.includes(key) ?? false),
      )
      components.push({ id: `${id}_title`, component: 'Text', text: `**${label}**` }, { id, component: 'Column', children: [`${id}_title`, ...children] })
    } else if (schema.type === 'array' && schema.items?.type === 'object') {
      const columns = Object.entries(schema.items.properties ?? {}).map(([key, column]) => ({
        key,
        label: column.title ?? key,
        ...(column.optionsFrom
          ? { type: 'lookup', source: column.optionsFrom }
          : column.enum
            ? { type: 'select', options: options(column) }
            : { type: isNumber(column) ? 'number' : 'text' }),
      }))
      // context: 選択肢のツールに渡す引数を取り出す元。フォーム全体の今の値。
      components.push({ id, component: 'LineItems', label, columns, value, context: { '@path': '/input' } })
    } else if (schema.optionsFrom) {
      components.push({ id, component: 'Lookup', label, source: schema.optionsFrom, value, context: { '@path': '/input' } })
    } else if (schema.enum) {
      components.push({ id, component: 'ChoicePicker', label, variant: 'mutuallyExclusive', options: options(schema), value, displayStyle: 'chips' })
    } else if (schema.type === 'boolean') {
      components.push({ id, component: 'CheckBox', label, value })
    } else {
      const checks = checksFor(schema, label, value, required)
      allChecks.push(...checks)
      components.push({ id, component: 'TextField', label, value, variant: isNumber(schema) ? 'number' : 'shortText', ...(checks.length ? { checks } : {}) })
    }
    return id
  }

  const fields = Object.entries(schema.properties ?? {}).map(([key, child]) =>
    build(child, ['input', key], child.title ?? key, schema.required?.includes(key) ?? false),
  )
  components.push(
    { id: 'root', component: 'Card', child: 'body' },
    { id: 'body', component: 'Column', children: ['title', 'note', ...fields, 'buttons'] },
    { id: 'title', component: 'Text', text: `## 「${schema.title ?? toolName}」を実行しますか?` },
    { id: 'note', component: 'Text', variant: 'caption', text: '内容を確認し、必要なら直してから承認してください。' },
    { id: 'buttons', component: 'Row', justify: 'end', children: ['deny', 'approve'] },
    { id: 'deny', component: 'Button', child: 'deny_label', variant: 'default', action: { event: { name: 'tool_deny', context: {} } } },
    { id: 'deny_label', component: 'Text', text: 'キャンセル' },
    {
      id: 'approve',
      component: 'Button',
      child: 'approve_label',
      variant: 'primary',
      // 押した時点のフォームの値(データモデルの /input 全体)が context.input に入って返ってくる。
      action: { event: { name: 'tool_approve', context: { input: { '@path': '/input' } } } },
      ...(allChecks.length ? { checks: allChecks } : {}),
    },
    { id: 'approve_label', component: 'Text', text: '承認して実行' },
  )
  return [{ version: '1.0', createSurface: { surfaceId, catalogId, components, dataModel: { input: toFormData(schema, input) } } }]
}

export function removeApprovalForm(surfaceId: string): unknown[] {
  return [{ version: '1.0', deleteSurface: { surfaceId } }]
}

/** ツールの入力を、フォームのデータモデルの形にする。ChoicePicker は選んだ値を配列で持つので、enum の値は配列に包む。 */
export function toFormData(schema: Schema, value: unknown): unknown {
  if (schema.type === 'object') {
    const source = (value ?? {}) as Record<string, unknown>
    return Object.fromEntries(Object.entries(schema.properties ?? {}).map(([key, child]) => [key, toFormData(child, source[key])]))
  }
  if (schema.enum && schema.type !== 'array') return value === undefined ? [] : [value]
  // 任意の文字列が未指定のままだと、文字数のチェックが通らず承認ボタンが押せなくなる。空文字にしておく(coerce が入力から外す)。
  if (schema.type === 'string' && value === undefined) return ''
  return value
}

/**
 * フォームから返ってきた値を、スキーマの型に合わせる(数値の欄は文字列で、選択肢は配列で返る)。
 * 空のまま残された任意の項目は、入力から外す。値が正しいかどうかは、このあとツールのスキーマ(zod)で確かめる。
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
  if (schema.enum) return Array.isArray(value) ? value[0] : value
  if (isNumber(schema)) return value === '' || value === null || value === undefined ? undefined : Number(value)
  if (schema.type === 'boolean') return Boolean(value)
  if (schema.type === 'string') return String(value ?? '')
  return value
}

/** 入力のどこが正しくないかを、フォームのラベルで言う。例: 「コースの事前注文 2 行目 数量: …」 */
export function describeIssue(schema: Schema, path: PropertyKey[], message: string): string {
  const labels: string[] = []
  let current: Schema | undefined = schema
  for (const key of path) {
    if (typeof key === 'number') {
      labels.push(`${key + 1} 行目`)
      current = current?.items
    } else {
      current = current?.properties?.[String(key)]
      labels.push(current?.title ?? String(key))
    }
  }
  return `${labels.join(' ')}: ${message}`
}
