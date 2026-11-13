// 表。CSV と Excel(.xlsx) でダウンロードできる。
import { createComponentImplementation } from '@a2ui/react'
import writeExcelFile from 'write-excel-file/browser'
import { z } from 'zod'
import { download } from './download.ts'

const Cell = z.union([z.string(), z.number()])
type Cell = z.infer<typeof Cell>

const TableApi = {
  name: 'Table',
  schema: z.object({
    title: z.string(),
    columns: z.array(z.string()),
    rows: z.array(z.array(Cell)),
  }),
}

/** CSV の 1 行。カンマ・引用符・改行を含むセルは引用符で囲む。 */
const csvLine = (cells: Cell[]) => cells.map((cell) => (/[",\n]/.test(String(cell)) ? `"${String(cell).replaceAll('"', '""')}"` : String(cell))).join(',')

export const Table = createComponentImplementation(TableApi, ({ props }) => {
  const { title, columns, rows } = props

  const saveCsv = () => {
    const csv = [columns, ...rows].map(csvLine).join('\r\n')
    // 先頭の BOM は、Excel が UTF-8 として開くために付ける。
    download(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }), `${title}.csv`)
  }
  const saveExcel = async () => {
    const header = columns.map((value) => ({ value, fontWeight: 'bold' as const }))
    download(await writeExcelFile([header, ...rows]).toBlob(), `${title}.xlsx`)
  }

  return (
    <figure className="doc">
      <figcaption>
        <strong>{title}</strong>
        <span>
          <button type="button" onClick={saveCsv}>
            CSV
          </button>
          <button type="button" onClick={saveExcel}>
            Excel
          </button>
        </span>
      </figcaption>
      <div className="doc-scroll">
        <table>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: 行に ID は無く、並び替えもしない
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: 同上
                  <td key={cellIndex} className={typeof cell === 'number' ? 'number' : undefined}>
                    {typeof cell === 'number' ? cell.toLocaleString() : cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  )
})
