// 基本カタログに、資料を表示する 5 つのコンポーネントを足したカタログ文書を作る。
// クライアント側の実装は client/src/catalog/ にあり、名前とプロパティをここと揃える。
export const DOCUMENT_CATALOG_ID = 'https://example.com/a2ui-chat/catalogs/documents/v1/catalog.json'

const text = (description: string) => ({ type: 'string', description })

const components = {
  Table: {
    type: 'object',
    description:
      'A data table with a header row. Use it for any tabular data (CSV-like data, spreadsheets, comparisons). The user can download it as CSV or as an Excel (.xlsx) file.',
    properties: {
      component: { const: 'Table' },
      title: text('Title shown above the table. Also used as the file name of the downloads.'),
      columns: { type: 'array', items: { type: 'string' }, description: 'Column headers, in order.' },
      rows: {
        type: 'array',
        description: 'Data rows. Each row is an array with one cell per column. Write numbers as numbers so that Excel can sum them.',
        items: { type: 'array', items: { type: ['string', 'number'] } },
      },
    },
    required: ['component', 'title', 'columns', 'rows'],
  },
  SlideDeck: {
    type: 'object',
    description: 'A slide deck preview. Use it when the user asks for slides or a presentation. The user can download it as a PowerPoint (.pptx) file.',
    properties: {
      component: { const: 'SlideDeck' },
      title: text('Title of the deck. Also used as the file name of the download.'),
      slides: {
        type: 'array',
        description: 'The slides, in order. Keep each slide to at most 5 short bullets.',
        items: {
          type: 'object',
          properties: {
            title: text('Slide title.'),
            bullets: { type: 'array', items: { type: 'string' }, description: 'Bullet points of the slide.' },
          },
          required: ['title', 'bullets'],
        },
      },
    },
    required: ['component', 'title', 'slides'],
  },
  HtmlReport: {
    type: 'object',
    description:
      'A report written as HTML, shown in a sandboxed frame. Use it for long-form reports with headings, paragraphs, tables and inline SVG charts. The user can download it as an .html file.',
    properties: {
      component: { const: 'HtmlReport' },
      title: text('Title of the report. Also used as the file name of the download.'),
      html: text(
        'The body of the report as an HTML fragment. A <style> element is allowed. Scripts, external images, fonts and stylesheets do not load, so use inline CSS and inline SVG only.',
      ),
    },
    required: ['component', 'title', 'html'],
  },
  PdfDocument: {
    type: 'object',
    description: 'A text document that is rendered as a real A4 PDF and shown page by page. The user can download it as a .pdf file.',
    properties: {
      component: { const: 'PdfDocument' },
      title: text('Title printed at the top of the first page. Also used as the file name of the download.'),
      sections: {
        type: 'array',
        description: 'The sections of the document, in order.',
        items: {
          type: 'object',
          properties: {
            heading: text('Section heading.'),
            paragraphs: { type: 'array', items: { type: 'string' }, description: 'Paragraphs of plain text. No Markdown, no HTML.' },
          },
          required: ['heading', 'paragraphs'],
        },
      },
    },
    required: ['component', 'title', 'sections'],
  },
  SvgImage: {
    type: 'object',
    description: 'An image that you draw yourself as SVG (illustration, diagram, chart, logo). The user can download it as SVG or PNG.',
    properties: {
      component: { const: 'SvgImage' },
      title: text('Title of the image. Also used as its alt text and as the file name of the downloads.'),
      svg: text(
        'A complete <svg> element with xmlns="http://www.w3.org/2000/svg", a viewBox, and width and height attributes. Scripts and external files do not load, so everything must be inline.',
      ),
    },
    required: ['component', 'title', 'svg'],
  },
}

const instructions = `## Document components

- Table: any tabular data. The user can download it as CSV or Excel (.xlsx), so use it when they ask for a spreadsheet, an Excel file or CSV.
- SlideDeck: slides or a presentation. The user can download it as PowerPoint (.pptx).
- HtmlReport: a long-form report as HTML. The user can download it as .html.
- PdfDocument: a text document (letter, minutes, contract draft, summary) rendered as a real PDF. The user can download it as .pdf.
- SvgImage: an image you draw as SVG. The user can download it as SVG or PNG. You cannot generate photos; say so if asked for one.
These five take literal values only (no data bindings) and can be placed inside Column, Card or Tabs like any other component.`

type CatalogDocument = {
  components: Record<string, unknown>
  instructions?: string
  $defs: { anyComponent: { oneOf: { $ref: string }[] } }
  [key: string]: unknown
}

export function withDocumentComponents(basic: CatalogDocument): CatalogDocument {
  return {
    ...basic,
    $id: DOCUMENT_CATALOG_ID,
    catalogId: DOCUMENT_CATALOG_ID,
    title: 'A2UI Basic Catalog + document components',
    instructions: `${basic.instructions ?? ''}\n\n${instructions}`,
    components: { ...basic.components, ...components },
    $defs: {
      ...basic.$defs,
      anyComponent: { oneOf: [...basic.$defs.anyComponent.oneOf, ...Object.keys(components).map((name) => ({ $ref: `#/components/${name}` }))] },
    },
  }
}
