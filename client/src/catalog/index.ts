// このアプリのカタログ: 基本カタログ + 資料表示の 5 コンポーネント + 明細の表入力。
// ID とコンポーネントの定義は server/src/document-catalog.ts と揃える。
import type { ReactCatalogComponent } from '@a2ui/react'
import { Catalog } from '@a2ui/web_core'
import { basicCatalog } from '@a2ui/web_core/catalogs/basic/v1'
import { HtmlReport } from './HtmlReport.tsx'
import { LineItems } from './LineItems.tsx'
import { PdfDocument } from './PdfDocument.tsx'
import { SlideDeck } from './SlideDeck.tsx'
import { SvgImage } from './SvgImage.tsx'
import { Table } from './Table.tsx'

export const catalog = new Catalog<ReactCatalogComponent>(
  'https://example.com/a2ui-chat/catalogs/documents/v1/catalog.json',
  '1.0',
  [...basicCatalog.components.values(), Table, SlideDeck, HtmlReport, PdfDocument, SvgImage, LineItems],
  [...basicCatalog.functions.values()],
  basicCatalog.themeSchema,
)
