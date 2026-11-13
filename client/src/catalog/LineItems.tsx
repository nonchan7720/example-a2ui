// 明細の表入力。データモデルの中の「オブジェクトの配列」に結び付き、セルの編集と行の追加・削除ができる。
import { createComponentImplementation } from '@a2ui/react'
import { CommonSchemas } from '@a2ui/web_core/v1_0'
import { z } from 'zod'
import { RemoteSelect } from './RemoteSelect.tsx'

const LineItemsApi = {
  name: 'LineItems',
  schema: z.object({
    label: z.string(),
    columns: z.array(
      z.object({
        key: z.string(),
        label: z.string(),
        type: z.enum(['text', 'number', 'select', 'lookup']),
        // select の列の選択肢。
        options: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
        // lookup の列が選択肢を取るツール。
        source: z.object({ tool: z.string(), params: z.record(z.string()).optional() }).optional(),
      }),
    ),
    // データモデルへのバインド。値が変わると表が描き直され、setValue() でデータモデルを書き換えられる。
    value: CommonSchemas.DynamicValue,
    // lookup の列が、ツールの引数を取り出す元(フォーム全体の今の値)。
    context: CommonSchemas.DynamicValue.optional(),
  }),
}

type Row = Record<string, unknown>

export const LineItems = createComponentImplementation(LineItemsApi, ({ props }) => {
  const { label, columns } = props
  const rows: Row[] = Array.isArray(props.value) ? (props.value as Row[]) : []
  const setRows = (next: Row[]) => props.setValue(next)

  const setCell = (rowIndex: number, key: string, text: string, type: string) => {
    const cell = type === 'number' && text !== '' ? Number(text) : text
    setRows(rows.map((row, index) => (index === rowIndex ? { ...row, [key]: cell } : row)))
  }
  /** 新しい行の初期値: 数値は 1、選択肢は先頭、文字は空。 */
  const blank = (column: (typeof columns)[number]) => (column.type === 'number' ? 1 : column.type === 'select' ? (column.options?.[0]?.value ?? '') : '')
  const addRow = () => setRows([...rows, Object.fromEntries(columns.map((column) => [column.key, blank(column)]))])
  const removeRow = (rowIndex: number) => setRows(rows.filter((_, index) => index !== rowIndex))

  return (
    <div className="line-items">
      <strong>{label}</strong>
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key}>{column.label}</th>
            ))}
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 行に ID は無い。入力中にフォーカスが外れないよう、位置をキーにする
            <tr key={rowIndex}>
              {columns.map((column) => (
                <td key={column.key}>
                  {column.type === 'lookup' && column.source ? (
                    <RemoteSelect
                      label={`${column.label} ${rowIndex + 1}`}
                      source={column.source}
                      context={props.context}
                      value={String(row[column.key] ?? '')}
                      onChange={(id) => setCell(rowIndex, column.key, id, column.type)}
                    />
                  ) : column.type === 'select' ? (
                    <select
                      aria-label={`${column.label} ${rowIndex + 1}`}
                      value={String(row[column.key] ?? '')}
                      onChange={(event) => setCell(rowIndex, column.key, event.target.value, column.type)}
                    >
                      {column.options?.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={column.type}
                      aria-label={`${column.label} ${rowIndex + 1}`}
                      value={String(row[column.key] ?? '')}
                      onChange={(event) => setCell(rowIndex, column.key, event.target.value, column.type)}
                    />
                  )}
                </td>
              ))}
              <td>
                <button type="button" className="line-items-button" aria-label={`${rowIndex + 1} 行目を削除`} onClick={() => removeRow(rowIndex)}>
                  削除
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="line-items-button" onClick={addRow}>
        行を追加
      </button>
    </div>
  )
})
