// 文書。その場で PDF を作って表示し、.pdf でダウンロードできる。
import { createComponentImplementation } from '@a2ui/react'
import { useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { download } from './download.ts'
import { createPdf, renderPdf } from './pdf.ts'

const PdfDocumentApi = {
  name: 'PdfDocument',
  schema: z.object({
    title: z.string(),
    sections: z.array(z.object({ heading: z.string(), paragraphs: z.array(z.string()) })),
  }),
}

export const PdfDocument = createComponentImplementation(PdfDocumentApi, ({ props }) => {
  const { title, sections } = props
  const pages = useRef<HTMLDivElement>(null)
  const [pdf, setPdf] = useState<Uint8Array>()

  // 内容が変わるたびに PDF を作り直し、できた PDF そのものを描く。
  const content = JSON.stringify({ title, sections })
  useEffect(() => {
    let cancelled = false
    const { title, sections } = JSON.parse(content) as z.infer<typeof PdfDocumentApi.schema>
    createPdf(title, sections).then(async (bytes) => {
      if (cancelled || !pages.current) return
      await renderPdf(bytes, pages.current)
      setPdf(bytes)
    })
    return () => {
      cancelled = true
    }
  }, [content])

  return (
    <figure className="doc">
      <figcaption>
        <strong>{title}</strong>
        <span>
          <button type="button" disabled={!pdf} onClick={() => pdf && download(new Blob([pdf.slice()], { type: 'application/pdf' }), `${title}.pdf`)}>
            PDF
          </button>
        </span>
      </figcaption>
      <div className="pdf-pages" ref={pages}>
        PDF を作成しています…
      </div>
    </figure>
  )
})
