// 明細の表入力。データモデルの中の「オブジェクトの配列」に結び付き、セルの編集と行の追加・削除ができる。
import { createComponentImplementation } from '@a2ui/react'
import { CommonSchemas } from '@a2ui/web_core/v1_0'
import { z } from 'zod'

const LineItemsApi = {
  name: 'LineItems',
  schema: z.object({
    label: z.string(),
    columns: z.array(z.object({ key: z.string(), label: z.string(), type: z.enum(['text', 'number']) })),
    // データモデルへのバインド。値が変わると表が描き直され、setValue() でデータモデルを書き換えられる。
    value: CommonSchemas.DynamicValue,
  }),
}

type Row = Record<string, unknown>

export const LineItems = createComponentImplementation(LineItemsApi, ({ props }) => {
  const { label, columns } = props
  const rows: Row[] = Array.isArray(props.value) ? (props.value as Row[]) : []
  const setRows = (next: Row[]) => props.setValue(next)

  const setCell = (rowIndex: number, key: string, text: string, type: 'text' | 'number') => {
    const cell = type === 'number' && text !== '' ? Number(text) : text
    setRows(rows.map((row, index) => (index === rowIndex ? { ...row, [key]: cell } : row)))
  }
  const addRow = () => setRows([...rows, Object.fromEntries(columns.map((column) => [column.key, column.type === 'number' ? 1 : '']))])
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
                  <input
                    type={column.type}
                    aria-label={`${column.label} ${rowIndex + 1}`}
                    value={String(row[column.key] ?? '')}
                    onChange={(event) => setCell(rowIndex, column.key, event.target.value, column.type)}
                  />
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
